import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import { makeFunctionReference } from "convex/server";
import { enqueueEventSync, enqueueSyncJob } from "../../convex/_eventSync";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import { syncKindHandlers } from "../../convex/eventSyncKinds/index";
import { AwaitingClubOperation, OPERATION_WAIT_MS } from "../../convex/eventSyncKinds/types";
import { connectorFixture } from "./_eventConnectorFixture";

const claim = makeFunctionReference<"mutation">("eventSync:claimJob");
const fail = makeFunctionReference<"mutation">("eventSync:failJob");
const run = makeFunctionReference<"action">("eventSync:runJob");
const recover = makeFunctionReference<"mutation">("eventSync:recoverExpiredJobs");
const complete = makeFunctionReference<"mutation">("eventSync:completeJob");
const NOW = Date.UTC(2027, 0, 10, 12);
beforeEach(test => test.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW }));
const jobs = (f: Awaited<ReturnType<typeof connectorFixture>>) => f.t.run(ctx => ctx.db.query("eventSyncJobs").collect());

it("keeps one pending job per connector per event and cancels the replaced schedule", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.query("eventSyncJobs").collect().then(rows => Promise.all(rows.map(row => ctx.db.delete(row._id)))));
  const first = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  const firstFn = (await f.t.run(ctx => ctx.db.get(first)))!.scheduledFunctionId!;
  const second = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
  assert.equal(second, first);
  const pending = (await jobs(f)).filter(row => row.state === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.kind, "export_delete");
  assert.equal((await f.t.run(ctx => ctx.db.system.get(firstFn)))!.state.kind, "canceled");
});

it("enqueueEventSync is a no-op when the flag is off and skips import-only and off connectors", async () => {
  const f = await connectorFixture({ flag: false });
  await f.insertConnector({ direction: "export" });
  const off = await f.createEvent();
  await f.t.run(ctx => enqueueEventSync(ctx.db, ctx.scheduler, off.eventId, "upsert"));
  assert.equal((await jobs(f)).length, 0);
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  const g = await connectorFixture();
  await g.insertConnector({ direction: "import" });
  await g.insertConnector({ direction: "off", target: { calendarId: "b" } });
  const on = await g.createEvent();
  await g.t.run(ctx => enqueueEventSync(ctx.db, ctx.scheduler, on.eventId, "upsert"));
  assert.equal((await jobs(g)).length, 0);
  // Positive control: the same call with an export connector does queue.
  await g.insertConnector({ direction: "export", target: { calendarId: "c" } });
  await g.t.run(ctx => enqueueEventSync(ctx.db, ctx.scheduler, on.eventId, "upsert"));
  assert.equal((await jobs(g)).length, 1);
});

it("backs off 1, 2, 4, 8 minutes and marks the job failed on the fifth failure", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector({ direction: "export" });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  for (const [index, minutes] of [1, 2, 4, 8].entries()) {
    assert.ok(await f.t.mutation(claim, { jobId }));
    await f.t.mutation(fail, { jobId, error: `boom ${index}`, durationMs: 5 });
    const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
    assert.equal(job.state, "pending");
    assert.equal(job.attempts, index + 1);
    assert.equal(job.dueAt, Date.now() + minutes * 60_000);
  }
  assert.ok(await f.t.mutation(claim, { jobId }));
  await f.t.mutation(fail, { jobId, error: "boom final", durationMs: 5 });
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "failed");
  assert.equal(job.attempts, 5);
  assert.equal((await f.t.run(ctx => ctx.db.get(connectorId)))!.lastError, "boom final");
  const analytics = await f.t.run(ctx => ctx.db.query("productAnalyticsOutbox").collect());
  assert.deepEqual(analytics.filter(row => row.event === "event_sync_job").map(row => row.properties.outcome), ["failed"]);
});

it("an unregistered kind fails with a clear error", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
  await f.t.action(run, { jobId });
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "pending");
  assert.equal(job.attempts, 1);
  assert.match(job.lastError ?? "", /No import_poll handler is registered for connector kind google_calendar/);
});

