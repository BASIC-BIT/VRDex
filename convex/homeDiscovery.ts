import { v } from "convex/values";
import { query } from "./_generated/server";
import { isPublicEventPerformer } from "./_eventPublic";
import { dateOnlyEventsEnabled } from "./_eventSchedule";
import { DISCOVERY_PAGE_SIZE, DISCOVERY_ROSTER_SIZE, discoveryBatch, discoveryBounds, discoveryContinuation, discoveryCursor, discoveryProfile, discoveryReads, discoveryRequestScope } from "./_homeDiscovery";
import type { DiscoveryEventCandidate, DiscoveryEventSignal, DiscoveryPage, DiscoveryProfileSignal, FavoriteLineupResult } from "./_homeDiscoveryTypes";

const direction = v.union(v.literal("asc"), v.literal("desc"));
export const listEvents = query({
  args: { now: v.number(), timeZone: v.string(), band: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)),
    kind: v.union(v.literal("timed"), v.literal("date_only")), direction, cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DiscoveryPage<DiscoveryEventCandidate>> => {
    const bounds = discoveryBounds(args);
    const scope = discoveryRequestScope(args);
    const cursor = discoveryCursor(args.cursor, scope);
    if (args.kind === "date_only" && !dateOnlyEventsEnabled()) return { items: [], cursor: null, complete: true };
    const source = args.kind === "timed"
      ? ctx.db.query("events").withIndex("by_publicationState_eventStatus_startAt", q => {
        const lower = q.eq("publicationState", "published").eq("eventStatus", "scheduled").gte("startAt", bounds.startAt);
        return bounds.endAt === undefined ? lower : lower.lt("startAt", bounds.endAt);
      })
      : ctx.db.query("events").withIndex("by_publicationState_eventStatus_eventDate", q => {
        const lower = q.eq("publicationState", "published").eq("eventStatus", "scheduled").gte("eventDate", bounds.from);
        return bounds.until === undefined ? lower : lower.lt("eventDate", bounds.until);
      });
    const page = await source.order(args.direction).paginate({ cursor, numItems: DISCOVERY_PAGE_SIZE, maximumRowsRead: DISCOVERY_PAGE_SIZE });
    const reads = discoveryReads(ctx.db);
    const items: DiscoveryEventCandidate[] = [];
    for (const row of page.page) {
      if (args.kind === "date_only" ? row.scheduleKind !== "date_only" : row.scheduleKind === "date_only") continue;
      const candidate = await reads.candidate(row);
      if (candidate !== null) items.push(candidate);
    }
    const next = discoveryContinuation(scope, page);
    return { items, cursor: next, complete: next === null };
  },
});
export const listClubs = query({
  args: { direction, cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DiscoveryPage<DiscoveryProfileSignal>> => {
    const scope = JSON.stringify(["clubs", args.direction]);
    const page = await ctx.db.query("profiles").withIndex("by_profileType_publicationState", q => q.eq("profileType", "community").eq("publicationState", "published"))
      .order(args.direction).paginate({ cursor: discoveryCursor(args.cursor, scope), numItems: DISCOVERY_PAGE_SIZE, maximumRowsRead: DISCOVERY_PAGE_SIZE });
    const items: DiscoveryProfileSignal[] = [];
    for (const row of page.page) {
      const signal = await discoveryProfile(ctx.db, row);
      if (signal !== null) items.push(signal);
    }
    const cursor = discoveryContinuation(scope, page);
    return { items, cursor, complete: cursor === null };
  },
});
export const eventSignals = query({
  args: { eventIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ items: DiscoveryEventSignal[] }> => {
    const ids = discoveryBatch(args.eventIds, 4);
    const reads = discoveryReads(ctx.db);
    const items: DiscoveryEventSignal[] = [];
    for (const raw of ids) {
      const id = ctx.db.normalizeId("events", raw);
      const event = id === null ? null : await ctx.db.get(id);
      if (event === null || await reads.candidate(event) === null) continue;
      // Nine rows per source: eight inspected associations and one coverage probe.
      const [slots, lineup, participants] = await Promise.all([
        ctx.db.query("eventSlots").withIndex("by_eventId_reviewState_startAt", q => q.eq("eventId", event._id).eq("reviewState", "confirmed")).take(DISCOVERY_ROSTER_SIZE + 1),
        ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", event._id)).take(DISCOVERY_ROSTER_SIZE + 1),
        ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", event._id)).take(DISCOVERY_ROSTER_SIZE + 1),
      ]);
      const performers = new Map<string, DiscoveryProfileSignal>();
      const manualLabels: string[] = [];
      for (const row of slots.slice(0, DISCOVERY_ROSTER_SIZE)) {
        const performer = await reads.performer(row.personProfileId);
        if (performer !== null) performers.set(performer.id, performer);
        else if (row.personProfileId === undefined) manualLabels.push(row.displayLabel);
      }
      for (const row of lineup.slice(0, DISCOVERY_ROSTER_SIZE)) {
        const performer = await reads.performer(row.personProfileId);
        if (performer !== null) performers.set(performer.id, performer);
        else if (row.personProfileId === undefined) manualLabels.push(row.performerLabel);
      }
      for (const row of participants.slice(0, DISCOVERY_ROSTER_SIZE)) {
        if (row.confirmationState !== "confirmed" || row.roleLabel.trim().toLowerCase() !== "dj") continue;
        const performer = await reads.performer(row.personProfileId);
        if (performer !== null) performers.set(performer.id, performer);
      }
      items.push({ eventId: event._id, performers: [...performers.values()], manualLabels,
        coverage: [slots, lineup, participants].some(rows => rows.length > DISCOVERY_ROSTER_SIZE) ? "partial" : "complete" });
    }
    return { items };
  },
});
export const profileSignals = query({
  args: { profileIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ items: DiscoveryProfileSignal[] }> => {
    const items: DiscoveryProfileSignal[] = [];
    for (const raw of discoveryBatch(args.profileIds, 50)) {
      const id = ctx.db.normalizeId("profiles", raw);
      const profile = id === null ? null : await ctx.db.get(id);
      const signal = profile === null ? null : await discoveryProfile(ctx.db, profile);
      if (signal !== null) items.push(signal);
    }
    return { items };
  },
});

/** Complete selected-card membership, independent of the bounded ranking sample. */
export const favoriteLineup = query({
  args: { eventIds: v.array(v.string()), favoriteProfileIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<FavoriteLineupResult> => {
    // Validate raw input before deduplication so repeated IDs cannot bypass limits.
    if (args.eventIds.length > 2 || args.favoriteProfileIds.length > 25) throw new Error("Too many favorite lineup IDs");
    const reads = discoveryReads(ctx.db);
    const items: FavoriteLineupResult["items"] = [];
    for (const raw of new Set(args.eventIds)) {
      const eventId = ctx.db.normalizeId("events", raw);
      const event = eventId === null ? null : await ctx.db.get(eventId);
      if (event === null || await reads.candidate(event) === null) continue;
      const performers: FavoriteLineupResult["items"][number]["performers"] = [];
      for (const rawProfileId of new Set(args.favoriteProfileIds)) {
        const personProfileId = ctx.db.normalizeId("profiles", rawProfileId);
        const person = personProfileId === null ? null : await reads.profile(personProfileId);
        if (!isPublicEventPerformer(person)) continue;
        // Exact-key existence reads cover all public detail roles without scanning
        // rosters. Date-only detail deliberately excludes authored timed slots.
        const [slot, lineup, participant] = await Promise.all([
          event.scheduleKind === "date_only" ? null : ctx.db.query("eventSlots")
            .withIndex("by_eventId_personProfileId_reviewState", q => q.eq("eventId", event._id).eq("personProfileId", person._id).eq("reviewState", "confirmed")).first(),
          ctx.db.query("eventLineupEntries")
            .withIndex("by_eventId_personProfileId", q => q.eq("eventId", event._id).eq("personProfileId", person._id)).first(),
          ctx.db.query("eventParticipants")
            .withIndex("by_eventId_personProfileId_confirmationState", q => q.eq("eventId", event._id).eq("personProfileId", person._id).eq("confirmationState", "confirmed")).first(),
        ]);
        if (slot !== null || lineup !== null || participant !== null) {
          performers.push({ id: person._id, slug: person.slug, displayName: person.displayName });
        }
      }
      items.push({ eventId: event._id, performers });
    }
    return { items };
  },
});
