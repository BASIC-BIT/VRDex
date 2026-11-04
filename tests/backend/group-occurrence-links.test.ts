import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { convexTest, type TestConvex } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { occurrences } from "./_eventSeriesFixture";
import { fakeFetch, NOW, schema, seedEvent, seedGoogleConnector } from "./_googleCalendarFixture";
import { discordSeriesEvent, googleInstance, MASTER, masterFetch, seedDiscordConnector, SERIES_FIELDS, seedSeries, seriesSyncModules, setupSeriesEnv } from "./_seriesSyncFixture";

type T = TestConvex<typeof schema>;

async function seedNight(t: T, connectorId: Id<"eventConnectors">, communityProfileId: Id<"profiles">, date: string, overrides: { summary?: string; seriesId?: Id<"eventSeries"> } = {}) {
  const startAt = Date.parse(`${date}T20:00:00-05:00`);
  const eventId = await seedEvent(t, communityProfileId, { slug: `bass-temple-${date}`, eventDate: date, startAt, endAt: startAt + 10_800_000, ...overrides });
  await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: googleInstance(date).id, externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
  return eventId;
}

// Not materialised, so the night under test is the only one on its date.
const insertSeries = (t: T, communityProfileId: Id<"profiles">, authorityUserId: Id<"users">) => t.run((ctx) => ctx.db.insert("eventSeries", {
  communityProfileId, authorityUserId, title: "Bass Temple", timezone: "America/New_York", rule: SERIES_FIELDS.rule, startsOn: "2026-11-07",
  horizonDays: 60, state: "active", createdAt: NOW, updatedAt: NOW,
}));