it("the runner writes the link after a kind's export, and retracts it after a delete", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const google = syncKindHandlers.google_calendar;
  google.exportUpsert = async () => ({ externalId: "g-9" });
  google.exportDelete = async () => {};
  try {
    const upsert = { _id: await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" })) };
    await f.t.action(run, { jobId: upsert._id });
    const expected = await f.t.run(async ctx => carriedFieldsHash("google_calendar", await correctionFields(ctx.db, (await ctx.db.get(eventId))!)));
    const link = async () => (await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique()))!;
    assert.deepEqual([(await link()).externalId, (await link()).lastExportedAt, (await link()).lastExportedHash, (await link()).state], ["g-9", Date.now(), expected, "linked"]);
    await f.t.run(ctx => ctx.db.patch(eventId, { publicationState: "draft_private" }));
    const remove = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
    await f.t.action(run, { jobId: remove });
    assert.equal((await link()).state, "vrdex_retracted");
    // Republishing relinks the same row with the new copy's ID.
    google.exportUpsert = async () => ({ externalId: "g-10" });
    await f.t.run(ctx => ctx.db.patch(eventId, { publicationState: "published" }));
    const again = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
    await f.t.action(run, { jobId: again });
    assert.deepEqual([(await link()).state, (await link()).externalId], ["linked", "g-10"]);
  } finally {
    delete google.exportUpsert;
    delete google.exportDelete;
  }
});

it("reconcile enqueues exports for unlinked upcoming events even without a kind reconcile", async () => {
  const f = await connectorFixture();
  const upcoming = await f.createEvent({ title: "Upcoming" });
  const linked = await f.createEvent({ title: "Linked", startAt: Date.now() + 5 * 86_400_000 });
  const past = await f.createEvent({ title: "Past", startAt: Date.now() - 3 * 86_400_000 });
  const far = await f.createEvent({ title: "Far", startAt: Date.now() + 120 * 86_400_000 });
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId: linked.eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.action(run, { jobId });
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.state, "done");
  const exports = (await jobs(f)).filter(row => row.kind === "export_upsert" && row.state === "pending").map(row => row.eventId);
  assert.deepEqual(exports, [upcoming.eventId]);
  void past; void far;
});

it("pauses the connector when its authority lost manage_integrations", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.run(ctx => ctx.db.patch(f.integratorGrant, { state: "revoked", revokedAt: Date.now() }));
  assert.equal(await f.t.mutation(claim, { jobId }), null);
  const connector = (await f.t.run(ctx => ctx.db.get(connectorId)))!;
  assert.equal(connector.state, "paused");
  assert.equal(connector.lastError, "authority_lost");
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.state, "done");
});

it("a pending held draft blocks exports for that event", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(async ctx => {
    const draftId = await ctx.db.insert("eventIntakeDrafts", { actorUserId: f.users.integrator, connectorId, version: 1, fields: { title: "Held" }, provenance: [], createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
    await ctx.db.insert("eventSyncLinks", { connectorId, eventId, draftId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() });
  });
  const job = { _id: await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" })) };
  assert.equal(await f.t.mutation(claim, { jobId: job._id }), null);
  const after = (await f.t.run(ctx => ctx.db.get(job._id)))!;
  assert.equal(after.state, "done");
  assert.equal(after.lastError, "pending_draft");
});

it("stale upsert after unpublish runs as delete", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.run(ctx => ctx.db.patch(eventId, { publicationState: "draft_private" }));
  const claimed = await f.t.mutation(claim, { jobId });
  assert.equal(claimed.job.kind, "export_delete");
});

it("failed run superseded by a newer pending job", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.mutation(claim, { jobId });
  await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.mutation(fail, { jobId, error: "boom", durationMs: 1 });
  assert.equal((await f.t.run(ctx => ctx.db.get(jobId)))!.lastError, "superseded");
  assert.equal((await jobs(f)).filter(row => row.eventId === eventId && row.state === "pending").length, 1);
});

