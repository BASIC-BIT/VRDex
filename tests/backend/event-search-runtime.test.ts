import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { readEventSchedule } from "../../convex/_eventSchedule";
import { createEventSearchDocument } from "../../convex/_searchDocuments";
import { getPublicPersonUpcomingEvents } from "../../convex/_eventPublic";
import { replaceEventLineup } from "../../convex/_eventLineup";
import { syncPreservedEventAssociations } from "../../convex/events";
import { searchPublicDocuments } from "../../convex/_publicSearch";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

it("skips expired person history before event reads while retaining current cache and legacy fallback links", async context => {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  } });
  const now = Date.UTC(2026, 9, 13, 12);
  const hour = 3_600_000;
  const ids = await t.run(async ctx => {
    const base = { aliases: [], tags: [], claimState: "unclaimed" as const, creationSource: "self" as const,
      publicationState: "published" as const, publicSurfacingState: "public" as const, updatedAt: 1 };
    const communityId = await ctx.db.insert("profiles", { ...base, slug: "history-club", displayName: "History Club", sortName: "history club", profileType: "community", community: { categoryTags: [] } });
    const personId = await ctx.db.insert("profiles", { ...base, slug: "history-dj", displayName: "History DJ", sortName: "history dj", profileType: "person", person: { roleTags: [] } });
    const eventBase = { communityProfileId: communityId, eventStatus: "scheduled" as const, publicationState: "published" as const,
      sourceType: "community" as const, sourceLabel: "Club", updatedAt: 1 };
    const current = await ctx.db.insert("events", { ...eventBase, slug: "legacy-current", title: "Legacy Current", sortTitle: "legacy current", ...readEventSchedule({ startAt: now - hour }) });
    const long = await ctx.db.insert("events", { ...eventBase, slug: "long-current", title: "Long Current", sortTitle: "long current", ...readEventSchedule({ startAt: now - 48 * hour }), endAt: now + hour });
    const dateOnly = await ctx.db.insert("events", { ...eventBase, slug: "date-current", title: "Date Current", sortTitle: "date current", ...readEventSchedule({ scheduleKind: "date_only", eventDate: "2026-10-13" }) });
    for (const eventId of [current, long, dateOnly]) {
      const event = (await ctx.db.get(eventId))!;
      await replaceEventLineup(ctx.db, event, [{ clientKey: "person", position: 0, performerLabel: "History DJ", personSlug: "history-dj" }], now);
    }
    const longLink = (await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", long)).unique())!;
    assert.equal(longLink.eventEndAt, now + hour);
    assert.equal(longLink.eventSortEndAt, now + hour);
    await ctx.db.patch(long, { endAt: now + 2 * hour });
    await syncPreservedEventAssociations(ctx.db, (await ctx.db.get(long))!, now, { preserveParticipants: true, preserveSlots: false, preserveWorld: false });
    const updated = (await ctx.db.get(longLink._id))!;
    assert.equal(updated.eventEndAt, now + 2 * hour);
    assert.equal(updated.eventSortEndAt, now + 2 * hour);
    // Recover the legacy explicit-end cache even without its newer sort end.
    await ctx.db.patch(longLink._id, { eventSortEndAt: undefined });
    const currentLink = (await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", current)).unique())!;
    await ctx.db.patch(currentLink._id, { eventEndAt: now - hour, eventSortEndAt: now - hour });
    const history = [];
    for (let index = 0; index < 501; index++) {
      const startAt = now - (72 + index) * hour;
      const eventId = await ctx.db.insert("events", { ...eventBase, slug: `old-appearance-${index}`, title: "Old Appearance", sortTitle: "old appearance", ...readEventSchedule({ startAt }), endAt: startAt + hour });
      history.push(eventId);
      await ctx.db.insert("eventParticipants", { eventId, personProfileId: personId, eventStartAt: startAt, eventSortAt: startAt,
        eventEndAt: startAt + hour, eventSortEndAt: startAt + hour, eventPublicationState: "published", eventStatus: "scheduled",
        confirmationState: "confirmed", roleLabel: "DJ", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
    }
    return { personId, current, long, history };
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      const result = await t.run(async ctx => {
        const get = context.mock.method(ctx.db, "get");
        const events = await getPublicPersonUpcomingEvents(ctx.db, ids.personId, now);
        assert.equal(get.mock.calls.filter(call => ids.history.some(id => id === call.arguments[0])).length, 0, `expired event reads switch=${enabled}`);
        assert.equal(get.mock.calls.filter(call => call.arguments[0] === ids.current).length, 1);
        assert.equal(get.mock.calls.filter(call => call.arguments[0] === ids.long).length, 1);
        return events;
      });
      assert.deepEqual(result.map(event => event.slug).sort(), enabled === "true" ? ["date-current", "legacy-current", "long-current"] : ["legacy-current", "long-current"]);
    }
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});

it("ranks bounded event candidates from live schedules before applying the result limit", async context => {
  const t = convexTest({ schema, modules: {
    "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
    "../../convex/search.ts": () => import("../../convex/search"),
  } });
  const now = Date.UTC(2026, 9, 13, 12);
  const hour = 3_600_000;
  context.mock.method(Date, "now", () => now);
  const ids = await t.run(async ctx => {
    const communityId = await ctx.db.insert("profiles", { slug: "ranking-club", displayName: "Ranking Club", sortName: "ranking club",
      profileType: "community", community: { categoryTags: [] }, aliases: [], tags: [], claimState: "unclaimed", creationSource: "self",
      publicationState: "published", publicSurfacingState: "public", updatedAt: 1 });
    const community = (await ctx.db.get(communityId))!;
    const { _id: _communityId, _creationTime: _createdAt, ...communityFields } = community;
    const hiddenCommunityId = await ctx.db.insert("profiles", { ...communityFields,
      slug: "hidden-ranking-club", displayName: "Hidden Ranking Club", sortName: "hidden ranking club", publicSurfacingState: "suppressed" });
    const currentCommunityId = await ctx.db.insert("profiles", { ...communityFields,
      slug: "current-ranking-club", displayName: "Current Ranking Club", sortName: "current ranking club" });
    const events = [];
    for (const [slug, startAt, endAt, communityProfileId] of [
      ["a-expired-rank", now - hour, now - 1, communityId],
      ["z-current-rank", now - 24 * hour, now + hour, currentCommunityId],
      ["a-hidden-rank", now - hour, now + hour, hiddenCommunityId],
    ] as const) {
      const eventId = await ctx.db.insert("events", { slug, title: `${slug} Ranking Night`, sortTitle: slug,
        ...readEventSchedule({ startAt }), endAt, communityProfileId, eventStatus: "scheduled", publicationState: "published", sourceType: "community", sourceLabel: "Club", updatedAt: 1 });
      events.push(eventId);
      await ctx.db.insert("searchDocuments", { ...createEventSearchDocument((await ctx.db.get(eventId))!, { community }), featuredRank: 42 });
    }
    return { expired: events[0], current: events[1], hidden: events[2], communityId, hiddenCommunityId, currentCommunityId };
  });
  const previous = process.env.EVENT_DATE_ONLY_ENABLED;
  try {
    for (const enabled of ["false", "true"]) {
      process.env.EVENT_DATE_ONLY_ENABLED = enabled;
      for (const schedule of [
        { ...readEventSchedule({ startAt: now - 24 * hour }), endAt: now + hour },
        { ...readEventSchedule({ startAt: now - hour }), endAt: undefined },
        { ...readEventSchedule({ scheduleKind: "date_only", eventDate: "2026-10-13" }), startAt: undefined, endAt: undefined },
      ]) {
        // Leave the index schedule stale to prove that ranking reads the event.
        await t.run(ctx => ctx.db.patch(ids.current, schedule));
        const results = await t.query(api.search.searchUniversal, { query: "Ranking Night", entityType: "event", limit: 1 });
        assert.deepEqual(results.map(result => result.slug), ["z-current-rank"], `switch=${enabled}, schedule=${schedule.scheduleKind}`);
        assert.equal(results[0].endAt, schedule.endAt);
        assert.equal(results[0].routePath, "/current-ranking-club/events/z-current-rank");
        await t.run(async ctx => {
          const get = context.mock.method(ctx.db, "get");
          const result = await searchPublicDocuments(ctx, { query: "Ranking Night", entityType: "event", limit: 1 }, { defaultLimit: 24, maxLimit: 50 });
          assert.deepEqual(result.map(result => result.slug), ["z-current-rank"]);
          for (const id of [ids.current, ids.expired, ids.hidden]) {
            assert.equal(get.mock.calls.filter(call => call.arguments[0] === id).length, 1, "load each bounded event candidate once");
          }
          assert.equal(get.mock.calls.filter(call => call.arguments[0] === ids.communityId).length, 0, "skip the unselected event's community");
          assert.equal(get.mock.calls.filter(call => call.arguments[0] === ids.currentCommunityId).length, 1);
          assert.equal(get.mock.calls.filter(call => call.arguments[0] === ids.hiddenCommunityId).length, 1);
        });
        const ordered = await t.run(async ctx => {
          const get = context.mock.method(ctx.db, "get");
          const result = await searchPublicDocuments(ctx, { query: "Ranking Night", entityType: "event", limit: 2 }, { defaultLimit: 24, maxLimit: 50 });
          for (const id of [ids.current, ids.expired, ids.hidden]) {
            assert.equal(get.mock.calls.filter(call => call.arguments[0] === id).length, 1, "reuse the bounded live event record");
          }
          return result;
        });
        assert.deepEqual(ordered.map(result => result.slug), ["z-current-rank", "a-expired-rank"]);
      }
    }
  } finally { if (previous === undefined) delete process.env.EVENT_DATE_ONLY_ENABLED; else process.env.EVENT_DATE_ONLY_ENABLED = previous; }
});
