import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { seriesHash } from "../../convex/_eventSeriesSync";
import { internal } from "../../convex/_generated/api";
import { occurrence, occurrences } from "./_eventSeriesFixture";
import { fakeFetch, runSyncJob, schema, seedEvent, seedGoogleConnector } from "./_googleCalendarFixture";
import { googleInstance, importGoogle, MASTER, masterFetch, SERIES_FIELDS, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

describe("google series import", () => {
  beforeEach(setupSeriesEnv);
  type T = TestConvex<typeof schema>;
  const onlySeries = (t: T) => t.run((ctx) => ctx.db.query("eventSeries").collect()).then(([s]) => s!);
  const allLinks = (t: T) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect());

  it("imports a weekly master as one series and links each instance to its night", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    await importGoogle(t, connectorId, googleInstance("2026-11-14"));
    fake.restore();
    const series = await onlySeries(t);
    assert.deepEqual([series.title, series.rule], ["Bass Temple", SERIES_FIELDS.rule]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const nightLinks = (await allLinks(t)).filter((l) => l.eventId);
    assert.deepEqual(nightLinks.map((l) => [l.externalId, l.seriesId, l.externalSeriesId, l.eventId]).sort(), [
      ["m1_20261108T010000Z", series._id, "m1", (await occurrence(t, series._id, "2026-11-07"))._id],
      ["m1_20261115T010000Z", series._id, "m1", (await occurrence(t, series._id, "2026-11-14"))._id],
    ]);
    // Each instance is read against its master: one read per item job (a poll shares one).
    assert.equal(fake.calls.length, 2);
  });

  it("imports an exception instance as overrides on its night only", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { summary: "Bass Temple Live", start: { dateTime: "2026-11-21T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    const series = await onlySeries(t);
    const n21 = await occurrence(t, series._id, "2026-11-21");
    assert.deepEqual([n21.title, n21.startAt, [...n21.overrides!].sort()], ["Bass Temple Live", Date.parse("2026-11-22T02:00:00.000Z"), ["startAt", "title"]]);
    assert.deepEqual((await occurrence(t, series._id, "2026-11-14")).overrides, []);
  });

  it("fans a master edit out and leaves overridden nights alone", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    // Read first: a t.run inside a t.run deadlocks (B19).
    const n21 = await occurrence(t, series._id, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { overrides: ["startAt"] }));
    master = { ...MASTER, start: { dateTime: "2026-11-07T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:45:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { start: { dateTime: "2026-11-14T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:45:00.000Z" }));
    // Google sends every instance the edit moved, the overridden night's too; it says only what the master says (C5).
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { start: { dateTime: "2026-11-21T21:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:45:00.000Z" }));
    fake.restore();
    assert.equal((await onlySeries(t)).rule.startTime, "21:00");
    assert.equal((await occurrence(t, series._id, "2026-11-28")).startAt, Date.parse("2026-11-29T02:00:00.000Z"));
    assert.equal((await occurrence(t, series._id, "2026-11-21")).startAt, Date.parse("2026-11-22T01:00:00.000Z"));
    assert.deepEqual((await occurrence(t, series._id, "2026-11-14")).overrides, []);
  });

  it("applies an exception that arrives with a series edit", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    // Past NOW: a bidirectional connector keeps the series' own edit (made at NOW) over an older source one (C4).
    master = { ...MASTER, location: "The Big Temple", updated: "2026-11-02T12:45:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { location: "The Big Temple", updated: "2026-11-02T12:45:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-28", { location: "The Big Temple", summary: "Bass Temple Live", updated: "2026-11-02T12:40:00.000Z" }));
    fake.restore();
    const n28 = await occurrence(t, (await onlySeries(t))._id, "2026-11-28");
    assert.deepEqual([n28.title, n28.venueLabel, n28.overrides], ["Bass Temple Live", "The Big Temple", ["title"]]);
  });

  it("lands an exception edit on an overridden night that arrives with a series edit", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    await importGoogle(t, connectorId, googleInstance("2026-11-28", { summary: "Bass Temple Live", updated: "2026-11-02T11:10:00.000Z" }));
    // Past every source time, so the bidirectional guards compare real clocks.
    context.mock.timers.setTime(Date.parse("2026-11-02T12:50:00.000Z"));
    master = { ...MASTER, location: "The Big Temple", updated: "2026-11-02T12:45:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { location: "The Big Temple", updated: "2026-11-02T12:45:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-28", { location: "The Big Temple", summary: "Bass Temple Live II", updated: "2026-11-02T12:40:00.000Z" }));
    fake.restore();
    const n28 = await occurrence(t, (await onlySeries(t))._id, "2026-11-28");
    assert.deepEqual([n28.title, n28.venueLabel, n28.overrides], ["Bass Temple Live II", "The Big Temple", ["title"]]);
  });

  it("keeps a VRDex series edit that beat the master off every night", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    const nights = await occurrences(t, series._id);
    // As a series edit fans out: one write time on the series and on every night it changed.
    const vrdexAt = Date.parse("2026-11-02T12:30:00.000Z");
    await t.run(async (ctx) => {
      await ctx.db.patch(series._id, { venueLabel: "VRDex Hall", updatedAt: vrdexAt });
      for (const night of nights) await ctx.db.patch(night._id, { venueLabel: "VRDex Hall", updatedAt: vrdexAt });
    });
    context.mock.timers.setTime(Date.parse("2026-11-02T12:40:00.000Z"));
    master = { ...MASTER, location: "Google Hall", updated: "2026-11-02T12:20:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { location: "Google Hall", updated: "2026-11-02T12:20:00.000Z" }));
    fake.restore();
    const n14 = await occurrence(t, series._id, "2026-11-14");
    assert.deepEqual([(await onlySeries(t)).venueLabel, n14.venueLabel, n14.overrides], ["VRDex Hall", "VRDex Hall", []]);
  });

  it("keeps a night edit made after the series over an older exception", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const n21 = await occurrence(t, (await onlySeries(t))._id, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "VRDex Night", overrides: ["title"], updatedAt: Date.parse("2026-11-02T12:30:00.000Z") }));
    context.mock.timers.setTime(Date.parse("2026-11-02T12:40:00.000Z"));
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { summary: "Google Night", updated: "2026-11-02T12:20:00.000Z" }));
    fake.restore();
    assert.equal((await occurrence(t, n21.seriesId!, "2026-11-21")).title, "VRDex Night");
  });

  it("flags a single cancelled instance without touching the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-14"));
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { status: "cancelled", updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    const [link] = await t.run((ctx) => ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", (q) => q.eq("connectorId", connectorId).eq("externalId", "m1_20261115T010000Z")).collect());
    assert.equal(link!.state, "external_deleted");
    assert.equal((await occurrence(t, (await onlySeries(t))._id, "2026-11-14")).eventStatus, "scheduled");
  });

  it("keeps phase-one expansion for a rule outside the fixed set, with the flag off, and in hold mode", async () => {
    for (const setup of [
      { master: { ...MASTER, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"] }, flag: "true", seriesFlag: "true", mode: "autopublish", gets: 1 },
      { master: MASTER, flag: "false", seriesFlag: "true", mode: "autopublish", gets: 0 },
      // Prod's configuration: recurring events on, the connector series gate off.
      { master: MASTER, flag: "true", seriesFlag: "false", mode: "autopublish", gets: 0 },
      { master: MASTER, flag: "true", seriesFlag: "true", mode: "hold", gets: 0 },
      // A BYDAY that is not the master's own weekday would lose the master's night.
      { master: { ...MASTER, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"] }, flag: "true", seriesFlag: "true", mode: "autopublish", gets: 1 },
      // A zone Intl refuses is bad source data, never a throw.
      { master: { ...MASTER, start: { dateTime: "2026-11-07T20:00:00-05:00", timeZone: "Not/A_Zone" } }, flag: "true", seriesFlag: "true", mode: "autopublish", gets: 1 },
    ] as const) {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId } = await seedGoogleConnector(t, { direction: "import", mode: setup.mode });
      process.env.VRDEX_RECURRING_EVENTS_ENABLED = setup.flag;
      process.env.VRDEX_CONNECTOR_SERIES_ENABLED = setup.seriesFlag;
      const fake = fakeFetch(masterFetch(setup.master));
      await importGoogle(t, connectorId, googleInstance("2026-11-07"));
      fake.restore();
      assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
      const [link] = await allLinks(t);
      assert.deepEqual([link!.externalId, link!.externalSeriesId, link!.seriesId], ["m1_20261108T010000Z", "m1", undefined]);
      assert.equal(fake.calls.filter((c) => c.url.pathname.endsWith("/events/m1")).length, setup.gets);
    }
  });

  it("imports through a poll with one master fetch, keeping each instance's original start", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    // Moved to the Sunday: only originalStartTime still names the Saturday night.
    const moved = googleInstance("2026-11-14", { start: { dateTime: "2026-11-15T20:00:00-05:00", timeZone: "America/New_York" }, end: { dateTime: "2026-11-15T23:00:00-05:00", timeZone: "America/New_York" }, updated: "2026-11-02T11:30:00.000Z" });
    const fake = fakeFetch((request) => request.url.pathname.endsWith("/events")
      ? Response.json({ items: [googleInstance("2026-11-07", { updated: "2026-11-02T11:30:00.000Z" }), moved], nextSyncToken: "s1", timeZone: "America/New_York" })
      : masterFetch(MASTER)(request));
    await runSyncJob(t, { connectorId, kind: "import_poll" });
    fake.restore();
    const series = await onlySeries(t);
    assert.equal((await occurrence(t, series._id, "2026-11-14")).startAt, Date.parse("2026-11-16T01:00:00.000Z"));
    assert.equal((await allLinks(t)).filter((l) => l.eventId && l.seriesId === series._id).length, 2);
    assert.equal(fake.calls.filter((c) => c.url.pathname.endsWith("/events/m1")).length, 1);
  });

  it("gives a night's own link the instance ID instead of adding a second link", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    const n14 = await occurrence(t, series._id, "2026-11-14");
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, seriesId: series._id, externalId: "none:" + n14._id, lastExportedHash: "h", state: "linked", createdAt: 0, updatedAt: 0 }));
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { updated: "2026-11-02T11:30:00.000Z" }));
    const links = (await allLinks(t)).filter((l) => l.eventId === n14._id);
    assert.deepEqual(links.map((l) => [l.externalId, l.externalSeriesId, l.lastExportedHash]), [["m1_20261115T010000Z", "m1", undefined]]);

    // The instance's row already names a stray copy: it moves to the night, and the night keeps one link.
    const n21 = await occurrence(t, series._id, "2026-11-21");
    const { communityProfileId } = (await t.run((ctx) => ctx.db.get(connectorId)))!;
    const stray = await seedEvent(t, communityProfileId, { slug: "bass-temple-stray", eventDate: "2026-11-21", startAt: Date.parse("2026-11-22T01:00:00.000Z"), endAt: Date.parse("2026-11-22T04:00:00.000Z") });
    await t.run(async (ctx) => {
      await ctx.db.insert("eventSyncLinks", { connectorId, eventId: stray, externalId: "m1_20261122T010000Z", state: "linked", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("eventSyncLinks", { connectorId, eventId: n21._id, seriesId: series._id, externalId: "none:" + n21._id, state: "linked", createdAt: 0, updatedAt: 0 });
    });
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    const after = await allLinks(t);
    assert.deepEqual(after.filter((l) => l.eventId === n21._id).map((l) => l.externalId), ["m1_20261122T010000Z"]);
    assert.equal(after.filter((l) => l.eventId === stray).length, 0);
  });

  it("flags a linked series whose master leaves the fixed set, and then only stores its instances' cancellations", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    let master = MASTER;
    const fake = fakeFetch((request) => masterFetch(master)(request));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    master = { ...MASTER, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"], updated: "2026-11-02T11:30:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { summary: "Changed", updated: "2026-11-02T11:30:00.000Z" }));
    const links = await allLinks(t);
    assert.ok(links.length > 1 && links.every((l) => l.state === "external_deleted"));
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { summary: "Changed", updated: "2026-11-02T11:20:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-28", { status: "cancelled", updated: "2026-11-02T11:20:00.000Z" }));
    fake.restore();
    const series = await onlySeries(t);
    assert.deepEqual([(await occurrence(t, series._id, "2026-11-14")).title, (await occurrence(t, series._id, "2026-11-21")).title], ["Bass Temple", "Bass Temple"]);
    const n28 = await occurrence(t, series._id, "2026-11-28");
    assert.deepEqual((await allLinks(t)).filter((l) => l.eventId === n28._id).map((l) => [l.externalId, l.state]), [["m1_20261129T010000Z", "external_deleted"]]);
  });

  it("leaves a retired night alone", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    const n14 = await occurrence(t, series._id, "2026-11-14");
    await t.run((ctx) => ctx.db.patch(n14._id, { publicationState: "draft_private" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { summary: "Changed", updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    assert.equal((await occurrence(t, series._id, "2026-11-14")).title, "Bass Temple");
    assert.equal((await allLinks(t)).filter((l) => l.eventId === n14._id).length, 0);
  });

  it("ignores a linked series' items on a held connector", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    await t.run((ctx) => ctx.db.patch(connectorId, { mode: "hold" }));
    const linksBefore = await allLinks(t);
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { summary: "Changed", updated: "2026-11-02T11:30:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-07", { status: "cancelled", updated: "2026-11-02T11:30:00.000Z" }));
    fake.restore();
    assert.deepEqual(await allLinks(t), linksBefore);
    assert.equal((await t.run((ctx) => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
    assert.equal(fake.calls.length, 1);
  });

  it("reads a master edit on a series whose link came from an export", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    // The runner writes no externalUpdatedAt (B15).
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: "m1", externalSeriesId: "m1", state: "linked", lastExportedHash: seriesHash(SERIES_FIELDS), createdAt: 0, updatedAt: 0 }));
    const fake = fakeFetch(masterFetch({ ...MASTER, location: "The Big Temple", updated: "2026-11-02T11:45:00.000Z" }));
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { location: "The Big Temple", updated: "2026-11-02T11:45:00.000Z" }));
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.get(seriesId)))!.venueLabel, "The Big Temple");
  });

  it("restores a deleted series and its nights when the master comes back", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    let master: typeof MASTER | null = MASTER;
    const fake = fakeFetch((request) => master ? masterFetch(master)(request) : new Response(null, { status: 404 }));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    master = null;
    await importGoogle(t, connectorId, googleInstance("2026-11-14", { status: "cancelled", updated: "2026-11-02T11:30:00.000Z" }));
    const flagged = await allLinks(t);
    assert.ok(flagged.length > 1 && flagged.every((l) => l.state === "external_deleted"));
    await t.run(async (ctx) => { for (const link of flagged) await ctx.db.patch(link._id, { flagReviewedAt: 1 }); });
    master = { ...MASTER, updated: "2026-11-02T11:50:00.000Z" };
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { updated: "2026-11-02T11:50:00.000Z" }));
    fake.restore();
    const restored = await allLinks(t);
    assert.deepEqual(restored.filter((l) => l.state !== "linked" || l.flagReviewedAt !== undefined), []);
    assert.equal(restored.length, flagged.length);
  });

  it("tags a reconcile match with its master, and leaves a linked series' instances to the import path", async () => {
    const before = convexTest({ schema, modules: seriesSyncModules });
    const seeded = await seedGoogleConnector(before, { direction: "import" });
    await seedEvent(before, seeded.communityProfileId, { slug: "bass-temple-nov-14", eventDate: "2026-11-14", startAt: Date.parse("2026-11-15T01:00:00.000Z"), endAt: Date.parse("2026-11-15T04:00:00.000Z") });
    await before.mutation(internal.googleCalendarConnector.reconcileItems, { connectorId: seeded.connectorId, items: [googleInstance("2026-11-14")], calendarTimeZone: "America/New_York" });
    assert.deepEqual((await allLinks(before)).map((l) => [l.externalId, l.externalSeriesId]), [["m1_20261115T010000Z", "m1"]]);

    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    fake.restore();
    const linksBefore = (await allLinks(t)).length;
    await t.mutation(internal.googleCalendarConnector.reconcileItems, { connectorId, items: [googleInstance("2026-11-21")], calendarTimeZone: "America/New_York" });
    assert.equal((await allLinks(t)).length, linksBefore);
    const jobs = await t.run((ctx) => ctx.db.query("eventSyncJobs").collect());
    assert.deepEqual(jobs.filter((j) => j.kind === "import_item" && j.state === "pending").map((j) => (j.payload as { item: { id: string } }).item.id), ["m1_20261122T010000Z"]);
  });
});
