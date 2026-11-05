import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { NOW, occurrence, occurrences, seedSeriesCommunity, seedUser, seriesModules, type SeriesOwner } from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
});

// Fridays 2026-11-06 .. 2026-12-25 at 20:00 New York, converted from a published event.
async function setup(test: TestContext): Promise<{ t: T; owner: SeriesOwner; seriesId: Id<"eventSeries"> }> {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const t = convexTest({ schema, modules: seriesModules });
  const owner = await seedSeriesCommunity(t);
  const event = await t.withIdentity(owner.identity).mutation(api.events.createCommunityEvent, {
    title: "Harbor Night",
    timezone: "America/New_York",
    communitySlug: "faceless",
    published: true,
    startAt: Date.parse("2026-11-07T01:00:00Z"),
  } as never);
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat: { frequency: "weekly" } });
  return { t, owner, seriesId };
}

function insertSlot(t: T, eventId: Id<"events">) {
  return t.run(ctx => ctx.db.insert("eventSlots", {
    eventId, position: 0, startAt: NOW, displayLabel: "Nova", roleLabel: "DJ", sourceType: "manual",
    sourceLabel: "Manual", confidence: 1, reviewState: "confirmed", updatedAt: NOW,
  }));
}

it("unpublishes bare future nights and detaches customised ones", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const [n13, n20, n27, d04] = await Promise.all(["2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04"].map(d => occurrence(t, seriesId, d)));
  await t.run(async ctx => {
    await ctx.db.patch(n13._id, { overrides: ["summary"], summary: "Special" });
    await ctx.db.insert("eventLineupEntries", { eventId: n20._id, clientKey: "a", position: 0, performerLabel: "Aurora", updatedAt: NOW });
  });
  await insertSlot(t, d04._id);
  await t.withIdentity(owner.identity).mutation(api.eventSeries.end, { seriesId });
  const [overridden, withLineup, bare, withSlot] = (await t.run(ctx => Promise.all([n13, n20, n27, d04].map(e => ctx.db.get(e._id))))).map(e => e!);
  assert.deepEqual([overridden.publicationState, overridden.seriesId], ["published", undefined]);
  assert.deepEqual([withLineup.publicationState, withLineup.seriesId], ["published", undefined]);
  assert.deepEqual([bare.publicationState, bare.seriesId], ["draft_private", seriesId]);
  assert.deepEqual(
    [withSlot.publicationState, withSlot.seriesId, withSlot.occurrenceDate, withSlot.overrides],
    ["published", undefined, undefined, undefined],
  );
  const audit = await t.run(ctx => ctx.db.query("eventAuditEvents").filter(q => q.eq(q.field("eventId"), bare._id)).collect());
  assert.ok(audit.some(row => row.action === "unpublished" && row.actorSurface === "system"));
  const series = await t.run(ctx => ctx.db.get(seriesId));
  assert.deepEqual([series!.state, series!.endsOn], ["ended", "2026-10-30"]);
  assert.equal((await t.mutation(internal.eventSeries.materialize, { seriesId })).created.length, 0);
});

it("never unpublishes or detaches a night that has started", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  // 2026-11-13 21:00 New York: the 13th has started and its local date is today, so only startAt protects it.
  test.mock.timers.setTime(Date.parse("2026-11-14T02:00:00Z"));
  const [n06, n13, n20] = await Promise.all(["2026-11-06", "2026-11-13", "2026-11-20"].map(d => occurrence(t, seriesId, d)));
  await insertSlot(t, n06._id);
  await t.withIdentity(owner.identity).mutation(api.eventSeries.end, { seriesId, state: "removed" });
  const [first, started, future] = (await t.run(ctx => Promise.all([n06, n13, n20].map(e => ctx.db.get(e._id))))).map(e => e!);
  assert.deepEqual([first.publicationState, first.seriesId, first.occurrenceDate], ["published", seriesId, "2026-11-06"]);
  assert.deepEqual([started.publicationState, started.seriesId, started.occurrenceDate], ["published", seriesId, "2026-11-13"]);
  assert.deepEqual([future.publicationState, future.seriesId], ["draft_private", seriesId]);
  const series = await t.run(ctx => ctx.db.get(seriesId));
  assert.deepEqual([series!.state, series!.endsOn], ["removed", "2026-11-13"]);
});

it("exports a delete for unpublished nights and an upsert for detached ones", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const [n13, n20] = await Promise.all(["2026-11-13", "2026-11-20"].map(d => occurrence(t, seriesId, d)));
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  // Added after creation, so every job comes from ending the series.
  await t.run(async ctx => {
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId: owner.profileId, kind: "google_calendar", direction: "export", mode: "autopublish",
      authorityUserId: owner.userId, target: { calendarId: "club@example.com" }, state: "active", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("eventSyncLinks", { connectorId, eventId: n13._id, externalId: "g-13", state: "linked", createdAt: NOW, updatedAt: NOW });
  });
  await insertSlot(t, n20._id);
  await t.withIdentity(owner.identity).mutation(api.eventSeries.end, { seriesId });
  const jobs = await t.run(ctx => ctx.db.query("eventSyncJobs").collect());
  assert.deepEqual(
    jobs.map(job => [job.eventId, job.kind]).sort(),
    [[n13._id, "export_delete"], [n20._id, "export_upsert"]].sort(),
  );
});

it("rejects a non-manager and a disabled flag", async (test) => {
  const { t, seriesId } = await setup(test);
  const stranger = await seedUser(t, "Stranger");
  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.end, { seriesId }), /access/);
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.end, { seriesId }), /Recurring events are not enabled\./);
  assert.equal((await t.run(ctx => ctx.db.get(seriesId)))!.state, "active");
});

