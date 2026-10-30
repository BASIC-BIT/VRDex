import assert from "node:assert/strict";
import { beforeEach, it, type TestContext } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import { NOW, occurrence, seedSeriesCommunity, seedUser, seriesModules, slotsFor, type SeriesOwner } from "./_eventSeriesFixture";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
type T = ReturnType<typeof convexTest>;

const modules = { ...seriesModules, "../../convex/eventCorrections.ts": () => import("../../convex/eventCorrections") };

beforeEach(() => {
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "true";
  delete process.env.VRDEX_EVENT_CONNECTORS_ENABLED;
});

function insertWorld(t: T, slug: string) {
  return t.run(ctx => ctx.db.insert("worlds", {
    slug, displayName: slug, sortName: slug, tags: [], vrchatWorldId: `wrld_${slug === "harbor-world" ? 1 : 2}0000000-1111-1111-1111-111111111111`,
    visibilityStatus: "public", platformCompatibility: [], media: [], creatorAttributions: [], outboundLinks: [],
    publicationState: "published", creationSource: "self", updatedAt: NOW,
  }));
}

// Fridays from 2026-11-06 at 20:00 New York, converted from a published Harbor Night with summary "Weekly".
async function setup(test: TestContext, { worldSlug, repeat = { frequency: "weekly" as const } }: { worldSlug?: string; repeat?: { frequency: "weekly"; count?: number } } = {}) {
  test.mock.timers.enable({ apis: ["Date"], now: NOW });
  const t = convexTest({ schema, modules });
  const owner: SeriesOwner = await seedSeriesCommunity(t);
  if (worldSlug) for (const slug of [worldSlug, "other-world"]) await insertWorld(t, slug);
  const event = await t.withIdentity(owner.identity).mutation(api.events.createCommunityEvent, {
    title: "Harbor Night", summary: "Weekly", timezone: "America/New_York", communitySlug: "faceless", published: true,
    startAt: Date.parse("2026-11-07T01:00:00Z"), worldSlug,
  } as never);
  const { seriesId } = await t.withIdentity(owner.identity).mutation(api.eventSeries.create, { eventSlug: event.slug, repeat });
  const [n13, n20] = await Promise.all(["2026-11-13", "2026-11-20"].map(d => occurrence(t, seriesId, d)));
  return { t, owner, seriesId, n13: n13!, n20: n20! };
}

// What the browser editor resubmits for a night it loaded and saved without changes.
function editorResave(event: Awaited<ReturnType<typeof setup>>["n13"]) {
  return {
    currentSlug: event.slug!, communitySlug: "faceless", preservedCommunityProfileId: event.communityProfileId,
    title: event.title, summary: event.summary ?? null, startAt: event.startAt, timezone: event.timezone,
    doorsOpenAt: event.doorsOpenAt ?? null, endAt: event.endAt ?? null, notes: null, sourceLabel: "",
    sourceUrl: event.sourceUrl ?? null, posterImageUrl: null, bannerImageUrl: event.bannerImageUrl ?? null,
    thumbnailImageUrl: event.thumbnailImageUrl ?? null, watchMode: event.watchMode ?? "event_stream",
    watchSurfaceEnabled: event.watchSurfaceEnabled ?? false, mediaLinks: event.mediaLinks ?? [], scheduleKind: "timed" as const,
  };
}

it("fans a series edit to future nights, honours overrides, shifts slots, leaves the past", async (test) => {
  const { t, owner, seriesId, n13, n20 } = await setup(test);
  const { _id, _creationTime, slug, ...pastOccurrence } = n13;
  let past!: Id<"events">;
  await t.run(async ctx => {
    await ctx.db.insert("eventSlots", { eventId: n13._id, position: 0, startAt: Date.parse("2026-11-14T02:00:00Z"), displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Harbor", confidence: 1, reviewState: "confirmed", updatedAt: NOW });
    await ctx.db.patch(n20._id, { summary: "Special", overrides: ["summary"] });
    past = await ctx.db.insert("events", { ...pastOccurrence, seriesId, occurrenceDate: "2026-10-23", startAt: Date.parse("2026-10-24T00:00:00Z"), summary: "Old" });
  });
  const result = await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "New", rule: { frequency: "weekly", weekday: 5, startTime: "21:00" } });
  assert.deepEqual(result.changed.sort(), ["startAt", "summary"]);
  const [a, b, p] = await t.run(ctx => Promise.all([ctx.db.get(n13._id), ctx.db.get(n20._id), ctx.db.get(past)]));
  assert.deepEqual([a!.summary, a!.startAt], ["New", Date.parse("2026-11-14T02:00:00Z")]);
  assert.equal((await slotsFor(t, n13._id))[0]!.startAt, Date.parse("2026-11-14T03:00:00Z"));
  assert.deepEqual([b!.summary, b!.startAt], ["Special", Date.parse("2026-11-21T02:00:00Z")]);
  assert.deepEqual([p!.summary, p!.startAt], ["Old", Date.parse("2026-10-24T00:00:00Z")]);
  // Series edits never record overrides.
  assert.deepEqual(a!.overrides, []);
});

