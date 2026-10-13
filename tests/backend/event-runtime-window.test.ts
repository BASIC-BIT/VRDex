import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { eventSortEndAt, readEventSchedule } from "../../convex/_eventSchedule";
import { getPublicCommunityHostedEvents, getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { getPublicActiveWorlds, getPublicWorldEventContext } from "../../convex/_worldEvents";
import { createEventSearchDocument, upsertSearchDocument } from "../../convex/_searchDocuments";

it("keeps no-end events in actual discovery and listings through the existing six-hour runtime window", async context => {
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/events.ts": () => import("../../convex/events"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const startAt = Date.now() + 60_000;
  const hour = 3_600_000;
  const ids = await t.run(async ctx => {
    const base = { aliases: [], tags: [], claimState: "unclaimed" as const, creationSource: "self" as const,
      publicationState: "published" as const, publicSurfacingState: "public" as const, updatedAt: 1 };
    const community = await ctx.db.insert("profiles", { ...base, slug: "window-club", displayName: "Window Club", sortName: "window club", profileType: "community", community: { categoryTags: [] } });
    const person = await ctx.db.insert("profiles", { ...base, slug: "window-dj", displayName: "Window DJ", sortName: "window dj", profileType: "person", person: { roleTags: [] } });
    const world = await ctx.db.insert("worlds", { slug: "window-world", displayName: "Window World", sortName: "window world",
      vrchatWorldId: "wrld_00000000-0000-0000-0000-000000000001", tags: [], media: [], visibilityStatus: "public",
      platformCompatibility: [], creatorAttributions: [], outboundLinks: [], creationSource: "self", publicationState: "published", updatedAt: 1 });
    const communityDoc = (await ctx.db.get(community))!;
    const event = await ctx.db.insert("events", { title: "Window Event", sortTitle: "window event", slug: "window-event",
      ...readEventSchedule({ startAt }), communityProfileId: community, eventStatus: "scheduled", publicationState: "published",
      sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
    // Existing rows have the former start-only end. Reads must not require a backfill.
    const link = { eventId: event, eventStartAt: startAt, eventSortAt: startAt, eventEndAt: startAt, eventSortEndAt: startAt,
      eventPublicationState: "published" as const, eventStatus: "scheduled" as const, sourceType: "community" as const,
      confirmationState: "confirmed" as const, updatedAt: 1 };
    await ctx.db.insert("eventParticipants", { ...link, personProfileId: person, roleLabel: "DJ", sourceLabel: "Club" });
    await ctx.db.insert("eventWorlds", { ...link, worldId: world, confidence: 1 });
    await upsertSearchDocument(ctx.db, createEventSearchDocument((await ctx.db.get(event))!, { community: communityDoc }));
    return { community, person, world, event };
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  let runtimeNow = startAt - 1;
  context.mock.method(Date, "now", () => runtimeNow);
  try {
    const activeSearchScore = (await t.query(api.search.searchUniversal, { query: "Window Event", entityType: "event" }))[0].score;
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      for (const offset of [-1, 0, 1, 6 * hour, 6 * hour + 1]) {
        const now = startAt + offset;
        runtimeNow = now;
        const expected = offset <= 6 * hour ? ["window-event"] : [];
        const message = `switch=${enabled}, offset=${offset}`;
        assert.deepEqual((await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug), expected, `discovery ${message}`);
        assert.deepEqual((await t.query(api.events.listPublicUpcoming, { now })).map(event => event.slug), expected, `upcoming ${message}`);
        assert.deepEqual((await t.run(ctx => getPublicCommunityHostedEvents(ctx.db, ids.community, now))).map(event => event.slug), expected, `community ${message}`);
        assert.deepEqual((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, ids.person, now))).map(event => event.slug), expected, `person ${message}`);
        const world = await t.run(ctx => getPublicWorldEventContext(ctx.db, ids.world, now));
        assert.deepEqual(world.upcoming.map(event => event.slug), expected, `world ${message}`);
        assert.deepEqual((await t.run(ctx => getPublicActiveWorlds(ctx.db, now, 8))).map(world => world.nextEvent.slug), expected, `active world ${message}`);
        const results = await t.query(api.search.searchUniversal, { query: "Window Event", entityType: "event" });
        assert.equal(results[0]?.endAt, undefined);
        // Live hydration keeps search ranking until runtime expiry, with no stored end.
        assert.equal(results[0]?.score, offset <= 6 * hour ? activeSearchScore : activeSearchScore - 64, `search score ${message}`);
      }
    }
    const event = await t.run(ctx => ctx.db.get(ids.event));
    assert.equal(Object.hasOwn(event!, "endAt"), false);
    assert.equal(eventSortEndAt(event!), startAt + 6 * hour);
    await t.run(ctx => ctx.db.patch(ids.event, { endAt: startAt + hour }));
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      for (const offset of [hour - 1, hour, hour + 1]) {
        runtimeNow = startAt + offset;
        const expected = offset <= hour ? ["window-event"] : [];
        assert.deepEqual((await t.query(api.search.listDiscovery, { now: runtimeNow })).upcomingEvents.map(event => event.slug), expected, `explicit end ${enabled}/${offset}`);
        assert.deepEqual((await t.query(api.events.listPublicUpcoming, { now: runtimeNow })).map(event => event.slug), expected);
        assert.deepEqual((await t.run(ctx => getPublicPersonUpcomingEvents(ctx.db, ids.person, runtimeNow))).map(event => event.slug), expected);
        assert.deepEqual((await t.run(ctx => getPublicWorldEventContext(ctx.db, ids.world, runtimeNow))).upcoming.map(event => event.slug), expected);
      }
    }
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});

it("reserves discovery scans and exposes their raw candidate limits under volume", async () => {
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = Date.now();
  const hour = 3_600_000;
  await t.run(async ctx => {
    const communityId = await ctx.db.insert("profiles", { slug: "scan-club", displayName: "Scan Club", sortName: "scan club",
      profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self",
      publicationState: "published", publicSurfacingState: "public", updatedAt: 1 });
    const community = (await ctx.db.get(communityId))!;
    for (const event of [
      { slug: "long-active", startAt: now - 48 * hour, endAt: now + hour },
      { slug: "no-end-active", startAt: now - hour },
      { slug: "future", startAt: now + hour },
      { slug: "known-expired", startAt: now - hour, endAt: now - 1 },
      ...Array.from({ length: 501 }, (_, index) => ({ slug: `expired-${index}`, startAt: now - 35 * hour, endAt: now - 34 * hour })),
      ...Array.from({ length: 501 }, (_, index) => ({ slug: `recent-expired-${index}`, startAt: now - 2 * hour, endAt: now - hour })),
    ]) {
      const eventId = await ctx.db.insert("events", { ...event, ...readEventSchedule(event), title: event.slug, sortTitle: event.slug,
        communityProfileId: communityId, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
      const document = createEventSearchDocument((await ctx.db.get(eventId))!, { community });
      await ctx.db.insert("searchDocuments", { ...document, featuredRank: 42 });
    }
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      const discovery = await t.query(api.search.listDiscovery, { now });
      assert.deepEqual(discovery.upcomingEvents.map(event => event.slug), ["long-active", "no-end-active", "future"], `switch=${enabled}`);
      assert.equal(discovery.upcomingEvents.find(event => event.slug === "no-end-active")?.endAt, undefined);
    }
    const addRows = async (kind: "old-unknown" | "future-budget" | "recent-ended-budget") => t.run(async ctx => {
      const community = (await ctx.db.query("profiles").withIndex("by_slug", query => query.eq("slug", "scan-club")).unique())!;
      for (let index = 0; index < 501; index++) {
        const schedule = kind === "old-unknown" ? { startAt: now - 72 * hour }
          : kind === "future-budget" ? { startAt: now + 5 * 60_000, endAt: now + 20 * 60_000 }
          : { startAt: now - 30 * 60_000, endAt: now - 29 * 60_000 };
        const slug = `${kind}-${index}`;
        const eventId = await ctx.db.insert("events", { ...schedule, ...readEventSchedule(schedule), slug, title: slug, sortTitle: slug,
          communityProfileId: community._id, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
        await ctx.db.insert("searchDocuments", { ...createEventSearchDocument((await ctx.db.get(eventId))!, { community }), featuredRank: 42 });
      }
    });
    await addRows("old-unknown");
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      assert.deepEqual((await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug), ["long-active", "no-end-active", "future"]);
    }
    await addRows("future-budget");
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      const slugs = (await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug);
      // Future starts can fill the raw end-index budget. The separate started
      // scan still recovers the no-end event, and the future scan still returns.
      assert.equal(slugs.includes("long-active"), false);
      assert.equal(slugs.includes("no-end-active"), true);
      assert.equal(slugs.some(slug => slug.startsWith("future-budget-")), true);
    }
    await addRows("recent-ended-budget");
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      const slugs = (await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug);
      // More than 500 newer starts can fill the raw start budget. This is an
      // explicit capacity limit; neither raw scan grows to cover those rows.
      assert.equal(slugs.includes("no-end-active"), false);
      assert.equal(slugs.some(slug => slug.startsWith("future-budget-")), true);
    }
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});

it("preserves explicit runtime ends and the date-only UTC-12 expiry", () => {
  const startAt = Date.UTC(2026, 6, 4);
  assert.equal(eventSortEndAt({ startAt, endAt: startAt + 1000 }), startAt + 1000);
  assert.equal(eventSortEndAt({ scheduleKind: "date_only", eventDate: "2026-07-04", startAt, endAt: startAt + 1000 }), startAt + 36 * 3_600_000 - 1);
});

it("caps legacy future raw candidates when more than 500 non-event rows share the start index", async () => {
  const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = Date.now();
  await t.run(async ctx => {
    const communityId = await ctx.db.insert("profiles", { slug: "future-cap-club", displayName: "Future Cap Club", sortName: "future cap club",
      profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self",
      publicationState: "published", publicSurfacingState: "public", updatedAt: 1 });
    const community = (await ctx.db.get(communityId))!;
    const eventId = await ctx.db.insert("events", { slug: "future-cap-event", title: "Future Cap Event", sortTitle: "future cap event",
      ...readEventSchedule({ startAt: now + 3_600_000 }), communityProfileId: communityId, eventStatus: "scheduled",
      publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
    const document = createEventSearchDocument((await ctx.db.get(eventId))!, { community });
    await ctx.db.insert("searchDocuments", { ...document, featuredRank: 8 });
    // The featured event fallback must not mask the legacy future scan limit.
    for (let index = 0; index < 501; index++) {
      const slug = `future-cap-expired-${index}`;
      const expiredId = await ctx.db.insert("events", { slug, title: slug, sortTitle: slug,
        ...readEventSchedule({ startAt: now - 48 * 3_600_000 }), endAt: now - 47 * 3_600_000,
        communityProfileId: communityId, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
      await ctx.db.insert("searchDocuments", { ...createEventSearchDocument((await ctx.db.get(expiredId))!, { community }), featuredRank: 42 });
      const { eventId: _eventId, ...nonEventDocument } = document;
      await ctx.db.insert("searchDocuments", { ...nonEventDocument, entityType: "world", slug: `future-non-event-${index}`,
        startsAt: now + 60_000, sortAt: now + 60_000 });
    }
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    process.env.EVENT_DATE_ONLY_ENABLED = "false";
    assert.deepEqual((await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug), []);
    process.env.EVENT_DATE_ONLY_ENABLED = "true";
    assert.deepEqual((await t.query(api.search.listDiscovery, { now })).upcomingEvents.map(event => event.slug), ["future-cap-event"]);
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});