const publishedDates = async (t: T, seriesId: Id<"eventSeries">) =>
  (await occurrences(t, seriesId)).filter(e => e.publicationState === "published").map(e => e.occurrenceDate!).sort();
const FRIDAYS = ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27", "2026-12-04", "2026-12-11", "2026-12-18", "2026-12-25"];

it("clearing Ends brings retired nights back on the same URL with the current series fields", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  const before = await occurrence(t, seriesId, "2026-11-20");
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-13" });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS.slice(0, 2));
  // An edit while the night is retired skips it, so the return has to catch it up.
  await me.mutation(api.eventSeries.update, { seriesId, summary: "Moved" });
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  await t.run(async ctx => {
    await ctx.db.insert("eventConnectors", {
      communityProfileId: owner.profileId, kind: "google_calendar", direction: "export", mode: "autopublish",
      authorityUserId: owner.userId, target: { calendarId: "club@example.com" }, state: "active", createdAt: NOW, updatedAt: NOW,
    });
  });
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: null });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS);
  const back = await occurrence(t, seriesId, "2026-11-20");
  assert.deepEqual([back._id, back.slug, back.summary, back.seriesRetiredAt], [before._id, before.slug, "Moved", undefined]);
  const jobs = await t.run(ctx => ctx.db.query("eventSyncJobs").filter(q => q.eq(q.field("eventId"), back._id)).collect());
  assert.deepEqual(jobs.map(job => job.kind), ["export_upsert"]);
  const audit = await t.run(ctx => ctx.db.query("eventAuditEvents").filter(q => q.eq(q.field("eventId"), back._id)).collect());
  assert.equal(audit.filter(row => row.action === "published" && row.actorSurface === "system").length, 1);
});

it("a rule change and its reversal restore every night", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  await me.mutation(api.eventSeries.update, { seriesId, rule: { frequency: "biweekly", weekday: 5, startTime: "20:00" } });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS.filter((_, index) => index % 2 === 0));
  await me.mutation(api.eventSeries.update, { seriesId, rule: { frequency: "weekly", weekday: 5, startTime: "20:00" } });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS);
});

it("a count edit retires the nights past it and clearing it restores them", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  await me.mutation(api.eventSeries.update, { seriesId, count: 3 });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS.slice(0, 3));
  await me.mutation(api.eventSeries.update, { seriesId, count: null });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS);
});

it("a retired night back inside the rule returns on the daily run", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-13" });
  await t.run(ctx => ctx.db.patch(seriesId, { endsOn: undefined }));
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS);
});

it("a night staff unpublished stays unpublished through a retire and return", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  const night = await occurrence(t, seriesId, "2026-11-20");
  await me.mutation(api.events.setCommunityEventPublished, { currentSlug: night.slug!, published: false });
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-13" });
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: null });
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  const kept = await occurrence(t, seriesId, "2026-11-20");
  assert.deepEqual([kept.publicationState, kept.seriesRetiredAt], ["draft_private", undefined]);
  assert.deepEqual(await publishedDates(t, seriesId), FRIDAYS.filter(date => date !== "2026-11-20"));
});

it("any publish clears the retired marker, so a later staff unpublish is respected", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-13" });
  const [byToggle, byEditor] = await Promise.all(["2026-11-20", "2026-11-27"].map(date => occurrence(t, seriesId, date)));
  assert.equal(typeof byToggle!.seriesRetiredAt, "number");
  await me.mutation(api.events.setCommunityEventPublished, { currentSlug: byToggle!.slug!, published: true });
  await me.mutation(api.events.updateCommunityEvent, {
    currentSlug: byEditor!.slug!, communitySlug: "faceless", title: byEditor!.title, timezone: byEditor!.timezone, startAt: byEditor!.startAt, published: true,
  } as never);
  for (const night of [byToggle!, byEditor!]) {
    assert.equal((await t.run(ctx => ctx.db.get(night._id)))!.seriesRetiredAt, undefined);
    await me.mutation(api.events.setCommunityEventPublished, { currentSlug: night.slug!, published: false });
  }
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: null });
  const published = await publishedDates(t, seriesId);
  assert.deepEqual([published.includes("2026-11-20"), published.includes("2026-11-27"), published.includes("2026-12-04")], [false, false, true]);
});

it("ending a series marks nothing, and a night retired earlier stays down", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-20" });
  await me.mutation(api.eventSeries.end, { seriesId });
  assert.equal((await occurrence(t, seriesId, "2026-11-13")).seriesRetiredAt, undefined);
  await t.mutation(internal.eventSeries.materialize, { seriesId });
  assert.deepEqual(await publishedDates(t, seriesId), []);
});

it("a retired night that has started, or a removed one, never returns", async (test) => {
  const { t, owner, seriesId } = await setup(test);
  const me = t.withIdentity(owner.identity);
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: "2026-11-13" });
  const [today, removed] = await Promise.all(["2026-11-20", "2026-11-27"].map(date => occurrence(t, seriesId, date)));
  await t.run(ctx => ctx.db.patch(removed!._id, { moderationRemovedAt: NOW }));
  // 21:00 in New York on the 20th: the night started at 20:00, and the rule is about to say 22:00.
  test.mock.timers.setTime(Date.parse("2026-11-21T02:00:00Z"));
  await me.mutation(api.eventSeries.update, { seriesId, endsOn: null, rule: { frequency: "weekly", weekday: 5, startTime: "22:00" } });
  const [kept, gone] = await t.run(ctx => Promise.all([ctx.db.get(today!._id), ctx.db.get(removed!._id)]));
  assert.deepEqual([kept!.publicationState, kept!.startAt], ["draft_private", today!.startAt]);
  assert.equal(gone!.publicationState, "draft_private");
});
