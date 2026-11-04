import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { seriesHash } from "../../convex/_eventSeriesSync";
import type { GoogleEventBody } from "../../convex/_googleCalendar";
import { internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { occurrence, occurrences } from "./_eventSeriesFixture";
import { fakeFetch, NOW, runSyncJob, schema, seedEvent, seedGoogleConnector, SITE } from "./_googleCalendarFixture";
import { clearJobs, googleInstance, importGoogle, MASTER, masterFetch, SERIES_FIELDS, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

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

  it("keeps a staff night edit guarded across a later series write that skips that night", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    const n21 = await occurrence(t, series._id, "2026-11-21");
    await t.run(async (ctx) => {
      await ctx.db.patch(n21._id, { title: "VRDex Night", overrides: ["title"], updatedAt: Date.parse("2026-11-02T12:30:00.000Z") });
      // An unrelated series write that does not fan out to n21.
      await ctx.db.patch(series._id, { updatedAt: Date.parse("2026-11-02T12:40:00.000Z") });
    });
    context.mock.timers.setTime(Date.parse("2026-11-02T12:50:00.000Z"));
    await importGoogle(t, connectorId, googleInstance("2026-11-21", { summary: "Google Night", updated: "2026-11-02T12:20:00.000Z" }));
    fake.restore();
    assert.equal((await occurrence(t, series._id, "2026-11-21")).title, "VRDex Night");
  });

  it("applies an exception older than the night the daily cron materialised", async (context) => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "bidirectional" });
    const fake = fakeFetch(masterFetch(MASTER));
    await importGoogle(t, connectorId, googleInstance("2026-11-07"));
    const series = await onlySeries(t);
    // The week-later clock must not send the stored token through a refresh.
    await t.run(async (ctx) => { for (const c of await ctx.db.query("connectorCredentials").collect()) await ctx.db.patch(c._id, { accessTokenExpiresAt: Date.parse("2027-06-01T00:00:00Z") }); });
    context.mock.timers.setTime(Date.parse("2026-11-09T06:20:00.000Z"));
    await t.mutation(internal.eventSeries.materialize, { seriesId: series._id });
    // Made before the cron ran, read in on a later job.
    context.mock.timers.setTime(Date.parse("2026-11-09T07:00:00.000Z"));
    await importGoogle(t, connectorId, googleInstance("2027-01-02", { summary: "Bass Temple NYE", updated: "2026-11-08T12:00:00.000Z" }));
    fake.restore();
    const nye = await occurrence(t, series._id, "2027-01-02");
    assert.deepEqual([nye.title, nye.overrides], ["Bass Temple NYE", ["title"]]);
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