describe("groupOccurrenceLinks", () => {
  beforeEach(setupSeriesEnv);

  it("groups phase-one nights into a series, records overrides, leaves unmappable groups, and is idempotent", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    const nights = [];
    for (const [date, summary] of [["2026-11-07", "Weekly bass night."], ["2026-11-14", "Special"], ["2026-11-21", "Weekly bass night."]] as const) {
      const startAt = Date.parse(`${date}T20:00:00-05:00`);
      const eventId = await seedEvent(t, communityProfileId, { slug: `bass-temple-${date}`, eventDate: date, startAt, endAt: startAt + 10_800_000, summary });
      await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId: googleInstance(date).id, externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
      nights.push(eventId);
    }
    const other = await seedEvent(t, communityProfileId, { title: "Other Night", slug: "other-night", eventDate: "2026-11-09", startAt: Date.parse("2026-11-09T20:00:00-05:00") });
    const otherLink = await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: other, externalId: "m2_20261110T010000Z", externalSeriesId: "m2", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(({ url }) => url.pathname.endsWith("/events/m1") ? Response.json(MASTER)
      : url.pathname.endsWith("/events/m2") ? Response.json({ ...MASTER, id: "m2", summary: "Other Night", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"] })
      : new Response("", { status: 404 }));
    const first = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    const second = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    fake.restore();
    assert.deepEqual([first, second], [{ grouped: ["m1"], unparseable: ["m2"] }, { grouped: [], unparseable: ["m2"] }]);
    const [series, ...more] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    assert.equal(more.length, 0);
    const grouped = await t.run((ctx) => Promise.all(nights.map((id) => ctx.db.get(id))));
    assert.deepEqual(grouped.map((e) => [e!.seriesId, e!.occurrenceDate, e!.overrides]), [
      [series._id, "2026-11-07", []], [series._id, "2026-11-14", ["summary"]], [series._id, "2026-11-21", []]]);
    assert.equal((await occurrences(t, series._id)).length, 8);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(links.filter((l) => !l.eventId && l.seriesId === series._id && l.externalId === "m1").length, 1);
    assert.equal(links.filter((l) => l.externalSeriesId === "m1" && l.eventId && l.seriesId === series._id).length, 3);
    assert.equal((await t.run((ctx) => ctx.db.get(otherLink)))!.seriesId, undefined);
  });

  // C17: a live import may have linked the series before the migration runs, or the community may already have it by title.
  it("tags the nights of a series a live import already linked, and leaves a night of another series alone", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const seriesId = await insertSeries(t, communityProfileId, staffUserId);
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, seriesId, externalId: "m1", externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const otherSeries = await seedSeries(t, communityProfileId, staffUserId, { title: "Elsewhere", startsOn: "2027-06-05" });
    const untagged = await seedNight(t, connectorId, communityProfileId, "2026-11-07");
    const taken = await seedNight(t, connectorId, communityProfileId, "2026-11-14", { seriesId: otherSeries });
    // Started: a night that has happened stays a plain event, as adoption leaves it.
    const past = await seedNight(t, connectorId, communityProfileId, "2026-10-31");
    const fake = fakeFetch(masterFetch(MASTER));
    const first = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    const second = await t.action(internal.migrations.groupOccurrenceLinks, { connectorId });
    fake.restore();
    assert.deepEqual([first, second], [{ grouped: ["m1"], unparseable: [] }, { grouped: [], unparseable: [] }]);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 2);
    const [night, kept, old] = await t.run((ctx) => Promise.all([ctx.db.get(untagged), ctx.db.get(taken), ctx.db.get(past)]));
    assert.deepEqual([night!.seriesId, night!.occurrenceDate, kept!.seriesId, old!.seriesId], [seriesId, "2026-11-07", otherSeries, undefined]);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.deepEqual([untagged, taken, past].map((id) => links.find((l) => l.eventId === id)!.seriesId), [seriesId, undefined, undefined]);
  });

  it("links a community series of the same title rather than creating a second", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId, staffUserId } = await seedGoogleConnector(t, { direction: "import" });
    const seriesId = await insertSeries(t, communityProfileId, staffUserId);
    const night = await seedNight(t, connectorId, communityProfileId, "2026-11-07");
    const fake = fakeFetch(masterFetch(MASTER));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: ["m1"], unparseable: [] });
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 1);
    assert.equal((await t.run((ctx) => ctx.db.get(night)))!.seriesId, seriesId);
    const links = await t.run((ctx) => ctx.db.query("eventSyncLinks").collect());
    assert.equal(links.filter((l) => !l.eventId && l.seriesId === seriesId && l.externalId === "m1").length, 1);
  });

  it("groups a Discord recurring event's expanded nights", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedDiscordConnector(t, { direction: "import" });
    const discord = discordSeriesEvent();
    const night = await seedEvent(t, communityProfileId, { slug: "bass-temple-2026-11-07", eventDate: "2026-11-07", startAt: Date.parse("2026-11-08T01:00:00Z"), endAt: Date.parse("2026-11-08T04:00:00Z") });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: night, externalId: `${discord.id}:2026-11-08`, externalSeriesId: discord.id, state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(({ url }) => url.pathname.endsWith(`/scheduled-events/${discord.id}`) ? Response.json(discord) : new Response("", { status: 404 }));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: [discord.id], unparseable: [] });
    fake.restore();
    const [series] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    const grouped = (await t.run((ctx) => ctx.db.get(night)))!;
    // The night is stored in New York on the 7th; in the UTC series it is the 8th's night, so no second night appears there.
    assert.deepEqual([series.timezone, grouped.seriesId, grouped.occurrenceDate], ["UTC", series._id, "2026-11-08"]);
    const nights = await occurrences(t, series._id);
    assert.deepEqual([nights.length, nights.filter((n) => n.startAt === grouped.startAt).length], [8, 1]);
  });

  it("keeps a moved Google instance on its original date and records the move", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    // The 14 November instance, moved on Google to the Sunday.
    const startAt = Date.parse("2026-11-15T20:00:00-05:00");
    const moved = await seedEvent(t, communityProfileId, { slug: "bass-temple-moved", eventDate: "2026-11-15", startAt, endAt: startAt + 10_800_000 });
    await t.run((ctx) => ctx.db.insert("eventSyncLinks", { connectorId, eventId: moved, externalId: googleInstance("2026-11-14").id, externalSeriesId: "m1", state: "linked", createdAt: NOW, updatedAt: NOW }));
    const fake = fakeFetch(masterFetch(MASTER));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: ["m1"], unparseable: [] });
    fake.restore();
    const [series] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
    const night = (await t.run((ctx) => ctx.db.get(moved)))!;
    assert.deepEqual([night.occurrenceDate, night.overrides], ["2026-11-14", ["endAt", "startAt"]]);
    const nights = await occurrences(t, series._id);
    assert.deepEqual([nights.length, nights.filter((n) => n.occurrenceDate === "2026-11-14").length], [8, 1]);
  });

  // A linked night joins as it is: left out, its date would be empty and materialising would make a public twin.
  for (const [label, state] of [["cancelled", { eventStatus: "cancelled" }], ["draft_private", { publicationState: "draft_private" }]] as const) {
    it(`attaches a ${label} night as it is, with no twin on its date`, async () => {
      const t = convexTest({ schema, modules: seriesSyncModules });
      const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
      const night = await seedNight(t, connectorId, communityProfileId, "2026-11-14");
      await t.run((ctx) => ctx.db.patch(night, state));
      const fake = fakeFetch(masterFetch(MASTER));
      assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: ["m1"], unparseable: [] });
      fake.restore();
      const [series] = await t.run((ctx) => ctx.db.query("eventSeries").collect());
      const after = (await t.run((ctx) => ctx.db.get(night)))!;
      assert.deepEqual([after.seriesId, after.occurrenceDate, after.eventStatus, after.publicationState], [series._id, "2026-11-14", ...(label === "cancelled" ? ["cancelled", "published"] : ["scheduled", "draft_private"])]);
      const nights = await occurrences(t, series._id);
      assert.deepEqual([nights.length, nights.filter((n) => n.occurrenceDate === "2026-11-14").map((n) => n._id)], [8, [night]]);
    });
  }

  it("lists a private master as unparseable and groups nothing", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    await seedNight(t, connectorId, communityProfileId, "2026-11-07");
    const fake = fakeFetch(masterFetch({ ...MASTER, visibility: "private" }));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: [], unparseable: ["m1"] });
    fake.restore();
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
  });

  it("gives a held connector no series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import", mode: "hold" });
    await seedNight(t, connectorId, communityProfileId, "2026-11-07");
    const fake = fakeFetch(masterFetch(MASTER));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: [], unparseable: [] });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSyncLinks").collect())).filter((l) => l.seriesId).length, 0);
  });

  it("does nothing with the series gate off or for a kind without series", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId, communityProfileId } = await seedGoogleConnector(t, { direction: "import" });
    await seedNight(t, connectorId, communityProfileId, "2026-11-07");
    const fake = fakeFetch(masterFetch(MASTER));
    process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "false";
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: [], unparseable: [] });
    process.env.VRDEX_CONNECTOR_SERIES_ENABLED = "true";
    await t.run((ctx) => ctx.db.patch(connectorId, { kind: "discord_board" }));
    assert.deepEqual(await t.action(internal.migrations.groupOccurrenceLinks, { connectorId }), { grouped: [], unparseable: [] });
    fake.restore();
    assert.equal(fake.calls.length, 0);
    assert.equal((await t.run((ctx) => ctx.db.query("eventSeries").collect())).length, 0);
  });

  it("lets only a super-admin schedule the migration", async () => {
    const t = convexTest({ schema, modules: seriesSyncModules });
    const { connectorId } = await seedGoogleConnector(t, { direction: "import" });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkUserId: "admin", email: "admin@example.test" });
      await ctx.db.insert("accountFeatureGrants", { userId, feature: "super_admin", state: "active", grantedBy: { tokenIdentifier: "test|admin", issuer: "test", subject: "admin" }, grantedAt: NOW, updatedAt: NOW });
      await ctx.db.insert("users", { clerkUserId: "plain", email: "plain@example.test" });
    });
    const as = (subject: string) => t.withIdentity({ subject, issuer: "test", tokenIdentifier: `test|${subject}`, email: `${subject}@example.test`, emailVerified: true });
    await assert.rejects(as("plain").mutation(api.eventSeriesSync.groupOccurrenceLinksForConnector, { connectorId }), /Super-admin access is required/);
    await as("admin").mutation(api.eventSeriesSync.groupOccurrenceLinksForConnector, { connectorId });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    assert.deepEqual(scheduled.map((job) => [job.name, job.args]), [["migrations:groupOccurrenceLinks", [{ connectorId }]]]);
  });
});
