import { dateOnlyEventsEnabled, eventSortAt, eventSortEndAt } from "./_eventSchedule";
import { UNKNOWN_EVENT_END_WINDOW_MS } from "./_eventRuntime";
import { v } from "convex/values";

import { internalMutation, query, type QueryCtx } from "./_generated/server";
import {
  reindexWorldSearchDocument,
  sortSearchResults,
  toPublicSearchResult,
  type SearchEntityType,
  upsertSearchDocument,
} from "./_searchDocuments";
import {
  isPublicEventSearchDocument,
  projectPublicSearchResult,
  searchPublicDocuments,
} from "./_publicSearch";
import { SEEDED_VOCABULARY_TERMS, recordVocabularyTerms } from "./_vocabulary";

const SEARCH_RESULT_LIMIT = 24;
const DISCOVERY_SECTION_LIMIT = 8;
const DISCOVERY_EVENT_SCAN_LIMIT = 500;
const DISCOVERY_EVENT_VOCABULARY_SCAN_LIMIT = 500;

const searchEntityType = v.union(
  v.literal("profile"),
  v.literal("world"),
  v.literal("event"),
);

const searchProfileType = v.union(
  v.literal("person"),
  v.literal("community"),
);

export const searchUniversal = query({
  args: {
    query: v.string(),
    entityType: v.optional(searchEntityType),
    profileType: v.optional(searchProfileType),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await searchPublicDocuments(
      ctx,
      args,
      { defaultLimit: SEARCH_RESULT_LIMIT, maxLimit: 50 },
    );
  },
});

async function listDocumentsByType(
  ctx: QueryCtx,
  entityType: SearchEntityType,
  limit = 40,
) {
  return await ctx.db
    .query("searchDocuments")
    .withIndex("by_publicState_entityType_featuredRank", (index) =>
      index.eq("publicState", "public").eq("entityType", entityType),
    )
    .order("desc")
    .take(limit);
}

async function listUpcomingEventDocuments(ctx: QueryCtx, now: number) {
  // Explicit ends can extend past the unknown-end lookback. Hydrate their
  // existing search rows separately so they cannot consume the future scan.
  const [endCandidates, recentStartCandidates, startedCandidates] = await Promise.all([
    ctx.db.query("events")
      .withIndex("by_publicationState_eventStatus_endAt", index => index
        .eq("publicationState", "published").eq("eventStatus", "scheduled").gte("endAt", now))
      .take(DISCOVERY_EVENT_SCAN_LIMIT),
    ctx.db.query("events")
      .withIndex("by_publicationState_eventStatus_startAt", index => index
        .eq("publicationState", "published").eq("eventStatus", "scheduled")
        .gte("startAt", now - UNKNOWN_EVENT_END_WINDOW_MS).lte("startAt", now))
      .order("desc")
      .take(DISCOVERY_EVENT_SCAN_LIMIT),
    ctx.db.query("events")
      .withIndex("by_publicationState_eventStatus_startAt", index => index
        .eq("publicationState", "published").eq("eventStatus", "scheduled").lte("startAt", now))
      .order("desc")
      .take(DISCOVERY_EVENT_SCAN_LIMIT),
  ]);
  // Bound raw reads before applying the second predicate. Existing indexes
  // cannot express both start and end ranges in the same scan.
  const ongoingEvents = new Map([...endCandidates, ...recentStartCandidates, ...startedCandidates]
    .filter(event => event.startAt !== undefined && event.startAt <= now && eventSortEndAt(event) >= now)
    .map(event => [event._id, event]));
  const ongoingDocuments = (await Promise.all([...ongoingEvents.values()].map(event => ctx.db.query("searchDocuments")
    .withIndex("by_eventId", index => index.eq("eventId", event._id)).unique())))
    .filter((document): document is NonNullable<typeof document> => document !== null && document.publicState === "public");
  if (dateOnlyEventsEnabled()) {
    const [future, dateOnlyLookback] = await Promise.all([
      ctx.db.query("searchDocuments")
        .withIndex("by_publicState_entityType_sortAt", index => index
          .eq("publicState", "public").eq("entityType", "event").gte("sortAt", now))
        .take(DISCOVERY_EVENT_SCAN_LIMIT),
      ctx.db.query("searchDocuments")
        .withIndex("by_publicState_entityType_scheduleKind_sortAt", index => index
          .eq("publicState", "public").eq("entityType", "event").eq("scheduleKind", "date_only")
          .gt("sortAt", now - 36 * 60 * 60 * 1000).lt("sortAt", now))
        .take(DISCOVERY_EVENT_SCAN_LIMIT),
    ]);
    return [...ongoingDocuments, ...dateOnlyLookback, ...future];
  }
  const future = await ctx.db.query("searchDocuments")
    .withIndex("by_publicState_startsAt", index => index.eq("publicState", "public").gte("startsAt", now))
    .filter(query => query.eq(query.field("entityType"), "event"))
    .take(DISCOVERY_EVENT_SCAN_LIMIT);
  return [...ongoingDocuments, ...future];
}