describe("google series export", () => {
  beforeEach(setupSeriesEnv);
  type T = TestConvex<typeof schema>;
  type Link = Doc<"eventSyncLinks">;
  const exported = (body: unknown) => Response.json({ id: "m1", updated: "2026-11-02T12:00:01.000Z", ...(body as object) });
  const allLinks = (t: T) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
  const insertLink = (t: T, link: Omit<Link, "_id" | "_creationTime" | "createdAt" | "updatedAt" | "state"> & { state?: Link["state"] }) =>
    t.run((ctx) => ctx.db.insert("eventSyncLinks", { state: "linked", createdAt: NOW, updatedAt: NOW, ...link }));
  const seriesLink = (t: T, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">, over: Partial<Link> = {}) =>
    insertLink(t, { connectorId, seriesId, externalId: "m1", externalSeriesId: "m1", lastExportedHash: seriesHash(SERIES_FIELDS), ...over });

  it("exports one recurring master, then patches only the overridden night's instance", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    const fake = fakeFetch(({ url, body }) => url.pathname.endsWith("/instances")
      ? Response.json({ items: [googleInstance("2026-11-14"), googleInstance("2026-11-21")] })
      : exported(body));
    await clearJobs(t);
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    const insert = fake.calls.find((c) => c.method === "POST")!.body as GoogleEventBody & { recurrence: string[] };
    assert.deepEqual([insert.summary, insert.recurrence, insert.start], ["Bass Temple", ["RRULE:FREQ=WEEKLY;BYDAY=SA"], { dateTime: "2026-11-08T01:00:00.000Z", timeZone: "America/New_York" }]);
    assert.equal(insert.description.split("\n").at(-1), `${SITE}/basic-nights/series/${seriesId}`);
    const nightJobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.eventId && j.state === "pending");
    assert.deepEqual(nightJobs.map((j) => j.eventId), [n21._id]);
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    assert.equal(fake.calls.filter((c) => c.method === "POST").length, 1);
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    assert.deepEqual([patch.url.pathname, (patch.body as GoogleEventBody).summary], ["/calendar/v3/calendars/cal-1/events/m1_20261122T010000Z", "Bass Temple Live"]);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const links = await allLinks(t);
    assert.deepEqual(links.map((l) => [l.externalId, l.eventId ?? null, l.seriesId ?? null, l.externalSeriesId ?? null]), [
      ["m1", null, seriesId, "m1"], ["m1_20261122T010000Z", n21._id, seriesId, "m1"], ["none:" + n14._id, n14._id, null, null]]);
  });

  it("patches UNTIL when the series ends and does nothing on an unchanged rerun", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeFetch(({ body }) => exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    assert.equal(fake.calls.length, 1);
    await t.run((ctx) => ctx.db.patch(seriesId, { state: "ended", endsOn: "2026-12-05" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    const patch = fake.calls.at(-1)!;
    assert.deepEqual([patch.method, patch.url.pathname, (patch.body as { recurrence: string[] }).recurrence],
      ["PATCH", "/calendar/v3/calendars/cal-1/events/m1", ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"]]);
  });

  it("a night with no series link exports nothing and enqueues the series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await clearJobs(t);
    const fake = fakeFetch(() => new Response("", { status: 500 }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    const pending = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((j) => j.state === "pending");
    assert.deepEqual(pending.map((j) => j.payload), [{ seriesId }]);
  });

  it("retracts a standalone copy once the series exists", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const standalone = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: "standalone-14", state: "linked", lastExportedHash: "old", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(({ method, body }) => method === "DELETE" ? new Response(null, { status: 204 }) : exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual(fake.calls.filter((c) => c.method !== "POST").map((c) => [c.method, c.url.pathname]), [["DELETE", "/calendar/v3/calendars/cal-1/events/standalone-14"]]);
    const after = (await t.run((ctx) => ctx.db.get(standalone)))!;
    assert.deepEqual([after.externalId, after.state], ["none:" + n14._id, "linked"]);
  });

  it("leaves an organiser's entry and an untagged instance of the master in place (R2, B8)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await insertLink(t, { connectorId, eventId: n14._id, externalId: "organiser-14", lastExportedHash: "old", lastImportedAt: NOW });
    await insertLink(t, { connectorId, eventId: n21._id, externalId: "m1_20261122T010000Z", lastExportedHash: "old" });
    const fake = fakeFetch(() => new Response("", { status: 500 }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.deepEqual((await allLinks(t)).filter((l) => l.eventId).map((l) => [l.externalId, l.state]), [["organiser-14", "linked"], ["m1_20261122T010000Z", "linked"]]);
  });

  it("writes nothing for an instance with no overrides, and refinds an overridden night's instance after a time edit (B6, B23)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    await insertLink(t, { connectorId, eventId: n14._id, seriesId, externalSeriesId: "m1", externalId: "m1_20261115T010000Z" });
    // Named for the night's old start: Google renamed it when the series time moved.
    const stale = await insertLink(t, { connectorId, eventId: n21._id, seriesId, externalSeriesId: "m1", externalId: "m1_20261122T000000Z" });
    const fake = fakeFetch(({ method, url, body }) => url.pathname.endsWith("/instances") ? Response.json({ items: [googleInstance("2026-11-21")] })
      : method === "GET" ? new Response("", { status: 404 }) : exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    assert.equal(fake.calls.length, 0);
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => [c.method, c.url.pathname.split("/").pop()]), [["GET", "m1_20261122T000000Z"], ["GET", "instances"], ["PATCH", "m1_20261122T010000Z"]]);
    assert.equal((await t.run((ctx) => ctx.db.get(stale)))!.externalId, "m1_20261122T010000Z");
  });

  it("leaves an instance another event's link holds, so external IDs stay unique", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    const stray = await seedEvent(t, communityProfileId, { slug: "bass-temple-stray", eventDate: "2026-11-21", startAt: Date.parse("2026-11-22T01:00:00.000Z") });
    await insertLink(t, { connectorId, eventId: stray, externalId: "m1_20261122T010000Z" });
    const fake = fakeFetch(({ url, body }) => url.pathname.endsWith("/instances") ? Response.json({ items: [googleInstance("2026-11-21")] }) : exported(body));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET"]);
    assert.deepEqual((await allLinks(t)).filter((l) => l.externalId === "m1_20261122T010000Z").map((l) => l.eventId), [stray]);
  });

  it("writes nothing through a series link the organiser deleted (B22)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId, { state: "external_deleted", lastExportedHash: "old" });
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    const fake = fakeFetch(() => new Response("", { status: 500 }));
    assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } })).state, "done");
    assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id })).state, "done");
    fake.restore();
    assert.equal(fake.calls.length, 0);
  });

  it("inserts a new master when the linked one is gone (B23)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId, { lastExportedHash: "old" });
    const fake = fakeFetch(({ method, body }) => method === "GET" ? new Response("", { status: 410 }) : Response.json({ id: "m2", ...(body as object) }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET", "POST"]);
    assert.deepEqual((await allLinks(t)).filter((l) => !l.eventId).map((l) => [l.externalId, l.externalSeriesId]), [["m2", "m2"]]);
  });

  it("exports a detached night as a one-off, never adopting an instance of the linked series (rule 1, C16)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    await seriesLink(t, connectorId, seriesId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    await t.run((ctx) => ctx.db.patch(n14._id, { seriesId: undefined }));
    const link = await insertLink(t, { connectorId, eventId: n14._id, seriesId, externalSeriesId: "m1", externalId: "none:" + n14._id });
    const fake = fakeFetch(({ method, body }) => method === "GET"
      ? Response.json({ items: [googleInstance("2026-11-14")], timeZone: "America/New_York" })
      : Response.json({ id: "one-off-14", ...(body as object) }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => c.method), ["GET", "POST"]);
    assert.equal((fake.calls[1]!.body as { recurrence?: unknown }).recurrence, undefined);
    const after = (await t.run((ctx) => ctx.db.get(link)))!;
    assert.deepEqual([after.externalId, after.seriesId, after.externalSeriesId], ["one-off-14", undefined, undefined]);
  });

  it("with the series gate off exports a series night as plan 08 did, and never sends a none: ID to Google (B7)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await insertLink(t, { connectorId, eventId: n14._id, seriesId, externalId: "none:" + n14._id });
    await insertLink(t, { connectorId, eventId: n21._id, seriesId, externalId: "none:" + n21._id });
    await t.run((ctx) => ctx.db.patch(n21._id, { publicationState: "draft_private" }));
    const fake = fakeFetch(({ method, body }) => method === "GET"
      ? Response.json({ items: [], timeZone: "America/New_York" })
      : Response.json({ id: "one-off-14", ...(body as object) }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    const deleted = await runSyncJob(t, { connectorId, kind: "export_delete", eventId: n21._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((c) => [c.method, c.url.pathname.split("/").pop()]), [["GET", "events"], ["POST", "events"]]);
    const insert = fake.calls[1]!.body as GoogleEventBody & { recurrence?: unknown };
    assert.deepEqual([insert.summary, insert.recurrence, insert.start.dateTime], ["Bass Temple", undefined, "2026-11-15T01:00:00.000Z"]);
    assert.equal(deleted.state, "done");
  });
});
