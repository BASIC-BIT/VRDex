import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { enqueueSeriesSync, seriesHash, seriesSyncFields } from "../../convex/_eventSeriesSync";
import { internal } from "../../convex/_generated/api";
import { occurrence, occurrences } from "./_eventSeriesFixture";
import { NOW, runSyncJob, schema, seedEvent, seedGoogleConnector } from "./_googleCalendarFixture";
import { applySeries, clearJobs, SERIES_FIELDS, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

describe("external series", () => {
  beforeEach(setupSeriesEnv);
  const seriesLinks = (t: TestConvex<typeof schema>) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect()).then((l) => l.filter((x) => x.eventId === undefined));

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
    assert.ok(links.some((l) => l.externalId === "m1:2026-11-07" && l.eventId));
  });

  it("links an existing series by title", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const existing = await seedSeries(t, communityProfileId, staffUserId, { title: "BASS TEMPLE" });
    const result = await applySeries(t, connectorId);
    assert.deepEqual([result.outcome, result.seriesId], ["linked", existing]);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 1);
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

  it("treats bounds that fail series validation as outside the fixed set", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    assert.equal((await applySeries(t, connectorId, { fields: { endsOn: "2026-11-01" } })).outcome, "skipped");
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
  });

  it("skips export-only connectors", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "export" });
    assert.equal((await applySeries(t, connectorId)).outcome, "skipped");
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

  it("runs a series job, records the series link, and queues the nights the series export does not carry", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    await t.run((ctx) => ctx.db.patch(n14._id, { overrides: ["summary"] }));
    await clearJobs(t);
    // Google has no exportSeries yet: the job completes and writes nothing.
    assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } })).state, "done");
    assert.equal((await seriesLinks(t)).length, 0);

    const series = (await t.run((ctx) => ctx.db.get(seriesId)))!;
    const jobId = await t.run((ctx) => ctx.db.insert("eventSyncJobs", { connectorId, kind: "export_upsert", payload: { seriesId }, dueAt: NOW, attempts: 1, state: "running", createdAt: NOW, updatedAt: NOW }));
    await t.mutation(internal.eventSync.completeJob, { jobId, externalId: "s1", exportedHash: seriesHash(seriesSyncFields(series)), durationMs: 0 });
    const [link] = await seriesLinks(t);
    assert.deepEqual([link.externalId, link.externalSeriesId, link.seriesId, link.state], ["s1", "s1", seriesId, "linked"]);
    const queued = await t.run((ctx) => ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", (q) => q.eq("connectorId", connectorId)).collect());
    assert.deepEqual(queued.filter((j) => j.state === "pending").map((j) => [j.eventId, j.kind]), [[n14._id, "export_upsert"]]);
  });
});
