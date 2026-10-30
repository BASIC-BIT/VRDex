import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import schemaModule from "../../convex/schema";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { api, internal } from "../../convex/_generated/api";
import type { VrchatCalendarItem } from "../../convex/_clubOperations";
import { candidateFromConnectorFields } from "../../convex/_eventCandidateApply";
import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";
import { EventIntakeCandidateSchema } from "../../packages/api-contracts/src/event-intake";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import { enqueueEventSync, failureAlertKey } from "../../convex/_eventSync";
import { exportPayloadFromEvent, fieldsFromVrchatEvent, truncateTitle } from "../../convex/eventSyncKinds/vrchatCalendar";
import type { VrchatJobPayload } from "../../convex/vrchatCalendarConnector";
import {
  BOT_ID, CAL_1, EVENT_URL, GROUP_ID, NOW, SITE, asOwner, asStaff, calId, eventDoc, modules, operations, rerunJob, runSyncJob, seedEvent, seedVrchatConnector, setupEnv, vrchatItem, workerArgs, workerSettle,
} from "./_vrchatCalendarFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("vrchat calendar mapping", () => {
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";

  it("truncates titles to 64 characters with an ellipsis", () => {
    assert.equal(truncateTitle("Bass Temple"), "Bass Temple");
    assert.equal(truncateTitle("x".repeat(64)), "x".repeat(64));
    assert.equal(truncateTitle("x".repeat(65)), "x".repeat(63) + "…");
    assert.equal(truncateTitle(long).length, 64);
    // A cut landing inside a surrogate pair drops the whole pair.
    assert.equal(truncateTitle("x".repeat(62) + "🎶🎶"), "x".repeat(62) + "…");
  });

  it("appends world names and the event URL as the last paragraph", () => {
    assert.deepEqual(exportPayloadFromEvent(eventDoc(), { eventUrl: EVENT_URL, worldNames: ["Harbor Club", "Night Market"], artworkUrl: "https://media.vrdex.test/poster.png" }), {
      title: "Bass Temple", description: "Weekly bass night.\n\nHarbor Club, Night Market\n" + EVENT_URL,
      startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T04:00:00.000Z", imageUrl: "https://media.vrdex.test/poster.png", accessType: "group",
    });
    assert.equal(exportPayloadFromEvent(eventDoc({ summary: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).description, EVENT_URL);
    assert.equal(exportPayloadFromEvent(eventDoc({ endAt: undefined }), { eventUrl: EVENT_URL, worldNames: [] }).endsAt, "2026-11-08T05:00:00.000Z");
  });

  it("round-trips a long-titled event with no end to the runner's carried hash", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const out = exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: ["Harbor Club"] });
    const back = fieldsFromVrchatEvent(vrchatItem({ ...out }), "UTC", SITE, event);
    assert.equal(back.title, long);
    assert.equal(back.end, null);
    const vrdex = await t.run((ctx) => correctionFields(ctx.db, event));
    assert.equal(carriedFieldsHash("vrchat_calendar", back), carriedFieldsHash("vrchat_calendar", vrdex));
  });

  async function roundTrip(overrides: Partial<Doc<"events">>, zone: string) {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const eventId = await seedEvent(t, communityProfileId, overrides);
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const back = fieldsFromVrchatEvent(vrchatItem({ ...exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: ["Harbor Club"] }) }), zone, SITE, event);
    const vrdex = await t.run((ctx) => correctionFields(ctx.db, event));
    assert.equal(carriedFieldsHash("vrchat_calendar", back), carriedFieldsHash("vrchat_calendar", vrdex));
    return back;
  }

  it("reads a timezone-less linked event in UTC, as correctionFields does, under a non-UTC connector", async () => {
    const back = await roundTrip({ timezone: undefined, eventDate: "2026-11-08" }, "America/New_York");
    assert.equal(back.timezone, "UTC");
  });

  it("round-trips a New York event on the fall-back date that ends after local midnight", async () => {
    // Starts in the repeated 01:30 hour (EST, the later one) and ends 00:30 the next local day.
    const startAt = Date.parse("2026-11-01T06:30:00.000Z");
    const back = await roundTrip({ eventDate: "2026-11-01", startAt, sortAt: startAt, endAt: Date.parse("2026-11-02T05:30:00.000Z") }, "America/New_York");
    assert.deepEqual([back.eventDate, back.start, back.end], ["2026-11-01", { time: "01:30", occurrence: "later" }, { time: "00:30", dayOffset: 1 }]);
  });

  it("reads an end that is not after the start, or beyond the schema's day offset, as no end", () => {
    const read = (endsAt: string) => fieldsFromVrchatEvent(vrchatItem({ endsAt }), "UTC", SITE, null).end;
    assert.equal(read("2026-11-08T01:00:00.000Z"), null);
    assert.equal(read("2026-11-07T23:00:00.000Z"), null);
    assert.equal(read("2026-11-16T01:00:00.000Z"), null);
    assert.equal(read("not a date"), null);
    assert.deepEqual(read("2026-11-15T01:00:00.000Z"), { time: "01:00", dayOffset: 7 });
  });

  it("keeps surrogate pairs whole in the summary and accepts a site URL with a trailing slash", () => {
    const summary = (description: string, siteUrl = SITE) => fieldsFromVrchatEvent(vrchatItem({ description }), "UTC", siteUrl, null).summary;
    assert.equal(summary("y".repeat(239) + "🎶"), "y".repeat(239));
    assert.equal(summary("y".repeat(237) + "  🎶"), "y".repeat(237));
    assert.equal(summary("Weekly bass night.\n\n" + EVENT_URL, SITE + "/"), "Weekly bass night.");
  });

  it("reads an unlinked item in the connector zone and strips only the appended paragraph", () => {
    const fields = fieldsFromVrchatEvent(vrchatItem({ description: "Weekly bass night.\n\nHarbor Club\n" + EVENT_URL }), "America/New_York", SITE, null);
    assert.deepEqual([fields.title, fields.eventDate, fields.timezone, fields.start, fields.end, fields.summary],
      ["Bass Temple", "2026-11-07", "America/New_York", { time: "20:00" }, { time: "23:00" }, "Weekly bass night."]);
    const foreign = fieldsFromVrchatEvent(vrchatItem({ description: "Doors at 8.\n\nBring friends." }), "UTC", SITE, null);
    assert.equal(foreign.summary, "Doors at 8.\n\nBring friends.");
    assert.equal(fieldsFromVrchatEvent(vrchatItem({ description: "y".repeat(300) }), "UTC", SITE, null).summary!.length, 240);
  });
});