it("never changes a night that has started, even one dated today", async (test) => {
  const { t, owner, seriesId, n13, n20 } = await setup(test);
  // 2026-11-13 21:00 New York: the 13th started an hour ago and its local date is today, so only startAt protects it.
  test.mock.timers.setTime(Date.parse("2026-11-14T02:00:00Z"));
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "New" });
  const [started, next] = await t.run(ctx => Promise.all([ctx.db.get(n13._id), ctx.db.get(n20._id)]));
  assert.deepEqual([started!.summary, next!.summary], ["Weekly", "New"]);
});

it("moves an overridden doors time with the series start", async (test) => {
  const { t, owner, seriesId, n13 } = await setup(test);
  // Doors an hour before the 01:00Z start, set on this night only.
  await t.run(ctx => ctx.db.patch(n13._id, { doorsOpenAt: Date.parse("2026-11-14T00:00:00Z"), overrides: ["doorsOpenAt"] }));
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, rule: { frequency: "weekly", weekday: 5, startTime: "18:00" } });
  const moved = (await t.run(ctx => ctx.db.get(n13._id)))!;
  assert.deepEqual([moved.startAt, moved.doorsOpenAt], [Date.parse("2026-11-13T23:00:00Z"), Date.parse("2026-11-13T22:00:00Z")]);
});

it("leaves a night's times unchanged when the series times would not fit it", async (test) => {
  const { t, owner, seriesId, n13, n20 } = await setup(test);
  // A set that runs to 04:00Z, past the 22:00 New York (03:00Z) end the series is about to add.
  await t.run(ctx => ctx.db.insert("eventSlots", { eventId: n13._id, position: 0, startAt: Date.parse("2026-11-14T03:00:00Z"), endAt: Date.parse("2026-11-14T04:00:00Z"), displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Harbor", confidence: 1, reviewState: "confirmed", updatedAt: NOW }));
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "New", rule: { frequency: "weekly", weekday: 5, startTime: "20:00", endTime: "22:00" } });
  const [kept, next] = await t.run(ctx => Promise.all([ctx.db.get(n13._id), ctx.db.get(n20._id)]));
  assert.deepEqual([kept!.summary, kept!.startAt, kept!.endAt], ["New", n13.startAt, undefined]);
  assert.equal(next!.endAt, Date.parse("2026-11-21T03:00:00Z"));
});

it("a reset the night cannot take leaves its time and keeps the override", async (test) => {
  const { t, owner, seriesId, n13 } = await setup(test);
  await t.run(async ctx => {
    await ctx.db.patch(n13._id, { endAt: Date.parse("2026-11-14T04:30:00Z"), overrides: ["endAt"] });
    await ctx.db.insert("eventSlots", { eventId: n13._id, position: 0, startAt: Date.parse("2026-11-14T03:00:00Z"), endAt: Date.parse("2026-11-14T04:00:00Z"), displayLabel: "Aurora", roleLabel: "DJ", sourceType: "community", sourceLabel: "Harbor", confidence: 1, reviewState: "confirmed", updatedAt: NOW });
  });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, rule: { frequency: "weekly", weekday: 5, startTime: "20:00", endTime: "22:00" } });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "endAt" });
  const kept = (await t.run(ctx => ctx.db.get(n13._id)))!;
  assert.deepEqual([kept.endAt, kept.overrides], [Date.parse("2026-11-14T04:30:00Z"), ["endAt"]]);
});