it("a handler returning AwaitingClubOperation keeps the job running without spending an attempt", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const google = syncKindHandlers.google_calendar;
  google.importPoll = async () => AwaitingClubOperation;
  try {
    const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
    await f.t.action(run, { jobId });
    const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
    assert.deepEqual([job.state, job.attempts, job.leaseExpiresAt], ["running", 0, Date.now() + OPERATION_WAIT_MS]);
  } finally {
    delete google.importPoll;
  }
});

it("a running job is claimable only after its lease expires", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll", dueAt: NOW + 86_400_000 }));
  assert.ok(await f.t.mutation(claim, { jobId }));
  assert.equal(await f.t.mutation(claim, { jobId }), null);
  t.mock.timers.tick(600_001);
  const reclaimed = await f.t.mutation(claim, { jobId });
  assert.equal(reclaimed.job.attempts, 2);
});

it("a failing reconcile beside a pending import_poll counts as a failure", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const reconcile = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile" }));
  await f.t.mutation(claim, { jobId: reconcile });
  const poll = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_poll" }));
  await f.t.mutation(fail, { jobId: reconcile, error: "boom", durationMs: 1 });
  const job = (await f.t.run(ctx => ctx.db.get(reconcile)))!;
  assert.deepEqual([job.state, job.attempts, job.lastError], ["pending", 1, "boom"]);
  assert.notEqual(poll, reconcile);
  assert.equal((await f.t.run(ctx => ctx.db.get(poll)))!.state, "pending");
});

it("a date-only event's export hash equals its fields with a null timezone", async () => {
  const f = await connectorFixture();
  const event = await f.t.run(async ctx => ctx.db.get(await ctx.db.insert("events", { title: "All Day", sortTitle: "all day", slug: "allday01", communityProfileId: f.communityProfileId, sourceType: "community", sourceLabel: "Community-submitted event", eventStatus: "scheduled", publicationState: "published", scheduleKind: "date_only", eventDate: "2027-05-01", updatedAt: Date.now() })));
  const fields = await f.t.run(ctx => correctionFields(ctx.db, event!));
  assert.equal(carriedFieldsHash("google_calendar", fields), carriedFieldsHash("google_calendar", { ...fields, timezone: null }));
});

it("expired lease is recovered as a failed attempt", async t => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile", dueAt: NOW + 86_400_000 }));
  await f.t.mutation(claim, { jobId });
  t.mock.timers.tick(600_000 + 300_001);
  await f.t.mutation(recover, {});
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.equal(job.state, "pending");
  assert.equal(job.lastError, "lease_expired");
  assert.equal(job.dueAt, Date.now() + 60_000);
});

it("enqueueEventSync sends delete only where a link exists", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent({ published: false });
  const linked = await f.insertConnector({ direction: "export" });
  await f.insertConnector({ direction: "export", target: { calendarId: "other" } });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId: linked, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  await f.t.run(ctx => enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert"));
  const rows = (await jobs(f)).filter(row => row.eventId === eventId);
  assert.deepEqual(rows.map(row => [row.connectorId, row.kind]), [[linked, "export_delete"]]);
});

it("a pending job its run never claimed is recovered as a stalled failed attempt", async () => {
  const f = await connectorFixture();
  const connectorId = await f.insertConnector();
  const jobId = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "reconcile", dueAt: Date.now() - 300_000 }));
  const stalledFn = (await f.t.run(ctx => ctx.db.get(jobId)))!.scheduledFunctionId!;
  await f.t.mutation(recover, {});
  const job = (await f.t.run(ctx => ctx.db.get(jobId)))!;
  assert.deepEqual([job.state, job.attempts, job.lastError, job.dueAt], ["pending", 1, "stalled", Date.now() + 60_000]);
  assert.equal((await f.t.run(ctx => ctx.db.system.get(stalledFn)))!.state.kind, "canceled");
  assert.notEqual(job.scheduledFunctionId, stalledFn);
});