describe("candidateFromConnectorFields", () => {
  it("gives every carried field explicit connector evidence that candidatePatch reads back as the same fields", () => {
    const fields = fieldsFromVrchatEvent(vrchatItem({ endsAt: "2026-11-08T06:00:00.000Z" }), "America/New_York", SITE, null);
    const candidate = candidateFromConnectorFields("vrchat_calendar", fields, { kind: "new" });
    EventIntakeCandidateSchema.parse(candidate);
    assert.deepEqual(candidate.event, {
      title: "Bass Temple", communitySlug: null, eventDate: "2026-11-07", start: "20:00", end: "01:00", startDate: "2026-11-07", endDate: "2026-11-08",
      timezone: "America/New_York", venueLabel: null, summary: "Weekly bass night.", sourceUrl: null,
    });
    assert.deepEqual([candidate.lineup, candidate.questions, candidate.decision], [[], [], { kind: "new" }]);
    assert.deepEqual(candidate.evidence.map((row) => row.fieldPath), ["event.title", "event.eventDate", "event.start", "event.end", "event.timezone", "event.summary"]);
    assert.ok(candidate.evidence.every((row) => row.origin === "connector" && row.assessment === "explicit" && row.excerpt === null));
    const { timeTba: _timeTba, ...rest } = fields;
    assert.deepEqual(candidatePatch(candidate).tentative, { ...rest, start: { time: "20:00", dayOffset: 0 } });
    assert.equal(carriedFieldsHash("vrchat_calendar", { ...candidatePatch(candidate).tentative, timeTba: false }), carriedFieldsHash("vrchat_calendar", fields));
    // A field given as null is still explicit, so an update clears it.
    assert.deepEqual(candidateFromConnectorFields("vrchat_calendar", { end: null }, { kind: "new" }).evidence.map((row) => row.fieldPath), ["event.end"]);
  });
});

