import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import schemaModule from "../../convex/schema";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { carriedFieldsHash } from "../../convex/_eventConnectors";
import { correctionFields } from "../../convex/eventCorrections";
import { exportPayloadFromEvent, fieldsFromVrchatEvent, truncateTitle } from "../../convex/eventSyncKinds/vrchatCalendar";
import type { VrchatJobPayload } from "../../convex/vrchatCalendarConnector";
import {
  CAL_1, EVENT_URL, NOW, SITE, eventDoc, modules, operations, rerunJob, runSyncJob, seedEvent, seedVrchatConnector, setupEnv, vrchatItem, workerSettle,
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

  it("no link: reads the dates first, then creates with a truncated title and no notification field", async () => {
    const t = convexTest({ schema, modules });
    const { connectorId, communityProfileId } = await seedVrchatConnector(t);
    const eventId = await seedEvent(t, communityProfileId, { title: long, endAt: undefined });
    let job = await runSyncJob(t, { connectorId: connectorId!, kind: "export_upsert", eventId });
    assert.deepEqual([job.state, job.attempts, job.leaseExpiresAt], ["running", 0, NOW + 30 * 60_000]);
    assert.deepEqual((await operations(t))[0].payload, { kind: "list_calendar_events", from: "2026-11-06T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z" });
    await workerSettle(t, { status: "succeeded", result: { calendarEvents: [], calendarEventsTruncated: false } });
    job = await rerunJob(t, job._id);
    const create = (await operations(t))[1];
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
    const update = ops[1].payload as { kind: string; calendarEventId: string; imageUrl?: string };
    assert.deepEqual([ops.length, update.kind, update.calendarEventId, update.imageUrl], [2, "update_calendar_event", CAL_1, SITE + "/posters/bass.png"]);
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
    assert.equal((await operations(t))[2].payload.kind, "list_calendar_events");
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
    await link(t, connectorId!, eventId);
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
    assert.deepEqual([(await operations(t)).length, await creates(t)], [2, 1]);
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
});
