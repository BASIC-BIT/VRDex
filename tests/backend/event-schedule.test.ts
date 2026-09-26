import assert from "node:assert/strict";
import { it } from "node:test";
import type { Doc } from "../../convex/_generated/dataModel";
import { toPublicEvent, getPublicEventPreviews } from "../../convex/_eventPublic";
import { createEventSearchDocument, toPublicSearchResult, upsertSearchDocument } from "../../convex/_searchDocuments";
import { createPublicEventIcs, createPublicEventFeedIcs } from "../../apps/web/src/lib/calendar/ics";
import type { DatabaseReader } from "../../convex/_generated/server";
import { normalizeEventSchedule, readEventSchedule, requireDateOnlyEventsEnabled } from "../../convex/_eventSchedule";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { api } from "../../convex/_generated/api";

const dateOnly = { _id: "date-only", slug: "july-four", title: "July Four", sortTitle: "july four",
  scheduleKind: "date_only", eventDate: "2026-07-04", sortAt: 1783123200000,
  eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Community",
  watchSurfaceEnabled: true, updatedAt: 1 } as unknown as Doc<"events">;

it("keeps a future discovery event when 500 expired timed rows exhaust featured results", async () => {
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = 1783166400000;
  const communityId = await t.run(async ctx => {
    const communityId = await ctx.db.insert("profiles", {
      slug: "discovery-club", displayName: "Discovery Club", sortName: "discovery club",
      profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [],
      claimState: "unclaimed", creationSource: "self", publicationState: "published",
      publicSurfacingState: "public", updatedAt: now,
    });
    const community = (await ctx.db.get(communityId))!;
    // The only future event is oldest by creation order, outside the featured fallback.
    for (let index = 0; index <= 500; index++) {
      const startAt = index === 0 ? now + 3_600_000 : now - 35 * 3_600_000;
      const eventId = await ctx.db.insert("events", {
        slug: `review-event-${index}`, title: `Review Event ${index}`, sortTitle: `review event ${index}`,
        ...readEventSchedule({ startAt }),
        communityProfileId: communityId, eventStatus: "scheduled", publicationState: "published",
        sourceType: "community", sourceLabel: "Community", updatedAt: now,
      });
      const document = createEventSearchDocument((await ctx.db.get(eventId))!, { community });
      await ctx.db.insert("searchDocuments", { ...document, featuredRank: 42 });
    }
    return communityId;
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      const discovery = await t.query(api.search.listDiscovery, { now });
      assert.deepEqual(discovery.upcomingEvents.map(event => event.slug), ["review-event-0"], `switch=${enabled}`);
    }
    // A date-only event within the lookback must also survive those expired timed rows.
    await t.run(async ctx => {
      const { _id, ...fields } = dateOnly;
      const eventId = await ctx.db.insert("events", { ...fields, communityProfileId: communityId });
      const community = (await ctx.db.get(communityId))!;
      const document = createEventSearchDocument((await ctx.db.get(eventId))!, { community });
      await ctx.db.insert("searchDocuments", { ...document, featuredRank: 0 });
    });
    const discovery = await t.query(api.search.listDiscovery, { now });
    assert.deepEqual(discovery.upcomingEvents.map(event => event.slug), ["july-four", "review-event-0"]);
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});

it("projects date-only events without an instant or live watch", () => {
  const result = toPublicEvent({ event: dateOnly, worlds: [], participants: [], slots: [] })!;
  assert.equal(result.scheduleKind, "date_only");
  assert.equal(result.eventDate, "2026-07-04");
  assert.equal(Object.hasOwn(result, "startAt"), false);
  assert.equal(Object.hasOwn(result, "sortAt"), false);
  assert.equal(result.watchSurfaceEnabled, false);
});

it("does not leak stale timed controls from a date-only record", () => {
  const event = { ...dateOnly, startAt: 1783123200000, doorsOpenAt: 1783123200000, endAt: 1783209600000 };
  const result = toPublicEvent({ event, worlds: [], participants: [], slots: [{ slot: {
    _id: "slot", startAt: 1783123200000, displayLabel: "DJ", roleLabel: "DJ", position: 0,
    sourceType: "community", sourceLabel: "Community",
  } as unknown as Doc<"eventSlots"> }] })!;
  assert.equal(Object.hasOwn(result, "startAt"), false);
  assert.equal(Object.hasOwn(result, "endAt"), false);
  assert.equal(Object.hasOwn(result, "doorsOpenAt"), false);
  assert.deepEqual(result.slots, []);
  assert.deepEqual(result.nextSlots, []);
});

it("exports date-only events as calendar dates with time TBA in event and feed ICS", () => {
  const event = { id: "july", slug: "july", title: "July", scheduleKind: "date_only" as const,
    eventDate: "2026-07-04", worlds: [] };
  const single = createPublicEventIcs(event, { canonicalUrl: "https://vrdex.net/c/club/e/july", now: 1 });
  const feed = createPublicEventFeedIcs([event], { feedName: "Club", feedUrl: "https://vrdex.net/feed", eventUrl: () => "https://vrdex.net/c/club/e/july", now: 1 });
  for (const ics of [single, feed]) {
    assert.match(ics, /DTSTART;VALUE=DATE:20260704\r\n/);
    assert.match(ics, /Time TBA/i);
    assert.doesNotMatch(ics, /DTEND|DTSTART:/);
  }
});

it("orders date-only and legacy timed previews by date and retains the authored day", async () => {
  const indexed = { filter: () => indexed, take: async () => [] };
  const db = { query: () => ({ withIndex: () => indexed }) } as unknown as DatabaseReader;
  const timed = { ...dateOnly, _id: "timed", slug: "timed", scheduleKind: undefined, eventDate: undefined,
    sortAt: undefined, startAt: 1783209600000 } as unknown as Doc<"events">;
  const result = await getPublicEventPreviews(db, [timed, dateOnly], { now: 1783166400000 });
  assert.deepEqual(result.map(event => event.slug), ["july-four", "timed"]);
  assert.equal(result[0].eventDate, "2026-07-04");
  assert.equal(result[1].startAt, 1783209600000);
});

it("indexes date-only search rows without publishing an invented startsAt", () => {
  const document = createEventSearchDocument(dateOnly);
  assert.equal(document.sortAt, 1783123200000);
  assert.equal(document.eventDate, "2026-07-04");
  assert.equal(Object.hasOwn(document, "startsAt"), false);
  const result = toPublicSearchResult(document as never, undefined);
  assert.equal(result.eventDate, "2026-07-04");
  assert.equal(Object.hasOwn(result, "startsAt"), false);
  assert.equal(Object.hasOwn(result, "sortAt"), false);
});

it("normalizes legacy instants and validates calendar dates without inventing date-only starts", () => {
  assert.deepEqual(readEventSchedule({ startAt: 1783123200000 }), {
    scheduleKind: "timed", eventDate: "2026-07-04", startAt: 1783123200000, sortAt: 1783123200000,
  });
  assert.deepEqual(normalizeEventSchedule({ kind: "date_only", date: "2026-07-04" }), {
    scheduleKind: "date_only", eventDate: "2026-07-04", sortAt: 1783123200000,
  });
  for (const date of ["2026-02-30", "July 4", "2026-7-4"]) {
    assert.throws(() => normalizeEventSchedule({ kind: "date_only", date }), /valid calendar date/);
  }
  assert.throws(() => normalizeEventSchedule({ kind: "timed", date: "2026-07-04", startAt: 1783123200000, timeZone: "Etc/GMT+12" }), /must match/);
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  delete process.env.EVENT_DATE_ONLY_ENABLED;
  try { assert.throws(requireDateOnlyEventsEnabled, /not enabled/); }
  finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});

it("backfills resumable pages and includes date-only events in real community, person and upcoming queries", async () => {
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/search.ts": () => import("../../convex/search"),
    "../../convex/eventScheduleMigration.ts": () => import("../../convex/eventScheduleMigration"),
  } });
  const ids = await t.run(async ctx => {
    const base = { aliases: [], tags: [], claimState: "unclaimed" as const, creationSource: "self" as const,
      publicationState: "published" as const, publicSurfacingState: "public" as const, updatedAt: 1 };
    const community = await ctx.db.insert("profiles", { ...base, slug: "club", displayName: "Club", sortName: "club", profileType: "community", community: { categoryTags: [] } });
    const person = await ctx.db.insert("profiles", { ...base, slug: "dj", displayName: "DJ", sortName: "dj", profileType: "person", person: { roleTags: [] } });
    const { _id, ...dateFields } = dateOnly;
    const event = await ctx.db.insert("events", { ...dateFields, communityProfileId: community });
    const timed = await ctx.db.insert("events", { title: "Timed", sortTitle: "timed", slug: "timed", startAt: 1783209600000,
      communityProfileId: community, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
    await ctx.db.insert("eventParticipants", { eventId: event, personProfileId: person, eventSortAt: 1783123200000,
      eventSortEndAt: 1783252799999, eventPublicationState: "published", eventStatus: "scheduled", roleLabel: "DJ", sourceType: "community", sourceLabel: "Club", confirmationState: "confirmed", updatedAt: 1 });
    const legacyParticipant = await ctx.db.insert("eventParticipants", { eventId: timed, personProfileId: person,
      eventStartAt: 1783209600000, eventEndAt: 1783209600000, eventPublicationState: "published", eventStatus: "scheduled", roleLabel: "DJ", sourceType: "community", sourceLabel: "Club", confirmationState: "confirmed", updatedAt: 1 });
    const communityDoc = (await ctx.db.get(community))!;
    await upsertSearchDocument(ctx.db, createEventSearchDocument((await ctx.db.get(event))!, { community: communityDoc }));
    const searchId = await upsertSearchDocument(ctx.db, createEventSearchDocument((await ctx.db.get(timed))!, { community: communityDoc }));
    await ctx.db.patch(searchId, { sortAt: undefined, scheduleKind: undefined, eventDate: undefined });
    return { community, person, timed, legacyParticipant, searchId };
  });
  const backfill = makeFunctionReference<"mutation">("eventScheduleMigration:backfill");
  let page = await t.mutation(backfill, { batchSize: 1 });
  assert.equal(page.done, false);
  for (let count = 0; !page.done && count < 20; count++) page = await t.mutation(backfill, { phase: page.phase, cursor: page.cursor, batchSize: 1 });
  assert.equal(page.done, true);
  const timed = await t.run(ctx => ctx.db.get(ids.timed));
  assert.equal(timed?.eventDate, "2026-07-05");
  assert.equal(timed?.sortAt, 1783209600000);
  assert.equal((await t.run(ctx => ctx.db.get(ids.legacyParticipant)))?.eventSortAt, 1783209600000);
  assert.equal((await t.run(ctx => ctx.db.get(ids.searchId)))?.sortAt, 1783209600000);
  assert.equal((await t.run(ctx => ctx.db.get(ids.searchId)))?.eventDate, "2026-07-05");
  await t.run(async ctx => {
    await upsertSearchDocument(ctx.db, createEventSearchDocument(timed!));
    await upsertSearchDocument(ctx.db, createEventSearchDocument({ ...timed!, scheduleKind: "date_only", eventDate: "2026-07-04", sortAt: 1783123200000, startAt: undefined }));
    const document = await ctx.db.query("searchDocuments").withIndex("by_eventId", q => q.eq("eventId", ids.timed)).unique();
    assert.equal(Object.hasOwn(document!, "startsAt"), false);
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  process.env.EVENT_DATE_ONLY_ENABLED = "true";
  try {
    const community = await t.run(ctx => getPublicCommunityHostedEvents(ctx.db, ids.community, 1783166400000));
    const person = await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, ids.person, 1783166400000));
    const upcoming = await t.query(api.events.listPublicUpcoming, { now: 1783166400000 });
    assert.deepEqual(community.map(event => event.slug), ["july-four", "timed"]);
    assert.deepEqual(person.map(event => event.slug), ["july-four", "timed"]);
    assert.deepEqual(upcoming.map(event => event.slug), ["july-four", "timed"]);
    const discovery = await t.query(api.search.listDiscovery, { now: 1783166400000 });
    assert.equal(discovery.upcomingEvents[0]?.slug, "july-four");
    assert.equal(discovery.upcomingEvents[0]?.eventDate, "2026-07-04");
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});