describe("vrchat calendar export", () => {
  beforeEach(setupEnv);
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";
  const link = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, eventId: Id<"events">, extra: Partial<Doc<"eventSyncLinks">> = {}) =>
    t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW, ...extra }));
  const linkOf = async (t: TestConvex<typeof schema>, eventId: Id<"events">) =>
    (await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_eventId", (q) => q.eq("eventId", eventId)).collect()))[0];
  const creates = async (t: TestConvex<typeof schema>) => (await operations(t)).filter((op) => op.payload.kind === "create_calendar_event").length;
  const expireLease = (t: TestConvex<typeof schema>, jobId: Id<"eventSyncJobs">, extra: Partial<Doc<"eventSyncJobs">> = {}) =>
    t.run((ctx) => ctx.db.patch(jobId, { leaseExpiresAt: NOW, ...extra }));
  const pendingJob = async (t: TestConvex<typeof schema>, kind: Doc<"eventSyncJobs">["kind"]) =>
    (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).find((row) => row.state === "pending" && row.kind === kind)!;
  const kinds = async (t: TestConvex<typeof schema>) => (await operations(t)).map((op) => op.payload.kind);

  it("no link: reads the dates first, then creates with a truncated title and no notification field", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual([job.state, job.attempts, job.leaseExpiresAt], ["running", 0, NOW + 30 * 60_000]);
    assert.deepEqual((await operations(t))[0].payload, { kind: "list_calendar_events", from: "2026-11-06T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [], calendarEventsTruncated: false } });
    job = await rerunJob(t, job._id);
    const [create] = await operations(t);
    assert.equal(create.connectorSync?.jobId, job._id);
    assert.equal(create.eventId, undefined);
    assert.deepEqual(create.payload, { kind: "create_calendar_event", title: long.slice(0, 63) + "…", description: "Weekly bass night.\n\n" + EVENT_URL,
      startsAt: "2026-11-08T01:00:00.000Z", endsAt: "2026-11-08T05:00:00.000Z", accessType: "group" });
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const row = await linkOf(t, eventId);
    assert.deepEqual([row.externalId, row.state, row.lastExportedAt], [CAL_1, "linked", NOW]);
    assert.equal(row.lastExportedHash, carriedFieldsHash("vrchat_calendar", await t.run((ctx) => correctionFields(ctx.db, event))));
  });

  it("matches an existing VRChat entry instead of creating, and sends relative artwork as a site URL", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { posterImageUrl: "/posters/bass.png" });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    // Same local date in New York with the title differing only in case and padding; the other item is the night before.
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [
      vrchatItem({ id: "cal_00000000-0000-0000-0000-000000000009", startsAt: "2026-11-07T01:00:00.000Z" }), vrchatItem({ title: " BASS TEMPLE " }),
    ] } });
    await rerunJob(t, job._id);
    const ops = await operations(t);
    const update = ops[0].payload as { kind: string; calendarEventId: string; imageUrl?: string };
    assert.deepEqual([ops.length, update.kind, update.calendarEventId, update.imageUrl], [1, "update_calendar_event", CAL_1, SITE + "/posters/bass.png"]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    const row = await linkOf(t, eventId);
    assert.deepEqual([row.externalId, row.externalArtworkUrl], [CAL_1, SITE + "/posters/bass.png"]);
  });

  it("an indeterminate create retries through a read and links the entry", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await rerunJob(t, job._id);
    await workerSettle(t, { status: "indeterminate", code: "submission_outcome_unknown" });
    job = await rerunJob(t, job._id);
    assert.notEqual(job.state, "done");
    assert.equal((job.payload as VrchatJobPayload).operationId, undefined);
    await t.run((ctx) => ctx.db.patch(job._id, { state: "pending", dueAt: NOW }));
    job = await rerunJob(t, job._id);
    assert.equal((await operations(t))[1].payload.kind, "list_calendar_events");
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    assert.equal((await operations(t)).at(-1)!.payload.kind, "update_calendar_event");
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    await rerunJob(t, job._id);
    assert.equal(await creates(t), 1);
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
  });

  it("a linked update sends artwork only when it changed and resumes from the callback", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { posterImageUrl: "https://media.vrdex.test/poster.png" });
    await link(t, connectorId!, eventId, { externalArtworkUrl: "https://media.vrdex.test/poster.png" });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const [op] = await operations(t);
    assert.deepEqual([op.payload.kind, "imageUrl" in op.payload], ["update_calendar_event", false]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.ok((await t.run((ctx) => ctx.db.get(job._id)))!.leaseExpiresAt! <= NOW);
    assert.equal((await rerunJob(t, job._id)).state, "done");
  });

  // A cancelled event stays published, so the runner keeps export_upsert and the kind deletes; completeJob keeps the link linked.
  it("a cancelled event deletes the linked entry and leaves a none: link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual([job.kind, (await operations(t))[0].payload], ["export_upsert", { kind: "delete_calendar_event", calendarEventId: CAL_1 }]);
    await workerSettle(t, { status: "succeeded" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    const row = await linkOf(t, eventId);
    assert.deepEqual([row.externalId, row.state], ["none:" + eventId, "linked"]);
    // Nothing left to delete: a second run writes nothing.
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId })).state, "done");
    assert.equal((await operations(t)).length, 1);
  });

  it("an exported event made date-only deletes its entry", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { scheduleKind: "date_only", startAt: undefined, endAt: undefined });
    await link(t, connectorId!, eventId, { lastExportedAt: NOW - 60_000 });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual((await operations(t))[0].payload, { kind: "delete_calendar_event", calendarEventId: CAL_1 });
    await workerSettle(t, { status: "rejected", code: "visibility" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).externalId, "none:" + eventId);
  });

  it("export_delete treats an entry already gone as done", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_delete", eventId });
    assert.equal((await operations(t))[0].payload.kind, "delete_calendar_event");
    await workerSettle(t, { status: "rejected", code: "visibility" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).state, "vrdex_retracted");
  });

  it("export_delete of a none: link writes nothing", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    await link(t, connectorId!, eventId, { externalId: "none:" + eventId });
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_delete", eventId })).state, "done");
    assert.equal((await operations(t)).length, 0);
  });

  it("an update to an entry deleted in VRChat flags the link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "rejected", code: "visibility" });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).state, "external_deleted");
    // Never recreate a copy the organiser removed.
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId })).state, "done");
    assert.equal((await operations(t)).length, 1);
  });

  it("a second export waits while the first create is in flight and then updates", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    let first = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    first = await rerunJob(t, first._id);
    const second = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual([second.state, second.dueAt], ["pending", first.leaseExpiresAt]);
    assert.deepEqual([(await operations(t)).length, await creates(t)], [1, 1]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, first._id)).state, "done");
    await rerunJob(t, second._id);
    assert.equal((await operations(t)).at(-1)!.payload.kind, "update_calendar_event");
    assert.equal(await creates(t), 1);
  });

  it("re-enqueues a missed operation without spending an attempt", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const [missed] = await operations(t);
    await t.run((ctx) => ctx.db.patch(missed._id, { state: "missed", code: "late_window_elapsed", completedAt: NOW }));
    await expireLease(t, job._id);
    const again = await rerunJob(t, job._id);
    const ops = await operations(t);
    assert.deepEqual([again.state, again.attempts, ops.length, ops[1].payload], ["running", 0, 2, missed.payload]);
    assert.equal((again.payload as VrchatJobPayload).operationId, ops[1]._id);
  });

  it("fails a wait past six hours but keeps the in-flight create, and never creates twice", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    job = await rerunJob(t, job._id);
    const createId = (job.payload as VrchatJobPayload).operationId;
    await expireLease(t, job._id, { payload: { ...(job.payload as object), waitingSince: NOW - 6 * 3_600_000 - 1 } });
    job = await rerunJob(t, job._id);
    assert.deepEqual([job.state, job.lastError, (job.payload as VrchatJobPayload).operationId], ["pending", "vrchat_operation_stalled", createId]);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(await creates(t), 1);
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
  });

  it("pauses the connector when its authority lost manage_events", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { authority: "integrations_only" });
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId!)))!;
    assert.deepEqual([job.state, job.lastError, connector.state, connector.lastError], ["pending", "authority_lost", "paused", "authority_lost"]);
    assert.equal((await operations(t)).length, 0);
  });

  it("does not export date-only events, and does nothing with the flag off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const dateOnly = await seedEvent(t, communityProfileId, { scheduleKind: "date_only", startAt: undefined, endAt: undefined });
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: dateOnly })).state, "done");
    assert.equal((await linkOf(t, dateOnly)).externalId, "none:" + dateOnly);
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    const timed = await seedEvent(t, communityProfileId, { slug: "other-night" });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: timed });
    assert.deepEqual([job.state, job.lastError], ["pending", "CONNECTOR_KIND_DISABLED"]);
    assert.equal((await operations(t)).length, 0);
  });

  // A re-claim settles the finished operation; it never re-decides the job from the event's state now.
  it("a create in flight when the event goes private links the entry, then deletes it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    job = await rerunJob(t, job._id);
    await t.run((ctx) => ctx.db.patch(eventId, { publicationState: "draft_private" }));
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    job = await rerunJob(t, job._id);
    assert.deepEqual([job.state, job.kind, job.lastError], ["done", "export_upsert", undefined]);
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
    const retract = await rerunJob(t, (await pendingJob(t, "export_delete"))._id);
    assert.deepEqual((await operations(t)).at(-1)!.payload, { kind: "delete_calendar_event", calendarEventId: CAL_1 });
    await workerSettle(t, { status: "succeeded" });
    assert.equal((await rerunJob(t, retract._id)).state, "done");
    assert.equal((await linkOf(t, eventId)).state, "vrdex_retracted");
  });

  it("an update in flight when the event goes private still queues the delete", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await t.run((ctx) => ctx.db.patch(eventId, { publicationState: "draft_private" }));
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    job = await rerunJob(t, job._id);
    assert.deepEqual([job.state, job.kind], ["done", "export_upsert"]);
    assert.equal((await linkOf(t, eventId)).state, "linked");
    await rerunJob(t, (await pendingJob(t, "export_delete"))._id);
    assert.deepEqual(await kinds(t), ["update_calendar_event", "delete_calendar_event"]);
  });

  it("a delete in flight when the event is re-published settles, and the re-publish recreates the entry", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    await link(t, connectorId!, eventId);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_delete", eventId });
    await t.run(async (ctx) => {
      await ctx.db.patch(eventId, { publicationState: "published" });
      await enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert");
    });
    await workerSettle(t, { status: "succeeded" });
    job = await rerunJob(t, job._id);
    assert.deepEqual([job.state, job.lastError], ["done", undefined]);
    assert.equal((await linkOf(t, eventId)).state, "vrdex_retracted");
    const again = await rerunJob(t, (await pendingJob(t, "export_upsert"))._id);
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await rerunJob(t, again._id);
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: calId(2) } });
    assert.equal((await rerunJob(t, again._id)).state, "done");
    const row = await linkOf(t, eventId);
    assert.deepEqual([row.externalId, row.state], [calId(2), "linked"]);
  });

  it("a read in flight when the event goes private creates nothing", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await t.run((ctx) => ctx.db.patch(eventId, { publicationState: "draft_private" }));
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(await creates(t), 0);
    assert.equal(await linkOf(t, eventId), undefined);
  });

  it("a missed create is not sent again once the event has gone private", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await rerunJob(t, job._id);
    await t.run(async (ctx) => {
      const create = (await ctx.db.query("clubOperations").collect()).find((op) => op.payload.kind === "create_calendar_event")!;
      await ctx.db.patch(create._id, { state: "missed", code: "late_window_elapsed" });
      await ctx.db.patch(eventId, { publicationState: "draft_private" });
    });
    await expireLease(t, job._id);
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(await creates(t), 1);
  });

  it("never submits a queued write after Disconnect, pause, or Off", async () => {
    for (const patch of [{ state: "removed" }, { state: "paused" }, { direction: "off" }] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t);
      const eventId = await seedEvent(t, communityProfileId);
      await link(t, connectorId!, eventId);
      const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
      await t.run((ctx) => ctx.db.patch(connectorId!, patch));
      assert.equal(await t.mutation(internal.clubOperations.claim, await workerArgs(t)), null);
      const [op] = await operations(t);
      assert.deepEqual([op.state, op.code, op.submittedAt], ["rejected", "connector_inactive", undefined]);
      assert.equal((await rerunJob(t, job._id)).state, "done");
    }
  });

  it("never submits a claimed write once the kind flag is off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const worker = await workerArgs(t);
    const claimed = (await t.mutation(internal.clubOperations.claim, worker))!;
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    const authorization = await t.mutation(internal.clubOperations.authorizeSubmission, {
      ...worker, operationId: claimed.operationId, nonce: claimed.nonce,
      authority: { groupId: GROUP_ID, userId: BOT_ID, ownerUserId: "usr_99999999-9999-9999-9999-999999999999", membershipStatus: "member", permissions: ["group-calendar-manage"], observedAt: Date.now() },
    });
    assert.deepEqual(authorization, { authorized: false, code: "connector_inactive" });
    const [op] = await operations(t);
    assert.deepEqual([op.state, op.submittedAt], ["rejected", undefined]);
  });

  it("an export left queued by a switch to import writes nothing and leaves the link alone", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const linked = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, linked, { lastExportedHash: "before" });
    await t.run((ctx) => ctx.db.patch(connectorId!, { direction: "import" }));
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: linked })).state, "done");
    assert.equal((await linkOf(t, linked)).lastExportedHash, "before");
    assert.deepEqual(await kinds(t), []);
    // The switch can also land while the export's read is in flight.
    await t.run((ctx) => ctx.db.patch(connectorId!, { direction: "export" }));
    const unlinked = await seedEvent(t, communityProfileId, { slug: "bass-temple-late", title: "Late Night" });
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: unlinked });
    await t.run((ctx) => ctx.db.patch(connectorId!, { direction: "import" }));
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(await linkOf(t, unlinked), undefined);
    assert.equal(await creates(t), 0);
  });

  it("never matches an entry linked to another event", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const first = await seedEvent(t, communityProfileId);
    const second = await seedEvent(t, communityProfileId, { slug: "bass-temple-late", startAt: Date.parse("2026-11-08T04:30:00.000Z"), endAt: Date.parse("2026-11-08T07:00:00.000Z") });
    await link(t, connectorId!, first);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: second });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    assert.deepEqual((await operations(t)).at(-1)!.payload.kind, "create_calendar_event");
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: calId(2) } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal((await linkOf(t, first)).externalId, CAL_1);
    assert.equal((await linkOf(t, second)).externalId, calId(2));
  });

  it("a replaced group refuses the operation and pauses the connector", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId, integrationId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await t.run((ctx) => ctx.db.patch(integrationId, { vrchatGroupId: "grp_99999999-9999-9999-9999-999999999999" }));
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId!)))!;
    assert.deepEqual([job.lastError, connector.state, connector.lastError], ["integration_unavailable", "paused", "integration_unavailable"]);
    assert.deepEqual(await kinds(t), []);
  });

  it("pauses the connector when the calendar feature is off", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { features: ["posts"] });
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId!)))!;
    assert.deepEqual([job.lastError, connector.state, connector.lastError], ["feature_disabled", "paused", "feature_disabled"]);
  });

  const rejectAtPreflight = async (t: TestConvex<typeof schema>) => {
    const worker = await workerArgs(t);
    const claimed = (await t.mutation(internal.clubOperations.claim, worker))!;
    await t.mutation(internal.clubOperations.rejectClaim, { ...worker, operationId: claimed.operationId, nonce: claimed.nonce, code: "visibility" });
  };

  it("a 404 before submission never flags the link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await rejectAtPreflight(t);
    const after = await rerunJob(t, job._id);
    assert.deepEqual([after.state, after.lastError], ["pending", "visibility"]);
    assert.equal((await linkOf(t, eventId)).state, "linked");
  });

  it("a 404 before submission never counts a delete as done", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { publicationState: "draft_private" });
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_delete", eventId });
    await rejectAtPreflight(t);
    const after = await rerunJob(t, job._id);
    assert.deepEqual([after.state, after.lastError], ["pending", "visibility"]);
    assert.equal((await linkOf(t, eventId)).state, "linked");
  });

  it("a cancelled export's 404 before submission never counts as gone", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { eventStatus: "cancelled" });
    await link(t, connectorId!, eventId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await rejectAtPreflight(t);
    assert.deepEqual((await rerunJob(t, job._id)).lastError, "visibility");
    assert.equal((await linkOf(t, eventId)).externalId, CAL_1);
  });

  it("a stall emails ops at once under the runner's key, and the next success resolves it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    await link(t, connectorId!, eventId);
    const started = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await expireLease(t, started._id, { payload: { ...(started.payload as object), waitingSince: NOW - 6 * 3_600_000 - 1 } });
    const job = await rerunJob(t, started._id);
    assert.equal(job.lastError, "vrchat_operation_stalled");
    const alert = async () => (await t.run((ctx) => ctx.db.query("opsAlerts").withIndex("by_key", (q) => q.eq("key", failureAlertKey(connectorId!))).unique()))!;
    assert.equal((await alert()).resolvedAt, undefined);
    const mail = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) => f.name === "opsAlertEmail:send");
    assert.equal(mail.length, 1);
    const { subject, body } = mail[0]!.args[0] as { subject: string; body: string };
    assert.equal(subject, "[VRDex ops] Event connector failing");
    assert.ok(body.includes(connectorId!) && body.includes("vrchat_operation_stalled"));
    assert.ok(!body.includes("Bass Temple") && !body.includes("vrdex.test"));
    await workerSettle(t, { status: "succeeded", result: { calendarEventId: CAL_1 } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(typeof (await alert()).resolvedAt, "number");
  });

  it("never creates an entry for an event that has started", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { eventDate: "2026-11-02", startAt: NOW - 3_600_000, endAt: NOW + 3_600_000, sortAt: NOW - 3_600_000 });
    assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId })).state, "done");
    assert.deepEqual(await kinds(t), []);
    assert.equal((await linkOf(t, eventId)).externalId, "none:" + eventId);
  });

  it("drops the create when the start passes during the read", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const lapsed = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId: lapsed });
    await t.run((ctx) => ctx.db.patch(lapsed, { eventDate: "2026-11-02", startAt: NOW - 1, endAt: NOW + 3_600_000 }));
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.equal(await creates(t), 0);
    assert.equal((await linkOf(t, lapsed)).externalId, "none:" + lapsed);
  });

  it("deletes the read once the export has used it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await rerunJob(t, job._id);
    assert.deepEqual(await kinds(t), ["create_calendar_event"]);
  });

  it("a used read leaves nothing for a retry to chase when the write is refused", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId, integrationId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [] } });
    await t.run((ctx) => ctx.db.patch(integrationId, { enabledFeatures: ["posts"] }));
    const after = await rerunJob(t, job._id);
    assert.equal(after.lastError, "feature_disabled");
    assert.equal((after.payload as VrchatJobPayload).operationId, undefined);
  });
});