it("enqueues one export per fanned, retired, materialised and reset night", async (test) => {
  // Fridays 11-06, 11-13, 11-20; switching to every two weeks keeps 11-06 and 11-20, retires 11-13, adds 12-04 and 12-18.
  const { t, owner, seriesId, n13, n20 } = await setup(test, { repeat: { frequency: "weekly", count: 3 } });
  const n06 = await occurrence(t, seriesId, "2026-11-06");
  process.env.VRDEX_EVENT_CONNECTORS_ENABLED = "true";
  // Added after creation, so every job comes from the edit.
  await t.run(async ctx => {
    const connectorId = await ctx.db.insert("eventConnectors", {
      communityProfileId: owner.profileId, kind: "google_calendar", direction: "export", mode: "autopublish",
      authorityUserId: owner.userId, target: { calendarId: "club@example.com" }, state: "active", createdAt: NOW, updatedAt: NOW,
    });
    await ctx.db.insert("eventSyncLinks", { connectorId, eventId: n13._id, externalId: "g-13", state: "linked", createdAt: NOW, updatedAt: NOW });
  });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "New", rule: { frequency: "biweekly", weekday: 5, startTime: "20:00" }, count: null });
  const [d04, d18] = await Promise.all(["2026-12-04", "2026-12-18"].map(d => occurrence(t, seriesId, d)));
  const jobs = () => t.run(async ctx => (await ctx.db.query("eventSyncJobs").collect()).map(job => [job.eventId, job.kind]).sort());
  assert.deepEqual(await jobs(), [
    [n06._id, "export_upsert"], [n13._id, "export_delete"], [n20._id, "export_upsert"],
    [d04._id, "export_upsert"], [d18._id, "export_upsert"],
  ].sort());
  await t.run(async ctx => {
    for (const job of await ctx.db.query("eventSyncJobs").collect()) await ctx.db.delete(job._id);
    await ctx.db.patch(n20._id, { summary: "Special", overrides: ["summary"] });
  });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n20._id, field: "summary" });
  assert.deepEqual(await jobs(), [[n20._id, "export_upsert"]]);
});

it("a night edit records only fields that actually changed", async (test) => {
  const { t, owner, n13 } = await setup(test);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, editorResave(n13));
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, []);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, { currentSlug: n13.slug!, communitySlug: "faceless", timezone: "America/New_York", summary: "One-off" });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, ["summary"]);
});

it("a night edit records a world change only when the linked world changes", async (test) => {
  const { t, owner, n13 } = await setup(test, { worldSlug: "harbor-world" });
  const linked = await t.run(ctx => ctx.db.query("eventWorlds").withIndex("by_eventId", q => q.eq("eventId", n13._id)).collect());
  assert.equal(linked.length, 1);
  // The chooser kept the world: the browser passes the same slug and preserves the association, so world is undefined.
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, {
    ...editorResave(n13), worldSlug: "harbor-world", preservedWorldAssociationIds: linked.map(row => row._id),
  });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, []);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, { ...editorResave(n13), worldSlug: "other-world" });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, ["worldSlug"]);
});

it("reset copies the series value back and clears the override", async (test) => {
  const { t, owner, n13 } = await setup(test);
  await t.withIdentity(owner.identity).mutation(api.events.updateCommunityEvent, { currentSlug: n13.slug!, communitySlug: "faceless", timezone: "America/New_York", summary: "One-off" });
  await t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "summary" });
  const reset = await t.run(ctx => ctx.db.get(n13._id));
  assert.deepEqual([reset!.summary, reset!.overrides], ["Weekly", []]);
});

it("a rule change on an active series retires nights off the rule and creates the new ones", async (test) => {
  const { t, owner, seriesId, n13 } = await setup(test);
  await t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, rule: { frequency: "weekly", weekday: 6, startTime: "20:00" } });
  assert.equal((await t.run(ctx => ctx.db.get(n13._id)))!.publicationState, "draft_private");
  const saturday = await occurrence(t, seriesId, "2026-11-14");
  assert.deepEqual([saturday.publicationState, saturday.startAt], ["published", Date.parse("2026-11-15T01:00:00Z")]);
});

it("a contributor edit to an adopted night records overrides", async (test) => {
  const { t, n13 } = await setup(test);
  const contributor = await seedUser(t, "Guest");
  await t.run(ctx => ctx.db.patch(n13._id, { sourceType: "contributor", contributorUserId: contributor.userId }));
  const event = (await t.run(ctx => ctx.db.get(n13._id)))!;
  await t.mutation(internal.eventCorrections.updateActorContributedEvent, {
    actorUserId: contributor.userId, eventId: n13._id, expectedUpdatedAt: event.updatedAt, patch: { summary: "Guest set" },
  });
  assert.deepEqual((await t.run(ctx => ctx.db.get(n13._id)))!.overrides, ["summary"]);
});

it("rejects a non-manager, a reset of a field that is not overridden, and a disabled flag", async (test) => {
  const { t, owner, seriesId, n13 } = await setup(test);
  const stranger = await seedUser(t, "Stranger");
  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.update, { seriesId, summary: "Nope" }), /access/);
  await assert.rejects(t.withIdentity(stranger.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "summary" }), /access/);
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "summary" }), /not overridden/);
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "notes" }), /not overridden/);
  process.env.VRDEX_RECURRING_EVENTS_ENABLED = "false";
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.update, { seriesId, summary: "Nope" }), /Recurring events are not enabled\./);
  await assert.rejects(t.withIdentity(owner.identity).mutation(api.eventSeries.resetOverride, { eventId: n13._id, field: "summary" }), /Recurring events are not enabled\./);
  assert.equal((await t.run(ctx => ctx.db.get(seriesId)))!.summary, "Weekly");
});
