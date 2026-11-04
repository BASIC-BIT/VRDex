import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { enqueueSeriesSync, seriesHash, seriesSyncFields } from "../../convex/_eventSeriesSync";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { syncKindHandlers } from "../../convex/eventSyncKinds/index";
import { occurrence, occurrences } from "./_eventSeriesFixture";
import { NOW, runSyncJob, schema, seedEvent, seedGoogleConnector } from "./_googleCalendarFixture";
import { applySeries, clearJobs, SERIES_FIELDS, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

describe("external series", () => {
  beforeEach(setupSeriesEnv);
  type T = TestConvex<typeof schema>;
  const seriesLinks = (t: T) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect()).then((l) => l.filter((x) => x.eventId === undefined));
  const pendingJobs = (t: T) => t.run((ctx) => ctx.db.query("eventSyncJobs").collect()).then((j) => j.filter((x) => x.state === "pending"));
  const runningSeriesJob = (t: T, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">) =>
    t.run((ctx) => ctx.db.insert("eventSyncJobs", { connectorId, kind: "export_upsert", payload: { seriesId }, dueAt: NOW, attempts: 1, state: "running", createdAt: NOW, updatedAt: NOW }));
  const later = (minutes: number) => Date.parse("2026-11-02T11:00:00.000Z") + minutes * 60_000;

  it("hashes what a round trip keeps", () => {
    const venue = "V".repeat(130);
    assert.equal(seriesHash({ ...SERIES_FIELDS, venueLabel: venue }), seriesHash({ ...SERIES_FIELDS, venueLabel: venue.slice(0, 120) }));
    const until = { ...SERIES_FIELDS, endsOn: "2027-01-30" };
    assert.equal(seriesHash({ ...until, count: 12 }), seriesHash(until));
    assert.notEqual(seriesHash({ ...SERIES_FIELDS, count: 12 }), seriesHash(SERIES_FIELDS));
  });

  it("creates one series, materialises its nights, and writes the series link", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const result = await applySeries(t, connectorId);
    const series = (await t.run((ctx) => ctx.db.get(result.seriesId!)))!;
    assert.equal(result.outcome, "created");
    assert.deepEqual([series.communityProfileId, series.authorityUserId, series.rule, series.startsOn, series.horizonDays], [communityProfileId, staffUserId, SERIES_FIELDS.rule, "2026-11-07", 60]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const [link] = await seriesLinks(t);
    assert.deepEqual([link.externalId, link.externalSeriesId, link.seriesId, link.lastExportedHash], ["m1", "m1", series._id, seriesHash(SERIES_FIELDS)]);
  });

  it("is unchanged on redelivery and fans a time edit out to nights that have not overridden it", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    assert.equal((await applySeries(t, connectorId)).outcome, "unchanged");
    const n21 = await occurrence(t, seriesId!, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { overrides: ["startAt"] }));
    const later = Date.parse("2026-11-02T11:45:00.000Z");
    const result = await applySeries(t, connectorId, { externalUpdatedAt: later, fields: { rule: { ...SERIES_FIELDS.rule, startTime: "21:00" } } });
    assert.equal(result.outcome, "updated");
    assert.equal((await occurrence(t, seriesId!, "2026-11-14")).startAt, Date.parse("2026-11-15T02:00:00.000Z"));
    assert.equal((await occurrence(t, seriesId!, "2026-11-21")).startAt, Date.parse("2026-11-22T01:00:00.000Z"));
  });

  it("keeps a doors time no source carries", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    await t.run((ctx) => ctx.db.patch(seriesId!, { rule: { ...SERIES_FIELDS.rule, doorsTime: "19:30" } }));
    // As the runner records it after exporting the series with its doors time.
    const exported = seriesHash(seriesSyncFields((await t.run((ctx) => ctx.db.get(seriesId!)))!));
    const [link] = await seriesLinks(t);
    await t.run((ctx) => ctx.db.patch(link._id, { lastExportedHash: exported }));
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: Date.parse("2026-11-02T11:30:00.000Z") })).outcome, "echo");
    const later = Date.parse("2026-11-02T11:45:00.000Z");
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: later, fields: { rule: { ...SERIES_FIELDS.rule, startTime: "21:00" } } })).outcome, "updated");
    assert.equal((await t.run((ctx) => ctx.db.get(seriesId!)))!.rule.doorsTime, "19:30");
  });

  it("flags the series link and every future night on deletion, and never ends the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    const result = await applySeries(t, connectorId, { externalUpdatedAt: Date.parse("2026-11-02T11:50:00.000Z"), deleted: true });
    assert.equal(result.outcome, "flagged");
    assert.equal((await t.run((ctx) => ctx.db.get(seriesId!)))!.state, "active");
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(links.length, 9);
    assert.ok(links.every((l) => l.state === "external_deleted"));
    const n07 = await occurrence(t, seriesId!, "2026-11-07");
    assert.ok(links.some((l) => l.externalId === "none:" + n07._id && l.eventId === n07._id && l.externalSeriesId === "m1"));
  });

  it("flags a night with a placeholder that never takes a leftover phase-one link's ID", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    await applySeries(t, connectorId);
    // A night the grouping migration left outside the series still holds the `{id}:{date}` shape.
    const other = await seedEvent(t, communityProfileId, { title: "Other Night", slug: "other-night", eventDate: "2026-11-14", startAt: Date.parse("2026-11-14T20:00:00-05:00") });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: other, externalId: "m1:2026-11-14", externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    await applySeries(t, connectorId, { externalUpdatedAt: later(50), deleted: true });
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(new Set(links.map((l) => l.externalId)).size, links.length);
    assert.equal(links.filter((l) => l.externalId === "m1:2026-11-14").length, 1);
  });

  it("reads a deletion of an ended series as its own end coming back", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const { seriesId } = await applySeries(t, connectorId);
    await t.run((ctx) => ctx.db.patch(seriesId!, { state: "ended" }));
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: later(50), deleted: true })).outcome, "echo");
    assert.ok((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).every((l) => l.state === "linked"));
  });

  it("keeps a VRDex edit newer than the source on a bidirectional connector", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    await applySeries(t, connectorId);
    const edit = { fields: { rule: { ...SERIES_FIELDS.rule, startTime: "21:00" } } };
    // Newer than the link's last import, older than the series' own update at NOW.
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: NOW - 60_000, ...edit })).outcome, "unchanged");
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: NOW + 60_000, ...edit })).outcome, "updated");
  });

  it("reads the series' own values back as an echo before completeJob records the export", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    await applySeries(t, connectorId);
    const [link] = await seriesLinks(t);
    await t.run((ctx) => ctx.db.patch(link._id, { lastExportedHash: "an-older-export" }));
    assert.equal((await applySeries(t, connectorId, { externalUpdatedAt: later(30) })).outcome, "echo");
  });

  it("links an existing series by title", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const existing = await seedSeries(t, communityProfileId, staffUserId, { title: "BASS TEMPLE" });
    const result = await applySeries(t, connectorId);
    assert.deepEqual([result.outcome, result.seriesId], ["linked", existing]);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 1);
    // The baseline: linking applied nothing, so the next delivery of the same fields is an echo.
    assert.equal((await seriesLinks(t))[0].lastExportedHash, seriesHash(SERIES_FIELDS));
  });

  it("gives a second external series of the same title its own series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const first = await applySeries(t, connectorId);
    const second = await t.mutation(internal.eventSeriesSync.applyExternalSeries, { connectorId, externalSeriesId: "m2", externalUpdatedAt: NOW, deleted: false, fields: SERIES_FIELDS });
    assert.equal(second.outcome, "created");
    assert.notEqual(second.seriesId, first.seriesId);
    assert.equal((await seriesLinks(t)).length, 2);
  });

  it("turns a one-off link into a night link when its item becomes recurring", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const eventId = await seedEvent(t, communityProfileId);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const { seriesId } = await applySeries(t, connectorId);
    assert.equal((await t.run((ctx) => ctx.db.get(eventId)))!.seriesId, seriesId);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", (q) => q.eq("connectorId", connectorId)).collect());
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId, l.seriesId, l.externalSeriesId]).sort(), [["m1", undefined, seriesId, "m1"], ["m1_20261108T010000Z", eventId, seriesId, "m1"]]);
  });

  it("keeps external IDs unique when phase one already linked the first instance", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const eventId = await seedEvent(t, communityProfileId);
    const instanceEventId = await seedEvent(t, communityProfileId, { slug: "bass-temple-nov-7-2" });
    await t.run(async (ctx) => {
      await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("eventSyncLinks", { connectorId, eventId: instanceEventId, externalId: "m1_20261108T010000Z", externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW });
    });
    await applySeries(t, connectorId);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(new Set(links.map((l) => l.externalId)).size, links.length);
    assert.equal(links.find((l) => l.eventId === eventId)!.externalId, "none:" + eventId);
  });

  it("treats bounds that fail series validation as outside the fixed set", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    assert.equal((await applySeries(t, connectorId, { fields: { endsOn: "2026-11-01" } })).outcome, "skipped");
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
  });

  it("skips export-only connectors, and every connector with the series gate off", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "export" });
    assert.equal((await applySeries(t, connectorId)).outcome, "skipped");
    const importer = await seedGoogleConnector(t, { direction: "import" });
    process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
    assert.equal((await applySeries(t, importer.connectorId)).outcome, "skipped");
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
  });

  it("queues the series export from every series write path", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { communityProfileId } = await seedGoogleConnector(t, { direction: "export" });
    await seedEvent(t, communityProfileId);
    const staff = t.withIdentity({ subject: "staff", issuer: "test", tokenIdentifier: "test|staff", emailVerified: true });
    const seriesJobs = async () => (await pendingJobs(t)).filter((j) => j.eventId === undefined).length;
    const { seriesId } = await staff.mutation(api.eventSeries.create, { eventSlug: "bass-temple-nov-7", repeat: { frequency: "weekly" } });
    assert.equal(await seriesJobs(), 1, "create");
    await clearJobs(t);
    await staff.mutation(api.eventSeries.update, { seriesId, summary: "New night." });
    assert.equal(await seriesJobs(), 1, "update");
    await clearJobs(t);
    await staff.mutation(api.eventSeries.end, { seriesId });
    assert.equal(await seriesJobs(), 1, "end");
  });

  it("enqueues one series job per series-capable export connector, once, and none with either flag off", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const seriesJobs = () => t.run((ctx) => ctx.db.query("eventSyncJobs").collect()).then((j) => j.filter((x) => x.eventId === undefined));
    await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
    await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
    assert.deepEqual((await seriesJobs()).map((j) => [j.connectorId, j.kind, j.payload]), [[connectorId, "export_upsert", { seriesId }]]);
    for (const flag of ["VRDEX_RECURRING_EVENTS_ENABLED", "VRDEX_CONNECTOR_SERIES_ENABLED"]) {
      Object.assign(process.env, { VRDEX_RECURRING_EVENTS_ENABLED: "true", VRDEX_CONNECTOR_SERIES_ENABLED: "true", [flag]: "false" });
      await clearJobs(t);
      await t.run((ctx) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId));
      assert.equal((await seriesJobs()).length, 0, flag);
    }
  });

  it("runs a series job through the kind's exportSeries only with the series gate on, then queues the nights the series export does not carry", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run(async (ctx) => {
      await ctx.db.patch(n14._id, { overrides: ["summary"] });
      // Retired: an overridden night the follow-up must still leave alone.
      await ctx.db.patch(n21._id, { overrides: ["summary"], publicationState: "draft_private", seriesRetiredAt: NOW });
    });
    await clearJobs(t);
    const google = syncKindHandlers.google_calendar;
    const exported: string[] = [];
    // Restored, not deleted: Google's real exportSeries serves later tests in this process.
    const original = google.exportSeries;
    google.exportSeries = async (_ctx, _connector, series) => { exported.push(series._id); return { externalId: "s1" }; };
    try {
      process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
      assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } })).state, "done");
      assert.deepEqual([exported, await seriesLinks(t)], [[], []]);
      process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "true";
      assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } })).state, "done");
    } finally {
      google.exportSeries = original;
    }
    assert.deepEqual(exported, [seriesId]);
    const series = (await t.run((ctx) => ctx.db.get(seriesId)))!;
    const [link] = await seriesLinks(t);
    assert.deepEqual([link.externalId, link.externalSeriesId, link.seriesId, link.state, link.lastExportedHash], ["s1", "s1", seriesId, "linked", seriesHash(seriesSyncFields(series))]);
    assert.deepEqual((await pendingJobs(t)).map((j) => [j.eventId, j.kind]), [[n14._id, "export_upsert"]]);
  });

  it("rewrites both IDs on every series export and sends an edit made while the job ran", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    await t.run((ctx) => ctx.db.patch(n14._id, { overrides: ["summary"] }));
    await clearJobs(t);
    const hash = seriesHash(seriesSyncFields((await t.run((ctx) => ctx.db.get(seriesId)))!));
    await t.mutation(internal.eventSync.completeJob, { jobId: await runningSeriesJob(t, connectorId, seriesId), externalId: "none:" + seriesId, exportedHash: hash, durationMs: 0 });
    // No copy on the source: nothing for the nights to write to.
    assert.deepEqual(await pendingJobs(t), []);
    await t.mutation(internal.eventSync.completeJob, { jobId: await runningSeriesJob(t, connectorId, seriesId), externalId: "s1", exportedHash: "before-an-edit", durationMs: 0 });
    const links = await seriesLinks(t);
    assert.deepEqual(links.map((l) => [l.externalId, l.externalSeriesId]), [["s1", "s1"]]);
    assert.deepEqual((await pendingJobs(t)).map((j) => [j.eventId, j.payload]), [[undefined, { seriesId }], [n14._id, null]]);
  });

  it("keeps one row per external ID when an early echo gave the new ID to a duplicate series, and leaves that series for staff (I2)", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const duplicate = await seedSeries(t, communityProfileId, staffUserId);
    const duplicateLink = await t.run(async (ctx) => {
      await ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: "none:" + seriesId, externalSeriesId: "none:" + seriesId, state: "linked", createdAt: NOW, updatedAt: NOW });
      return await ctx.db.insert("eventSyncLinks", { connectorId, seriesId: duplicate, externalId: "s1", externalSeriesId: "s1", state: "linked", createdAt: NOW, updatedAt: NOW });
    });
    const warn = context.mock.method(console, "warn", () => undefined);
    await t.mutation(internal.eventSync.completeJob, { jobId: await runningSeriesJob(t, connectorId, seriesId), externalId: "s1", exportedHash: "h", durationMs: 0 });
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual(links.filter((l) => l.externalId === "s1").map((l) => [l.seriesId, l.eventId]), [[seriesId, undefined]]);
    const released = links.find((l) => l._id === duplicateLink)!;
    assert.deepEqual([released.externalId, released.state], ["none:" + duplicate, "external_deleted"]);
    // The duplicate and its nights stay public; its nights show on the staff-attention list.
    assert.ok((await t.run((ctx) => ctx.db.get(duplicate)))?.state === "active");
    const flagged = links.filter((l) => l.eventId && l.state === "external_deleted");
    assert.ok(flagged.length > 0 && flagged.every((l) => l.externalSeriesId === "none:" + duplicate && l.externalId === "none:" + l.eventId));
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments[0]), ["SERIES_EXPORT_ID_TAKEN"]);
  });

  it("keeps the failure streak through a series job that writes nothing", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const gone = await seedSeries(t, communityProfileId, staffUserId, { title: "Gone Night" });
    await t.run(async (ctx) => {
      await ctx.db.delete(gone);
      await ctx.db.patch(connectorId, { consecutiveFailures: 3, lastError: "google_500" });
    });
    const streak = async () => {
      const connector = (await t.run((ctx) => ctx.db.get(connectorId)))!;
      return [connector.consecutiveFailures, connector.lastError];
    };
    const google = syncKindHandlers.google_calendar;
    const original = google.exportSeries;
    try {
      // The series gate off, the series gone, and a kind with no series export.
      process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
      process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "true";
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId: gone } });
      google.exportSeries = undefined;
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
      assert.deepEqual(await streak(), [3, "google_500"]);
      // An unchanged answer is no write either; a real one clears the streak.
      google.exportSeries = async () => ({ externalId: "s1", unchanged: true });
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
      assert.deepEqual(await streak(), [3, "google_500"]);
      google.exportSeries = async () => ({ externalId: "s1" });
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    } finally {
      google.exportSeries = original;
    }
    assert.deepEqual(await streak(), [0, undefined]);
  });
});
