import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { eventSortAt, eventSortEndAt, readEventSchedule } from "./_eventSchedule";

const phases = ["events", "eventParticipants", "eventWorlds", "eventSlots", "searchDocuments"] as const;
const phaseValidator = v.union(v.literal("events"), v.literal("eventParticipants"), v.literal("eventWorlds"), v.literal("eventSlots"), v.literal("searchDocuments"));

// Caller persists the returned phase/cursor. Repeating any page is safe.
export const backfill = internalMutation({
  args: { phase: v.optional(phaseValidator), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  returns: v.object({ phase: phaseValidator, cursor: v.union(v.string(), v.null()), done: v.boolean(), processed: v.number() }),
  handler: async (ctx, args) => {
    const phase = args.phase ?? "events";
    const batchSize = args.batchSize ?? 100;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Migration batch size must be between 1 and 100.");
    const page = await ctx.db.query(phase).paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    for (const row of page.page) {
      if (phase === "events") {
        const event = await ctx.db.get(row._id as import("./_generated/dataModel").Id<"events">);
        if (event) await ctx.db.patch(event._id, readEventSchedule(event));
      } else if ("eventId" in row && row.eventId !== undefined) {
        const event = await ctx.db.get(row.eventId);
        if (!event) continue;
        if (phase === "searchDocuments") {
          await ctx.db.patch(row._id, { sortAt: eventSortAt(event), scheduleKind: event.scheduleKind ?? "timed", eventDate: readEventSchedule(event).eventDate,
            startsAt: event.startAt });
        } else {
          await ctx.db.patch(row._id, { eventSortAt: eventSortAt(event), eventStartAt: event.startAt,
            ...(phase === "eventSlots" ? {} : { eventEndAt: event.endAt ?? event.startAt, eventSortEndAt: eventSortEndAt(event) }) });
        }
      }
    }
    const nextPhase = phases[phases.indexOf(phase) + 1];
    return { processed: page.page.length, done: page.isDone && nextPhase === undefined,
      phase: page.isDone ? nextPhase ?? phase : phase, cursor: page.isDone ? null : page.continueCursor };
  },
});
