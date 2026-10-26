import { v } from "convex/values";
import { api } from "./_generated/api";
import { query } from "./_generated/server";
import { encodeTimelineCursor, overlapsTimeline, readTimelineCursor, timelineDateBounds, timelineEventIdentity, timelineLimit, timelinePerformer, timelineSchedule, timelineSlot, validateTimelineRange } from "./_eventTimeline";
import type { EventPhase, RosterPhase } from "./_eventTimeline";
import type { SavedResolution, TimelinePage, TimelineRosterPage } from "./_eventTimelineTypes";

const rangeValidator = v.object({ startAt: v.number(), endAt: v.number(), timeZone: v.string() });
const referenceValidator = v.union(
  v.object({ kind: v.literal("event"), eventId: v.string() }),
  v.object({ kind: v.literal("set"), eventId: v.string(), slotId: v.string() }),
);
const eventPhases: readonly EventPhase[] = ["starts", "ongoing", "dates"];
const rosterPhases: readonly RosterPhase[] = ["slots", "lineup", "participants"];
// Each nested query has its own single pagination context. No full-detail projection is loaded.

export const listPublic = query({
  args: { range: rangeValidator, cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<TimelinePage> => {
    validateTimelineRange(args.range);
    const limit = timelineLimit(args.limit);
    const state = readTimelineCursor(args.cursor, "events", args.range, eventPhases, "starts");
    const { first, last } = timelineDateBounds(args.range);
    const source = state.phase === "starts"
      ? ctx.db.query("events").withIndex("by_publicationState_eventStatus_startAt", q => q.eq("publicationState", "published").eq("eventStatus", "scheduled").gte("startAt", args.range.startAt).lt("startAt", args.range.endAt))
      : state.phase === "ongoing"
        ? ctx.db.query("events").withIndex("by_publicationState_eventStatus_endAt", q => q.eq("publicationState", "published").eq("eventStatus", "scheduled").gt("endAt", args.range.startAt))
        : ctx.db.query("events").withIndex("by_publicationState_eventStatus_eventDate", q => q.eq("publicationState", "published").eq("eventStatus", "scheduled").gte("eventDate", first).lte("eventDate", last));
    const page = await source.paginate({ numItems: limit, cursor: state.databaseCursor, maximumRowsRead: limit });
    const items: TimelinePage["items"] = [];
    for (const event of page.page) {
      const schedule = timelineSchedule(event);
      if (schedule === null || !overlapsTimeline(schedule, args.range)) continue;
      // Phases are disjoint even when a record has both an authored date and start.
      if (state.phase === "dates" ? schedule.kind !== "date_only"
        : schedule.kind === "date_only" || (state.phase === "ongoing" && schedule.startAt >= args.range.startAt)) continue;
      const identity = await timelineEventIdentity(ctx.db, event);
      if (identity === null) continue;
      const roster = await ctx.runQuery(api.eventTimeline.listPublicRoster, { eventId: event._id, range: args.range });
      items.push({ ...identity, slots: roster.items, performers: roster.performers, rosterCursor: roster.cursor });
    }
    const next = state.phase === "starts" ? "ongoing" : state.phase === "ongoing" ? "dates" : null;
    const cursor = page.isDone
      ? next === null ? null : encodeTimelineCursor("events", args.range, { phase: next, databaseCursor: null })
      : encodeTimelineCursor("events", args.range, { phase: state.phase, databaseCursor: page.continueCursor });
    return { items, cursor, complete: cursor === null };
  },
});

export const listPublicRoster = query({
  args: { eventId: v.string(), range: rangeValidator, cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<TimelineRosterPage> => {
    validateTimelineRange(args.range);
    const eventId = ctx.db.normalizeId("events", args.eventId);
    if (eventId === null) throw new Error("Invalid timeline event ID");
    const scope = `roster:${eventId}`;
    const state = readTimelineCursor(args.cursor, scope, args.range, rosterPhases, "slots");
    const event = await ctx.db.get(eventId);
    const empty: TimelineRosterPage = { items: [], performers: [], cursor: null, complete: true };
    if (event === null || await timelineEventIdentity(ctx.db, event, { includeHostImage: false }) === null) return empty;
    const options = { numItems: 80, cursor: state.databaseCursor, maximumRowsRead: 80 };
    const items: TimelineRosterPage["items"] = [];
    const people = new Map<string, TimelineRosterPage["performers"][number]>();
    let continuation: { isDone: boolean; continueCursor: string };
    switch (state.phase) {
      case "slots": {
        const page = await ctx.db.query("eventSlots").withIndex("by_eventId_reviewState_startAt", q => q.eq("eventId", eventId).eq("reviewState", "confirmed")).paginate(options);
        continuation = page;
        for (const row of page.page) {
          if (event.scheduleKind === "date_only") continue;
          const slot = await timelineSlot(ctx.db, row);
          if (slot === null) continue;
          if (slot.performer !== undefined) people.set(slot.performer.id, slot.performer);
          if (overlapsTimeline(slot.schedule, args.range)) items.push(slot);
        }
        break;
      }
      case "lineup": {
        const page = await ctx.db.query("eventLineupEntries").withIndex("by_eventId_position", q => q.eq("eventId", eventId)).paginate(options);
        continuation = page;
        for (const row of page.page) {
          const person = await timelinePerformer(ctx.db, row.personProfileId);
          if (person !== undefined) people.set(person.id, person);
        }
        break;
      }
      case "participants": {
        const page = await ctx.db.query("eventParticipants").withIndex("by_eventId", q => q.eq("eventId", eventId)).paginate(options);
        continuation = page;
        for (const row of page.page) {
          if (row.confirmationState !== "confirmed") continue;
          const person = await timelinePerformer(ctx.db, row.personProfileId);
          if (person !== undefined) people.set(person.id, person);
        }
        break;
      }
    }
    const next = state.phase === "slots" ? "lineup" : state.phase === "lineup" ? "participants" : null;
    const cursor = continuation.isDone
      ? next === null ? null : encodeTimelineCursor(scope, args.range, { phase: next, databaseCursor: null })
      : encodeTimelineCursor(scope, args.range, { phase: state.phase, databaseCursor: continuation.continueCursor });
    return { items, performers: [...people.values()], cursor, complete: cursor === null };
  },
});

export const resolveSaved = query({
  args: { references: v.array(referenceValidator) },
  handler: async (ctx, args): Promise<SavedResolution[]> => {
    if (args.references.length > 50) throw new Error("Too many saved references");
    const results: SavedResolution[] = [];
    for (const reference of args.references) {
      const unavailable = { reference, kind: "unavailable" } satisfies SavedResolution;
      const eventId = ctx.db.normalizeId("events", reference.eventId);
      const record = eventId === null ? null : await ctx.db.get(eventId);
      const event = record === null ? null : await timelineEventIdentity(ctx.db, record, { includeCancelled: true });
      if (event === null) { results.push(unavailable); continue; }
      if (reference.kind === "event") {
        results.push({ reference, kind: "available", event, status: event.status });
        continue;
      }
      const slotId = ctx.db.normalizeId("eventSlots", reference.slotId);
      const row = slotId === null ? null : await ctx.db.get(slotId);
      if (row === null || row.eventId !== eventId || event.schedule.kind === "date_only") { results.push(unavailable); continue; }
      const slot = await timelineSlot(ctx.db, row);
      results.push(slot === null ? unavailable : { reference, kind: "available", event, status: event.status, slot });
    }
    return results;
  },
});
