import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { occurrence, occurrences } from "./_eventSeriesFixture";
import { fakeFetch, NOW, runSyncJob, schema, type FetchCall } from "./_googleCalendarFixture";
import { clearJobs, discordSeriesEvent, importDiscord, seedDiscordConnector, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

type T = TestConvex<typeof schema>;
const api = "/api/v10/guilds/123456789012345678/scheduled-events";
const SERIES_ID = "900000000000000001";
const LATER = NOW + 60_000;
const BOT = "800000000000000001";

// The guild list answers `list`, a GET by ID finds a scheduled event at `status`, and a write echoes its body with an ID (B13).
// `/users/@me` is the bot, BOT.
function fakeDiscord(state: { list?: unknown[]; status?: number; byId?: Record<string, object> } = {}) {
  let next = 1;
  return fakeFetch(({ method, url, body }: FetchCall) => {
    const id = url.pathname.split("/").at(-1);
    if (method === "GET" && url.pathname === "/api/v10/users/@me") return Response.json({ id: BOT });
    if (method === "GET") return Response.json(url.pathname === api ? (state.list ?? []) : state.byId?.[id!] ?? { id, status: state.status ?? 1 });
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ ...(body as object), id: method === "POST" ? `90000000000000000${next++}` : id });
  });
}
const writes = (calls: FetchCall[]) => calls.filter((call) => call.method !== "GET");
const allLinks = (t: T) => t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
const seriesLink = async (t: T) => (await allLinks(t)).find((link) => link.seriesId && !link.eventId)!;
const allSeries = (t: T) => t.run((ctx) => ctx.db.query("eventSeries").collect());
const nightJobs = async (t: T) => (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((job) => job.eventId && job.state === "pending");

describe("discord scheduled event series", () => {
  beforeEach(setupSeriesEnv);

  it("exports one recurring scheduled event and a one-off for an overridden night", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    fake.restore();
    const [series, oneOff] = writes(fake.calls);
    assert.equal(writes(fake.calls).length, 2);
    assert.deepEqual([series.method, series.url.pathname], ["POST", api]);
    const body = series.body as { name: string; scheduled_start_time: string; recurrence_rule: unknown };
    assert.deepEqual([body.name, body.scheduled_start_time], ["Bass Temple", "2026-11-08T01:00:00.000Z"]);
    assert.deepEqual(body.recurrence_rule, { start: "2026-11-08T01:00:00.000Z", frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, by_month: null, by_month_day: null });
    assert.deepEqual([(oneOff.body as { name: string }).name, "recurrence_rule" in (oneOff.body as object)], ["Bass Temple Live", false]);
  });

  it("posts a one-off for a night with only its summary overridden, beside its own series in the guild list (B11)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { summary: "Guest night.", overrides: ["summary"] }));
    const fake = fakeDiscord({ list: [discordSeriesEvent()] });
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    fake.restore();
    const oneOff = writes(fake.calls)[1]!;
    assert.deepEqual([oneOff.method, (oneOff.body as { name: string }).name, "recurrence_rule" in (oneOff.body as object)], ["POST", "Bass Temple", false]);
  });

  it("cancels the Discord series when the series ends", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await t.run((ctx) => ctx.db.patch(seriesId, { state: "ended", endsOn: "2026-11-02" }));
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    const last = fake.calls.at(-1)!;
    assert.deepEqual([last.method, last.url.pathname, (last.body as { status: number }).status], ["PATCH", `${api}/${SERIES_ID}`, 4]);
  });

  it("cancels only a scheduled Discord series, and reads its own cancel coming back as no deletion (B21)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "bidirectional" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const state = { status: 1 };
    const fake = fakeDiscord(state);
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    // Still active, but past its end date (inclusive: yesterday was its last day).
    await t.run((ctx) => ctx.db.patch(seriesId, { endsOn: "2026-11-01" }));
    state.status = 2;
    fake.calls.length = 0;
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    assert.deepEqual(fake.calls.map((call) => call.method), ["GET"]);
    state.status = 1;
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    assert.deepEqual(fake.calls.map((call) => call.method), ["GET", "GET", "PATCH"]);
    await importDiscord(t, connectorId, "update", discordSeriesEvent({ status: 4 }), { receivedAt: LATER });
    assert.equal((await seriesLink(t)).state, "linked");
    assert.equal((await allLinks(t)).filter((link) => link.state === "external_deleted").length, 0);
  });

  it("falls back to one-offs for a last-weekday series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId, { rule: { frequency: "monthly_weekday", weekday: 6, ordinal: -1, startTime: "20:00", endTime: "23:00" } });
    const fake = fakeDiscord();
    const seriesJob = await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    const night = (await occurrences(t, seriesId))[0]!;
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: night._id });
    fake.restore();
    assert.equal(seriesJob.state, "done");
    assert.equal(writes(fake.calls).length, 1);
    assert.equal("recurrence_rule" in (writes(fake.calls)[0]!.body as object), false);
  });

  it("cancels a live Discord series whose rule turns last-weekday and queues its nights one by one", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "bidirectional" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await t.run((ctx) => ctx.db.patch(seriesId, { rule: { frequency: "monthly_weekday", weekday: 6, ordinal: -1, startTime: "20:00", endTime: "23:00" } }));
    await clearJobs(t);
    // The cancel can come back before the job that sent it completes.
    await importDiscord(t, connectorId, "update", discordSeriesEvent({ status: 4 }), { receivedAt: LATER });
    assert.equal((await seriesLink(t)).state, "linked");
    fake.calls.length = 0;
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    assert.deepEqual(fake.calls.map((call) => [call.method, call.url.pathname, (call.body as { status?: number } | undefined)?.status]), [
      ["GET", `${api}/${SERIES_ID}`, undefined], ["PATCH", `${api}/${SERIES_ID}`, 4],
    ]);
    assert.equal((await seriesLink(t)).externalId, "none:" + seriesId);
    assert.ok((await nightJobs(t)).length > 0);
  });

  it("keeps a night's live copy until the series exists, then retracts it (rules 2 and 4)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: "910000000000000001", state: "linked", lastExportedHash: "h", createdAt: NOW, updatedAt: NOW }));
    await clearJobs(t);
    const fake = fakeDiscord({ byId: { "910000000000000001": { id: "910000000000000001", status: 1, creator_id: BOT } } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    assert.equal(fake.calls.length, 0);
    assert.equal((await allLinks(t)).find((link) => link.eventId === n14._id)!.externalId, "910000000000000001");
    const seriesJobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((job) => (job.payload as { seriesId?: Id<"eventSeries"> } | null)?.seriesId === seriesId);
    assert.equal(seriesJobs.length, 1);
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    assert.ok((await nightJobs(t)).some((job) => job.eventId === n14._id));
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual([fake.calls.at(-1)!.method, fake.calls.at(-1)!.url.pathname], ["DELETE", `${api}/910000000000000001`]);
    assert.equal((await allLinks(t)).find((link) => link.eventId === n14._id)!.externalId, "none:" + n14._id);
  });

  it("keeps an organiser's own one-off on a series night, deleting only the bot's (rule 4)", async () => {
    for (const creator of ["333333333333333333", null]) {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
      const seriesId = await seedSeries(t, communityProfileId, staffUserId);
      const n14 = await occurrence(t, seriesId, "2026-11-14");
      const copy = "910000000000000001";
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: copy, state: "linked", lastExportedHash: "h", createdAt: NOW, updatedAt: NOW }));
      const fake = fakeDiscord({ byId: { [copy]: { id: copy, status: 1, creator_id: creator } } });
      await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
      fake.calls.length = 0;
      await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
      fake.restore();
      assert.deepEqual(fake.calls.map((call) => [call.method, call.url.pathname]), [["GET", `${api}/${copy}`], ["GET", "/api/v10/users/@me"]]);
      assert.equal((await allLinks(t)).find((link) => link.eventId === n14._id)!.externalId, copy);
    }
  });

  it("keeps the scheduled event on a series' final day, before that night's show (I1)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    // NOW is 07:00 on Monday 2 November in New York; the last night is that evening.
    const seriesId = await seedSeries(t, communityProfileId, staffUserId, {
      rule: { frequency: "weekly", weekday: 1, startTime: "20:00", endTime: "23:00" }, startsOn: "2026-11-02", endsOn: "2026-11-02",
    });
    const night = await occurrence(t, seriesId, "2026-11-02");
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: night._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((call) => [call.method, "recurrence_rule" in (call.body as object)]), [["POST", true]]);
    assert.equal((await seriesLink(t)).externalId, SERIES_ID);
  });

  it("leaves a night's copy alone once the organiser made it recurring (M1)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    const copy = "910000000000000001";
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: copy, state: "linked", lastExportedHash: "h", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeDiscord({ byId: { [copy]: discordSeriesEvent({ id: copy }) } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.calls.length = 0;
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((call) => [call.method, call.url.pathname]), [["GET", `${api}/${copy}`]]);
    assert.equal((await allLinks(t)).find((link) => link.eventId === n14._id)!.externalId, copy);
  });

  it("leaves a linked packet without failing when its series or the site URL is gone (M3)", async (context) => {
    const warn = context.mock.method(console, "warn", () => undefined);
    for (const lose of ["series", "siteUrl"] as const) {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
      await importDiscord(t, connectorId, "create", discordSeriesEvent());
      const seriesId = (await seriesLink(t)).seriesId!;
      // setupSeriesEnv restores SITE_URL for the next test.
      if (lose === "series") await t.run((ctx) => ctx.db.delete(seriesId));
      else delete process.env.SITE_URL;
      const job = await importDiscord(t, connectorId, "update", discordSeriesEvent({ name: "Bass Temple Weekly" }), { receivedAt: LATER });
      assert.deepEqual([lose, job.state, job.lastError], [lose, "done", undefined]);
    }
    assert.equal(warn.mock.calls.length, 2);
    assert.equal(warn.mock.calls[0]!.arguments[0], "DISCORD_SERIES_CONTEXT_MISSING");
  });

  it("writes nothing for a series or its nights once Discord deleted the series (B22)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await t.run(async (ctx) => {
      const link = (await ctx.db.query("eventSyncLinks").collect()).find((row) => row.seriesId && !row.eventId)!;
      await ctx.db.patch(link._id, { state: "external_deleted" });
      await ctx.db.patch(seriesId, { title: "Bass Temple Weekly" });
    });
    const n21 = await occurrence(t, seriesId, "2026-11-21");
    await t.run((ctx) => ctx.db.patch(n21._id, { title: "Bass Temple Live", overrides: ["title"] }));
    fake.calls.length = 0;
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n21._id });
    fake.restore();
    assert.equal(fake.calls.length, 0);
  });

  it("leaves the nights of a series exported here to the series in a reconcile (B8)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeDiscord({ list: [discordSeriesEvent()] });
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: (await occurrence(t, seriesId, "2026-11-14"))._id });
    await runSyncJob(t, { connectorId, kind: "reconcile" });
    fake.restore();
    assert.deepEqual((await allLinks(t)).filter((link) => link.externalId.startsWith(SERIES_ID + ":")), []);
  });

  it("never deletes the series' own scheduled event through a night link that names it (rule 4)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "export" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const n14 = await occurrence(t, seriesId, "2026-11-14");
    await t.run(async (ctx) => {
      await ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: SERIES_ID, externalSeriesId: SERIES_ID, lastExportedHash: "h", state: "linked", createdAt: NOW, updatedAt: NOW });
      await ctx.db.insert("eventSyncLinks", { connectorId, eventId: n14._id, externalId: SERIES_ID, state: "linked", createdAt: NOW, updatedAt: NOW });
    });
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", eventId: n14._id });
    fake.restore();
    assert.deepEqual(fake.calls, []);
  });

  it("writes nothing for an imported series whose first night is past the horizon, and flags a cancel of it (C1)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "bidirectional" });
    const start = "2027-02-06T01:00:00+00:00";
    const item = discordSeriesEvent({ scheduled_start_time: start, scheduled_end_time: "2027-02-06T04:00:00+00:00", recurrence_rule: { ...discordSeriesEvent().recurrence_rule!, start } });
    await importDiscord(t, connectorId, "create", item);
    const [series] = await allSeries(t);
    assert.deepEqual([series!.startsOn, (await occurrences(t, series!._id)).length], ["2027-02-06", 0]);
    const jobs = (await t.run((ctx) => ctx.db.query("eventSyncJobs").collect())).filter((job) => job.state === "pending" && (job.payload as { seriesId?: string } | null)?.seriesId);
    assert.equal(jobs.length, 1);
    const before = await seriesLink(t);
    const fake = fakeDiscord();
    assert.equal((await runSyncJob(t, { connectorId, kind: "export_upsert", payload: jobs[0]!.payload })).state, "done");
    fake.restore();
    assert.deepEqual(fake.calls, []);
    const after = await seriesLink(t);
    assert.deepEqual([after.externalId, after.lastExportedHash, after.lastExportedAt], [before.externalId, before.lastExportedHash, before.lastExportedAt]);
    // VRDex sent no cancel, so a cancel from Discord is the organiser's: staff see it.
    await importDiscord(t, connectorId, "update", { ...item, status: 4 }, { receivedAt: LATER });
    assert.equal((await seriesLink(t)).state, "external_deleted");
  });

  it("links an echo that lands before completeJob to the series being exported, never a second series (I2)", async () => {
    // A `none:` link and an old ID, each with the export running.
    for (const [held, running] of [["none:", true], ["910000000000000009", true]] as const) {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "bidirectional" });
      const seriesId = await seedSeries(t, communityProfileId, staffUserId);
      const old = held === "none:" ? "none:" + seriesId : held;
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: old, externalSeriesId: old, state: "linked", createdAt: NOW, updatedAt: NOW }));
      await clearJobs(t);
      // The series job POSTs (a gone event, or a rule Discord can now carry); its echo is applied first.
      const jobId = running && await t.run((ctx) => ctx.db.insert("eventSyncJobs", { connectorId, kind: "export_upsert", payload: { seriesId }, dueAt: NOW, attempts: 1, state: "running", createdAt: NOW, updatedAt: NOW }));
      await importDiscord(t, connectorId, "create", discordSeriesEvent(), { receivedAt: LATER });
      if (jobId) await t.mutation(internal.eventSync.completeJob, { jobId, externalId: SERIES_ID, exportedHash: "h", durationMs: 0 });
      const label = `${held} ${running}`;
      assert.equal((await allSeries(t)).length, 1, label);
      assert.deepEqual((await allLinks(t)).filter((link) => link.externalId === SERIES_ID).map((link) => link.seriesId), [seriesId], label);
    }
  });

  it("gives an organiser's same-title recurring event its own series beside a last-weekday series, and never cancels it", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "bidirectional" });
    // Discord cannot carry a last-weekday rule, so the series' link here names nothing.
    const seriesId = await seedSeries(t, communityProfileId, staffUserId, { rule: { frequency: "monthly_weekday", weekday: 6, ordinal: -1, startTime: "20:00", endTime: "23:00" } });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: "none:" + seriesId, externalSeriesId: "none:" + seriesId, state: "linked", createdAt: NOW, updatedAt: NOW }));
    await clearJobs(t);
    await importDiscord(t, connectorId, "create", discordSeriesEvent(), { receivedAt: LATER });
    const series = await allSeries(t);
    assert.equal(series.length, 2);
    const links = await allLinks(t);
    assert.deepEqual(links.filter((link) => link.externalId === SERIES_ID).map((link) => link.seriesId === seriesId), [false]);
    assert.equal(links.find((link) => link.seriesId === seriesId && !link.eventId)!.externalId, "none:" + seriesId);
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    assert.ok(!fake.calls.some((call) => call.url.pathname.endsWith(SERIES_ID)), "the organiser's event was touched");
  });

  it("imports a weekly recurring scheduled event as one series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    await importDiscord(t, connectorId, "create", discordSeriesEvent());
    const [series] = await allSeries(t);
    assert.deepEqual([series!.title, series!.rule.frequency, series!.endsOn], ["Bass Temple", "weekly", undefined]);
    const starts = (await occurrences(t, series!._id)).map((n) => n.startAt);
    assert.ok(starts.includes(Date.parse("2026-11-08T01:00:00.000Z")) && starts.includes(Date.parse("2026-11-15T01:00:00.000Z")));
    await importDiscord(t, connectorId, "update", discordSeriesEvent({ status: 4 }));
    assert.equal((await allLinks(t)).find((l) => !l.eventId)!.state, "external_deleted");
  });

  it("reads its own export coming back as the series itself (B10)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedDiscordConnector(t, { direction: "bidirectional" });
    const seriesId = await seedSeries(t, communityProfileId, staffUserId);
    const fake = fakeDiscord();
    await runSyncJob(t, { connectorId, kind: "export_upsert", payload: { seriesId } });
    fake.restore();
    const body = writes(fake.calls)[0]!.body as Record<string, unknown> & { recurrence_rule: object; description: string };
    assert.match(body.description, /\/basic-nights\/series\//);
    const before = (await allSeries(t))[0]!;
    await importDiscord(t, connectorId, "update", { ...body, id: SERIES_ID, guild_id: "123456789012345678", status: 1, recurrence_rule: { ...body.recurrence_rule, end: null, by_year_day: null, count: null } } as never, { receivedAt: LATER });
    const after = (await allSeries(t))[0]!;
    assert.deepEqual([after.summary, after.rule, after.timezone, after.updatedAt], [before.summary, before.rule, before.timezone, before.updatedAt]);
  });

  it("uses the packet's receipt time and never replays a reconcile over a linked series (C7)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    await importDiscord(t, connectorId, "create", discordSeriesEvent(), { receivedAt: NOW - 1_000 });
    assert.equal((await seriesLink(t)).externalUpdatedAt, NOW - 1_000);
    await importDiscord(t, connectorId, "create", discordSeriesEvent({ name: "Bass Temple Weekly" }), { receivedAt: LATER, externalIds: [SERIES_ID + ":2026-11-15"] });
    assert.equal((await allSeries(t))[0]!.title, "Bass Temple");
  });

  it("flags a linked series whose rule Discord removed (C8)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    await importDiscord(t, connectorId, "create", discordSeriesEvent());
    await importDiscord(t, connectorId, "update", discordSeriesEvent({ recurrence_rule: null }), { receivedAt: LATER });
    assert.equal((await seriesLink(t)).state, "external_deleted");
    assert.equal((await allLinks(t)).filter((link) => link.externalId === SERIES_ID).length, 1);
  });

  it("expands a rule with a count as phase one did (C19)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    const event = discordSeriesEvent();
    await importDiscord(t, connectorId, "create", { ...event, recurrence_rule: { ...event.recurrence_rule!, count: 3 } });
    assert.equal((await allSeries(t)).length, 0);
    assert.ok((await allLinks(t)).some((link) => link.externalId.startsWith(SERIES_ID + ":")));
  });

  it("keeps phase one on a held connector until a series is linked, then ignores that series (R3)", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const held = await seedDiscordConnector(t, { direction: "import", mode: "hold" });
    await importDiscord(t, held.connectorId, "create", discordSeriesEvent());
    assert.equal((await allSeries(t)).length, 0);
    assert.ok((await allLinks(t)).some((link) => link.externalId.startsWith(SERIES_ID + ":")));

    const u = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(u, { direction: "import" });
    await importDiscord(u, connectorId, "create", discordSeriesEvent());
    await u.run((ctx) => ctx.db.patch(connectorId, { mode: "hold" }));
    await importDiscord(u, connectorId, "update", discordSeriesEvent({ name: "Bass Temple Weekly" }), { receivedAt: LATER });
    await importDiscord(u, connectorId, "update", discordSeriesEvent({ status: 4 }), { receivedAt: LATER + 1 });
    assert.equal((await allSeries(u))[0]!.title, "Bass Temple");
    assert.equal((await seriesLink(u)).state, "linked");
    assert.equal((await u.run((ctx) => ctx.db.query("eventIntakeDrafts").collect())).length, 0);
  });

  it("keeps plan 07's paths with the series gate off", async () => {
    // setupSeriesEnv turns it back on for the next test.
    process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedDiscordConnector(t, { direction: "import" });
    await importDiscord(t, connectorId, "create", discordSeriesEvent());
    assert.equal((await allSeries(t)).length, 0);
    assert.ok((await allLinks(t)).some((link) => link.externalId.startsWith(SERIES_ID + ":")));

    const u = convexTest({ schema, modules: seriesSyncModules });
    const exporter = await seedDiscordConnector(u, { direction: "export" });
    const seriesId = await seedSeries(u, exporter.communityProfileId, exporter.staffUserId);
    const fake = fakeDiscord();
    await runSyncJob(u, { connectorId: exporter.connectorId, kind: "export_upsert", payload: { seriesId } });
    assert.equal(fake.calls.length, 0);
    await runSyncJob(u, { connectorId: exporter.connectorId, kind: "export_upsert", eventId: (await occurrence(u, seriesId, "2026-11-14"))._id });
    fake.restore();
    assert.deepEqual(fake.calls.map((call) => [call.method, call.url.pathname]), [["GET", api], ["POST", api]]);
    assert.equal("recurrence_rule" in (fake.calls[1]!.body as object), false);
  });
});