async function listEventVocabularyDocuments(ctx: QueryCtx) {
  return await ctx.db
    .query("searchDocuments")
    .withIndex("by_publicState_entityType_featuredRank", (index) =>
      index.eq("publicState", "public").eq("entityType", "event"),
    )
    .order("desc")
    .take(DISCOVERY_EVENT_VOCABULARY_SCAN_LIMIT);
}

export const listDiscovery = query({
  args: {
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const [
      profiles,
      worlds,
      events,
      upcomingEventDocuments,
      vocabulary,
      eventVocabularyDocuments,
    ] = await Promise.all([
        listDocumentsByType(ctx, "profile"),
        listDocumentsByType(ctx, "world"),
        listDocumentsByType(ctx, "event", DISCOVERY_EVENT_SCAN_LIMIT),
        listUpcomingEventDocuments(ctx, now),
        ctx.db.query("vocabularyTerms").collect(),
        listEventVocabularyDocuments(ctx),
      ]);
    const projectedProfiles = await Promise.all(
      profiles.map((document) => projectPublicSearchResult(ctx, document, undefined)),
    );
    const profileResults = sortSearchResults(
      projectedProfiles.filter((result): result is NonNullable<typeof result> => result !== null),
    );
    const worldResults = sortSearchResults(worlds.map((document) => toPublicSearchResult(document, undefined)));
    const eventDocuments = new Map(events.map((document) => [document._id, document]));
    for (const document of upcomingEventDocuments) {
      eventDocuments.set(document._id, document);
    }
    const projectedEvents = await Promise.all(
      [...eventDocuments.values()].map((document) =>
        projectPublicSearchResult(ctx, document, undefined)),
    );
    const eventResults = sortSearchResults(
      projectedEvents.filter((result): result is NonNullable<typeof result> => result !== null),
    );
    const upcomingEvents = eventResults
      .filter((event) => event.scheduleKind === "date_only"
        ? eventSortEndAt(event) >= now
        : event.startsAt !== undefined && eventSortEndAt({ ...event, startAt: event.startsAt }) >= now)
      .sort((first, second) => eventSortAt({ ...first, startAt: first.startsAt }) - eventSortAt({ ...second, startAt: second.startsAt }))
      .slice(0, DISCOVERY_SECTION_LIMIT);
    const publicEventVocabularyKeys = new Set<string>();
    await Promise.all(
      eventVocabularyDocuments.map(async (document) => {
        if (!(await isPublicEventSearchDocument(ctx, document))) {
          return;
        }

        for (const key of document.vocabularyKeys ?? []) {
          publicEventVocabularyKeys.add(key);
        }
      }),
    );

    return {
      featured: sortSearchResults([...eventResults, ...profileResults, ...worldResults]).slice(0, 5),
      upcomingEvents,
      people: profileResults.filter((result) => result.profileType === "person").slice(0, DISCOVERY_SECTION_LIMIT),
      communities: profileResults
        .filter((result) => result.profileType === "community")
        .slice(0, DISCOVERY_SECTION_LIMIT),
      worlds: worldResults.slice(0, DISCOVERY_SECTION_LIMIT),
      terms: vocabulary
        .filter((term) =>
          term.source === "seeded" ||
          (term.scope !== "event_participant_role" && term.scope !== "event_tag") ||
          publicEventVocabularyKeys.has(`${term.scope}:${term.key}`),
        )
        .sort((first, second) => second.rank - first.rank || first.label.localeCompare(second.label))
        .slice(0, 18)
        .map((term) => ({
          scope: term.scope,
          key: term.key,
          label: term.label,
          usageCount: term.usageCount,
        })),
    };
  },
});

export const seedVocabulary = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    await recordVocabularyTerms(
      ctx.db,
      SEEDED_VOCABULARY_TERMS.map((term) => ({
        scope: term.scope,
        label: term.label,
        aliases: term.aliases,
        source: "seeded",
        rank: term.rank,
      })),
      now,
    );

    return { seeded: SEEDED_VOCABULARY_TERMS.length };
  },
});

export const rebuildWorldSearchDocuments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const worlds = await ctx.db.query("worlds").collect();

    for (const world of worlds) {
      // Delta-aware, so re-running this against already-indexed worlds does not
      // increment every existing tag and creator-role count again.
      await reindexWorldSearchDocument(ctx.db, world, now);
    }

    return { indexed: worlds.length };
  },
});