it("an edit during an in-flight export waits for it and updates the same copy", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const google = syncKindHandlers.google_calendar;
  let created = 0;
  google.exportUpsert = async (_ctx, _connector, _event, link) => ({ externalId: link?.externalId ?? `g-${++created}` });
  try {
    const first = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
    const lease = (await f.t.mutation(claim, { jobId: first })).job.leaseExpiresAt;
    const second = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
    assert.notEqual(second, first);
    await f.t.action(run, { jobId: second });
    const waiting = (await f.t.run(ctx => ctx.db.get(second)))!;
    assert.deepEqual([waiting.state, waiting.attempts, waiting.dueAt], ["pending", 0, lease]);
    await f.t.mutation(complete, { jobId: first, externalId: "g-1", durationMs: 1 });
    const woken = (await f.t.run(ctx => ctx.db.get(second)))!;
    assert.equal(woken.dueAt, Date.now());
    assert.notEqual(woken.scheduledFunctionId, waiting.scheduledFunctionId);
    await f.t.action(run, { jobId: second });
    const links = await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).collect());
    assert.deepEqual([created, links.length, links[0]!.externalId, (await f.t.run(ctx => ctx.db.get(second)))!.state], [0, 1, "g-1", "done"]);
  } finally {
    delete google.exportUpsert;
  }
});

it("unpublishing during an in-flight export retracts the copy it created", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  const first = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_upsert" }));
  await f.t.mutation(claim, { jobId: first });
  await f.t.run(async ctx => {
    await ctx.db.patch(eventId, { publicationState: "draft_private" });
    await enqueueEventSync(ctx.db, ctx.scheduler, eventId, "delete");
  });
  assert.equal((await jobs(f)).filter(row => row.state === "pending").length, 0);
  await f.t.mutation(complete, { jobId: first, externalId: "g-1", durationMs: 1 });
  const link = (await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique()))!;
  assert.deepEqual([link.externalId, link.state], ["g-1", "linked"]);
  const retract = (await jobs(f)).filter(row => row.state === "pending");
  assert.deepEqual(retract.map(row => [row.eventId, row.kind, row.dueAt]), [[eventId, "export_delete", Date.now()]]);
});

it("a stale delete never removes a republished event's copy", async () => {
  const f = await connectorFixture();
  const { eventId } = await f.createEvent();
  const connectorId = await f.insertConnector({ direction: "export" });
  await f.t.run(ctx => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "g-1", state: "linked", createdAt: Date.now(), updatedAt: Date.now() }));
  await f.t.run(ctx => ctx.db.patch(eventId, { publicationState: "draft_private" }));
  const remove = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
  await f.t.mutation(claim, { jobId: remove });
  await f.t.run(async ctx => {
    await ctx.db.patch(eventId, { publicationState: "published" });
    await enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert");
  });
  const upsert = (await jobs(f)).find(row => row.state === "pending")!;
  assert.equal(await f.t.mutation(claim, { jobId: upsert._id }), null);
  await f.t.mutation(fail, { jobId: remove, error: "boom", durationMs: 1 });
  assert.deepEqual([(await f.t.run(ctx => ctx.db.get(remove)))!.state, (await f.t.run(ctx => ctx.db.get(remove)))!.lastError], ["done", "superseded"]);
  assert.equal((await f.t.run(ctx => ctx.db.get(upsert._id)))!.dueAt, Date.now());
  // A delete that reaches its claim while the event is public is stale and closes without running.
  const late = await f.t.run(ctx => enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId, kind: "export_delete" }));
  assert.equal(await f.t.mutation(claim, { jobId: late }), null);
  assert.equal((await f.t.run(ctx => ctx.db.get(late)))!.lastError, "event_public");
  assert.equal((await f.t.run(ctx => ctx.db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).unique()))!.state, "linked");
});