describe("vrchat calendar import", () => {
  beforeEach(setupEnv);
  const long = "Bass Temple presents an extremely long night of low frequencies and friends";
  const importItem = (t: TestConvex<typeof schema>, connectorId: Id<"eventConnectors">, item: VrchatCalendarItem) =>
    runSyncJob(t, { connectorId, kind: "import_item", payload: { item } });
  const importIds = async (t: TestConvex<typeof schema>) =>
    (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_item").map((j) => (j.payload as { item: VrchatCalendarItem }).item.id).sort();
  const at = (date: string) => ({ eventDate: date, startAt: Date.parse(`${date}T23:00:00.000Z`), endAt: Date.parse(`${date}T23:30:00.000Z`) });

  it("poll diff: new and changed items import, unchanged items do not, missing linked items flag", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    const ins = (eventId: Id<"events">, externalId: string, externalUpdatedAt?: number) => t.run((ctx) => ctx.db.insert("eventSyncLinks",
      { connectorId: connectorId!, eventId, externalId, externalUpdatedAt, lastExportedAt: NOW - 3_600_000, state: "linked", createdAt: NOW - 3_600_000, updatedAt: NOW }));
    const changed = await ins(await seedEvent(t, communityProfileId, { slug: "changed", title: "Changed Night", ...at("2026-11-10") }), calId(2), Date.parse("2026-11-01T00:00:00.000Z"));
    await ins(await seedEvent(t, communityProfileId, { slug: "same", title: "Same Night", ...at("2026-11-11") }), calId(3), Date.parse("2026-11-02T11:00:00.000Z"));
    const gone = await ins(await seedEvent(t, communityProfileId, { slug: "gone", title: "Gone Night", ...at("2026-11-12") }), calId(4));
    // A none: link records that no VRChat entry exists, so it is never flagged deleted.
    const noneEvent = await seedEvent(t, communityProfileId, { slug: "none", title: "None Night", ...at("2026-11-13") });
    const none = await ins(noneEvent, "none:" + noneEvent);
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
    assert.deepEqual((await operations(t))[0].payload, { kind: "list_calendar_events", from: "2026-11-02T00:00:00.000Z", to: "2027-01-31T00:00:00.000Z" });
    await workerSettle(t, { status: "succeeded", result: { calendarEventsTruncated: false, calendarEvents: [
      vrchatItem({ id: CAL_1, title: "Fresh Night" }), vrchatItem({ id: calId(2), title: "Changed Night Late" }), vrchatItem({ id: calId(3), title: "Same Night" }),
    ] } });
    job = await rerunJob(t, job._id);
    assert.equal(job.state, "done");
    assert.deepEqual(await importIds(t), [CAL_1, calId(2)]);
    assert.equal((await t.run((ctx) => ctx.db.get(gone)))!.state, "external_deleted");
    assert.equal((await t.run((ctx) => ctx.db.get(changed)))!.state, "linked");
    assert.equal((await t.run((ctx) => ctx.db.get(none)))!.state, "linked");
    assert.equal((await t.run((ctx) => ctx.db.get(connectorId!)))!.lastSyncedAt, NOW);
  });

  it("a link exported after the list was read is not flagged, and a truncated list flags nothing", async () => {
    for (const [lastExportedAt, truncated] of [[NOW + 1_000, false], [NOW - 3_600_000, true]] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
      const eventId = await seedEvent(t, communityProfileId, at("2026-11-12"));
      const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: calId(4), lastExportedAt, state: "linked", createdAt: NOW - 3_600_000, updatedAt: NOW }));
      const job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
      await workerSettle(t, { status: "succeeded", result: { calendarEvents: [], calendarEventsTruncated: truncated } });
      assert.equal((await rerunJob(t, job._id)).state, "done");
      assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
    }
  });

  it("ignores its own export coming back", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    const lastExportedHash = carriedFieldsHash("vrchat_calendar", await t.run((ctx) => correctionFields(ctx.db, event)));
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked",
      lastExportedHash, createdAt: NOW, updatedAt: NOW }));
    // The strict item validator has no accessType, so only the fields VRChat hands back are carried over.
    const { title, description, startsAt, endsAt } = exportPayloadFromEvent(event, { eventUrl: EVENT_URL, worldNames: [] });
    const item = vrchatItem({ title, description, startsAt, endsAt, updatedAt: "2026-11-02T11:59:59.000Z" });
    assert.equal(await t.mutation(internal.vrchatCalendarConnector.applyImport, { connectorId: connectorId!, item }), "skipped_echo");
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.updatedAt, event.updatedAt);
    assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.externalUpdatedAt, Date.parse("2026-11-02T11:59:59.000Z"));
  });

  it("a VRChat time change keeps the full VRDex title", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { title: long });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW }));
    await importItem(t, connectorId!, vrchatItem({ title: truncateTitle(long), startsAt: "2026-11-08T02:00:00.000Z", endsAt: "2026-11-08T05:00:00.000Z", updatedAt: "2026-11-02T11:59:59.000Z" }));
    const event = (await t.run((ctx) => ctx.db.get(eventId)))!;
    assert.deepEqual([event.title, event.startAt], [long, Date.parse("2026-11-08T02:00:00.000Z")]);
  });

  it("bidirectional: the newer side wins by VRChat updatedAt", async () => {
    for (const [eventUpdatedAt, itemUpdatedAt, title] of [[NOW - 60_000, "2026-11-02T11:59:59.000Z", "Bass Temple Late"], [NOW, "2026-11-02T11:00:00.000Z", "Bass Temple"]] as const) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
      const eventId = await seedEvent(t, communityProfileId, { updatedAt: eventUpdatedAt });
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW }));
      await importItem(t, connectorId!, vrchatItem({ title: "Bass Temple Late", updatedAt: itemUpdatedAt }));
      assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.title, title);
    }
  });

  it("skips past items", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    const past = vrchatItem({ startsAt: "2026-10-30T23:00:00.000Z", endsAt: "2026-10-31T02:00:00.000Z" });
    assert.equal((await importItem(t, connectorId!, past)).state, "done");
    assert.equal(await t.mutation(internal.vrchatCalendarConnector.applyImport, { connectorId: connectorId!, item: past }), "skipped");
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
  });

  it("skips items whose times do not parse without failing the job", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    for (const bad of [{ startsAt: "soon" }, { updatedAt: "lately" }]) {
      assert.equal(await t.mutation(internal.vrchatCalendarConnector.applyImport, { connectorId: connectorId!, item: vrchatItem(bad) }), "skipped");
    }
    // A malformed entry is still in the list, so its link is not flagged deleted.
    const linkTo = async (slug: string, date: string, externalId: string) => {
      const eventId = await seedEvent(t, communityProfileId, { slug, ...at(date) });
      return t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId, lastExportedAt: NOW - 3_600_000, state: "linked", createdAt: NOW - 3_600_000, updatedAt: NOW }));
    };
    const links = [await linkTo("bad-start", "2026-11-10", CAL_1), await linkTo("bad-updated", "2026-11-11", calId(2))];
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem({ startsAt: "soon" }), vrchatItem({ id: calId(2), updatedAt: "lately" })] } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.deepEqual(await importIds(t), []);
    for (const linkId of links) assert.equal((await t.run((ctx) => ctx.db.get(linkId)))!.state, "linked");
  });

  it("a VRChat edit behind a pending draft is not marked seen, so a later poll retries it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, authorityUserId } = await seedVrchatConnector(t, { direction: "import", mode: "hold" });
    const draftId = await t.run((ctx) => ctx.db.insert("eventIntakeDrafts", { actorUserId: authorityUserId, version: 1, fields: {}, provenance: [], connectorId: connectorId!, createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 86_400_000 }));
    const before = Date.parse("2026-11-01T00:00:00.000Z");
    const linkId = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, draftId, externalId: CAL_1, externalUpdatedAt: before, lastImportedAt: before, state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal(await t.mutation(internal.vrchatCalendarConnector.applyImport, { connectorId: connectorId!, item: vrchatItem() }), "skipped_pending_draft");
    const link = (await t.run((ctx) => ctx.db.get(linkId)))!;
    assert.deepEqual([link.externalUpdatedAt, link.lastImportedAt], [before, before]);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    assert.deepEqual(await importIds(t), [CAL_1]);
  });

  it("never matches a draft, cancelled, or moderation-removed twin", async () => {
    for (const hidden of [{ publicationState: "draft_private" }, { eventStatus: "cancelled" }, { moderationRemovedAt: NOW }] as Partial<Doc<"events">>[]) {
      const t = convexTest({ schema, modules });
      const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional", mode: "hold" });
      const twin = await seedEvent(t, communityProfileId, hidden);
      const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
      await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
      await rerunJob(t, job._id);
      assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).length, 0);
      assert.deepEqual(await importIds(t), [CAL_1]);
      assert.equal(await t.mutation(internal.vrchatCalendarConnector.applyImport, { connectorId: connectorId!, item: vrchatItem() }), "draft");
      const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
      assert.notEqual(link.eventId, twin);
    }
  });

  it("reconcile links by date and title without creating", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [
      vrchatItem({ title: "BASS TEMPLE" }), vrchatItem({ id: calId(2), title: "Other Night", startsAt: "2026-11-09T01:00:00.000Z", endsAt: "2026-11-09T04:00:00.000Z" }),
    ] } });
    await rerunJob(t, job._id);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId]), [[CAL_1, eventId]]);
    assert.equal((await t.run((ctx) => ctx.db.query("events").collect())).length, 1);
    assert.deepEqual(await importIds(t), [calId(2)]);
  });

  it("reconcile does not match an event already linked to another entry", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: calId(5), state: "linked", createdAt: NOW, updatedAt: NOW }));
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem({ id: calId(5) }), vrchatItem()] } });
    await rerunJob(t, job._id);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => l.externalId), [calId(5)]);
    assert.deepEqual(await importIds(t), [CAL_1]);
  });

  it("deletes a list once it has been read", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "import_poll" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    assert.equal((await rerunJob(t, job._id)).state, "done");
    assert.deepEqual(await operations(t), []);
  });

  it("matches on the event's own local date, not the connector's", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    await t.run((ctx) => ctx.db.patch(connectorId!, { target: { groupId: GROUP_ID, timezone: "Pacific/Auckland" } }));
    // 20:00 on the 7th in New York is already the 8th in Auckland.
    const elsewhere = await seedEvent(t, communityProfileId, { slug: "bass-temple-nov-8", eventDate: "2026-11-08", startAt: Date.parse("2026-11-09T01:00:00.000Z"), endAt: Date.parse("2026-11-09T04:00:00.000Z") });
    const eventId = await seedEvent(t, communityProfileId);
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => l.eventId), [eventId]);
    assert.notEqual(links[0]!.eventId, elsewhere);
  });

  const dateOnly = { scheduleKind: "date_only" as const, startAt: undefined, endAt: undefined };

  it("reconcile reuses a date-only event's none: link on a bidirectional connector", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, dateOnly);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: "none:" + eventId, state: "linked", lastExportedHash: "stale", createdAt: NOW, updatedAt: NOW }));
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.eventId, l.externalId, l.state, l.lastExportedAt, l.lastExportedHash]), [[eventId, CAL_1, "linked", undefined, undefined]]);
    assert.deepEqual(await importIds(t), []);
  });

  it("never deletes an organiser's entry it only paired with a date-only event, on this export or the next", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, dateOnly);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: "none:" + eventId, state: "linked", lastExportedAt: NOW - 60_000, lastExportedHash: "stale", createdAt: NOW, updatedAt: NOW }));
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    // The import has not applied, so the event is still date-only when these exports run.
    for (let run = 0; run < 2; run += 1) {
      assert.equal((await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId })).state, "done");
      assert.deepEqual((await operations(t)).map((op) => op.payload.kind), []);
      const [row] = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
      assert.deepEqual([row.externalId, row.state, row.lastExportedAt, row.lastExportedHash], [CAL_1, "linked", undefined, undefined]);
    }
  });

  it("a cancelled event still deletes an entry it only paired", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, { ...dateOnly, eventStatus: "cancelled" });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: CAL_1, state: "linked", createdAt: NOW, updatedAt: NOW }));
    await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual((await operations(t)).map((op) => op.payload), [{ kind: "delete_calendar_event", calendarEventId: CAL_1 }]);
  });

  it("an import reuses a date-only event's none: link", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t, { direction: "bidirectional" });
    const eventId = await seedEvent(t, communityProfileId, dateOnly);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: "none:" + eventId, state: "linked", createdAt: NOW, updatedAt: NOW }));
    assert.equal((await importItem(t, connectorId!, vrchatItem())).state, "done");
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.map((l) => [l.eventId, l.externalId]), [[eventId, CAL_1]]);
  });

  it("an export-only reconcile leaves a none: link alone", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, dateOnly);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId: connectorId!, eventId, externalId: "none:" + eventId, state: "linked", createdAt: NOW, updatedAt: NOW }));
    const job = await runSyncJob(t, { connectorId: connectorId!, kind: "reconcile" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [vrchatItem()] } });
    await rerunJob(t, job._id);
    assert.deepEqual((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).map((l) => l.externalId), ["none:" + eventId]);
  });

  it("enqueuePolls skips export-only connectors and connectors already polling", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId, authorityUserId } = await seedVrchatConnector(t, { direction: "import" });
    await t.run((ctx) => ctx.db.insert("eventConnectors", { communityProfileId, kind: "vrchat_calendar", direction: "export", mode: "autopublish",
      authorityUserId, target: { groupId: GROUP_ID }, state: "active", createdAt: NOW, updatedAt: NOW }));
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    const polls = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_poll");
    assert.deepEqual(polls.map((j) => j.connectorId), [connectorId]);
    // With the flag off nothing is enqueued, even once the earlier poll finished.
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    await t.run((ctx) => ctx.db.patch(polls[0]._id, { state: "done" }));
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_poll").length, 1);
  });

  it("enqueuePolls still sees a queued poll behind a backlog of import jobs", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await seedVrchatConnector(t, { direction: "import" });
    await t.run(async (ctx) => {
      const job = { connectorId: connectorId!, dueAt: NOW, attempts: 0, state: "pending" as const, createdAt: NOW, updatedAt: NOW };
      for (let index = 0; index < 150; index++) await ctx.db.insert("eventSyncJobs", { ...job, kind: "import_item", payload: { item: vrchatItem({ id: calId(index) }) } });
      await ctx.db.insert("eventSyncJobs", { ...job, kind: "import_poll", payload: null });
    });
    await t.mutation(internal.vrchatCalendarConnector.enqueuePolls, {});
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.kind === "import_poll").length, 1);
  });
});

describe("vrchat calendar connect gate", () => {
  beforeEach(setupEnv);
  const args = (communityProfileId: Id<"profiles">) => ({ communityProfileId, kind: "vrchat_calendar" as const, direction: "export" as const, mode: "hold" as const, target: { timezone: "America/New_York", groupId: "grp_99999999-9999-9999-9999-999999999999" } });
  const connectors = (t: TestConvex<typeof schema>) => t.run((ctx) => ctx.db.query("eventConnectors").collect());

  it("refuses without an assigned collector account or the calendar feature", async () => {
    for (const options of [{ assigned: false }, { features: ["posts"] }]) {
      const t = convexTest({ schema, modules });
      const { communityProfileId } = await seedVrchatConnector(t, { ...options, connector: false });
      await assert.rejects(asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_UNAVAILABLE/);
      assert.deepEqual(await asOwner(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: true, ready: false });
    }
  });

  it("refuses an authority without manage_events", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { authority: "integrations_only", connector: false });
    await assert.rejects(asStaff(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_FORBIDDEN/);
    assert.equal((await connectors(t)).length, 0);
    assert.deepEqual(await asStaff(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: true, ready: false });
  });

  it("accepts staff holding both manage_integrations and manage_events", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { authority: "integrations_only", connector: false });
    await t.run(async (ctx) => {
      const role = (await ctx.db.query("communityRoles").first())!;
      await ctx.db.patch(role._id, { permissions: ["manage_integrations", "manage_events"] });
    });
    assert.deepEqual(await asStaff(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: true, ready: true });
    await asStaff(t).mutation(api.eventConnectors.create, args(communityProfileId));
    assert.equal((await connectors(t)).length, 1);
  });

  it("refuses with the kind flag off", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    await assert.rejects(asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId)), /CONNECTOR_UNAVAILABLE/);
    assert.deepEqual(await asOwner(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: false, ready: false });
  });

  it("availability requires connector authority and reports a ready community", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    await t.run((ctx) => ctx.db.insert("users", { clerkUserId: "staff" }));
    await assert.rejects(asStaff(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), /CONNECTOR_FORBIDDEN/);
    assert.deepEqual(await asOwner(t).query(api.vrchatCalendarConnector.availability, { communityProfileId }), { enabled: true, ready: true });
  });

  it("creates with the integration's group and enqueues a reconcile", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    const connectorId = await asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId));
    assert.deepEqual((await t.run((ctx) => ctx.db.get(connectorId)))!.target, { groupId: GROUP_ID, timezone: "America/New_York" });
    assert.deepEqual((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).map((j) => j.kind), ["reconcile"]);
  });

  it("takes a timezone-only target, ignores a caller's calendar, and falls back to UTC", async () => {
    const stored = async (target: Record<string, string>) => {
      const t = convexTest({ schema, modules });
      const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
      const connectorId = await asOwner(t).mutation(api.eventConnectors.create, { ...args(communityProfileId), target });
      return (await t.run((ctx) => ctx.db.get(connectorId)))!.target;
    };
    assert.deepEqual(await stored({ timezone: "Asia/Tokyo" }), { groupId: GROUP_ID, timezone: "Asia/Tokyo" });
    assert.deepEqual(await stored({ timezone: "Asia/Tokyo", calendarId: "cal", groupName: "Renamed" }), { groupId: GROUP_ID, timezone: "Asia/Tokyo" });
    assert.deepEqual(await stored({ timezone: "Not/AZone" }), { groupId: GROUP_ID, timezone: "UTC" });
    assert.deepEqual(await stored({}), { groupId: GROUP_ID, timezone: "UTC" });
  });

  // The owner's connector, paused, with a staffer who holds only manage_integrations.
  async function pausedForResume(t: TestConvex<typeof schema>) {
    const { connectorId } = await seedVrchatConnector(t, { authority: "integrations_only" });
    const owner = await t.run(async (ctx) => {
      const { userId } = (await ctx.db.query("profileOwners").first())!;
      await ctx.db.patch(connectorId!, { state: "paused", lastError: "authority_lost", authorityUserId: userId });
      return userId;
    });
    return { connectorId: connectorId!, owner };
  }

  it("refuses a resume by an authority without manage_events and leaves the connector unchanged", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId } = await pausedForResume(t);
    const before = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    await assert.rejects(asStaff(t).mutation(api.eventConnectors.update, { connectorId, state: "active" }), /CONNECTOR_FORBIDDEN/);
    assert.deepEqual(await t.run((ctx) => ctx.db.get(connectorId)), before);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).length, 0);
  });

  it("still lets that staffer change a paused connector's direction, and the owner resume it", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, owner } = await pausedForResume(t);
    await asStaff(t).mutation(api.eventConnectors.update, { connectorId, direction: "bidirectional" });
    await asOwner(t).mutation(api.eventConnectors.update, { connectorId, state: "active" });
    const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    assert.deepEqual([connector.state, connector.lastError, connector.authorityUserId, connector.direction], ["active", undefined, owner, "bidirectional"]);
    assert.deepEqual((await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).map((j) => j.kind), ["reconcile"]);
  });

  it("hides the calendar feature while the kind flag is off, without touching what is stored", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId, integrationId } = await seedVrchatConnector(t, { connector: false });
    const features = async () => (await asOwner(t).query(api.clubConnection.get, { communityProfileId, freshnessNonce: "n" }))!.features.map((row) => row.feature);
    assert.ok((await features()).includes("calendar"));
    process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED = "false";
    assert.ok(!(await features()).includes("calendar"));
    assert.deepEqual((await t.run((ctx) => ctx.db.get(integrationId)))!.enabledFeatures, ["calendar"]);
  });

  it("refuses a second live connector for the group whatever group the caller names", async () => {
    const t = convexTest({ schema, modules });
    const { communityProfileId } = await seedVrchatConnector(t, { connector: false });
    await asOwner(t).mutation(api.eventConnectors.create, args(communityProfileId));
    await assert.rejects(asOwner(t).mutation(api.eventConnectors.create, { ...args(communityProfileId), target: { timezone: "UTC" } }), /CONNECTOR_EXISTS/);
    assert.equal((await connectors(t)).length, 1);
  });
});
