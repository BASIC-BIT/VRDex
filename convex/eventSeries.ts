import { ConvexError, v } from "convex/values";

import { requireClubPermission, resolveClubActor } from "./_clubAccess";
import { getPublicEventPreviews, getPublishedCommunity } from "./_eventPublic";
import {
  applySeriesFields,
  createSeriesFromEvent,
  fanOutSeriesEdit,
  isSeriesOwnedEventField,
  isUpcomingNight,
  materializeSeries,
  retireOccurrences,
  seriesOverridesFor,
  seriesUpdatePatch,
} from "./_eventSeries";
import { eventDateForInstant } from "./_eventSchedule";
import {
  eventSeriesRuleValidator,
  recurringEventsEnabled,
  requireRecurringEventsEnabled,
  seriesRepeatValidator,
  type SeriesOwnedEventField,
} from "./_eventSeriesModel";
import { enqueueEventSync } from "./_eventSync";
import { getEventBySlug, validateEventSlug } from "./_eventSlugs";
import { requireUser } from "./_identity";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { eventDraftArgs } from "./events";

const nullableString = v.optional(v.union(v.string(), v.null()));

type MaterializeResult = { created: Id<"events">[]; adopted: Id<"events">[]; skipped: string[] };

export const materialize = internalMutation({
  args: { seriesId: v.id("eventSeries") },
  handler: async (ctx, { seriesId }): Promise<MaterializeResult> =>
    recurringEventsEnabled()
      ? materializeSeries(ctx, seriesId, Date.now())
      : { created: [], adopted: [], skipped: [] },
});

export const listActiveSeriesIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"eventSeries">[]> =>
    (await ctx.db.query("eventSeries").withIndex("by_state", (q) => q.eq("state", "active")).collect()).map((series) => series._id),
});

/** Binds the ops alert sender at construction so tests can fake it. */
export function createMaterializeAll(alerts: { notify: typeof notifyOps; resolve: typeof resolveOps }) {
  return internalAction({
    args: {},
    handler: async (ctx): Promise<null> => {
      if (!recurringEventsEnabled()) return null;
      const seriesIds: Id<"eventSeries">[] = await ctx.runQuery(internal.eventSeries.listActiveSeriesIds, {});
      // ponytail: sequential runMutation per active series; fan out with the scheduler if the daily run nears the action time limit
      for (const seriesId of seriesIds) {
        const key = "series_materialize_failed:" + seriesId;
        // Each series is its own transaction, so a failure rolls back only that series and alerts outside it.
        try {
          await ctx.runMutation(internal.eventSeries.materialize, { seriesId });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await alerts.notify(ctx, { key, subject: "Series materialisation failed", body: seriesId + ": " + message });
          } catch (alertError) {
            console.error("series alert failed", { seriesId, alertError });
          }
          continue;
        }
        try {
          await alerts.resolve(ctx, key);
        } catch (alertError) {
          console.error("series alert resolve failed", { seriesId, alertError });
        }
      }
      return null;
    },
  });
}

export const materializeAll = createMaterializeAll({ notify: notifyOps, resolve: resolveOps });

export const isEnabled = query({
  args: {},
  handler: async (): Promise<boolean> => recurringEventsEnabled(),
});

export const getPublic = query({
  args: { seriesId: v.string() },
  handler: async (ctx, args) => {
    const seriesId = ctx.db.normalizeId("eventSeries", args.seriesId);
    const series = seriesId === null ? null : await ctx.db.get(seriesId);
    if (series === null || series.state === "removed") return null;
    const community = await getPublishedCommunity(ctx.db, series);
    if (community === undefined) return null;
    const now = Date.now();
    const today = eventDateForInstant(now, series.timezone);
    const events = await ctx.db
      .query("events")
      .withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", series._id).gte("occurrenceDate", today))
      .collect();
    const ids = new Map(events.map((event) => [event.slug, event._id]));
    const previews = await getPublicEventPreviews(ctx.db, events, { now, limit: 20 });
    return {
      id: series._id,
      title: series.title,
      ...(series.summary === undefined ? {} : { summary: series.summary }),
      communitySlug: community.slug,
      communityName: community.displayName,
      nights: previews.flatMap(({ slug, ...night }) => (slug === undefined ? [] : [{ ...night, slug, id: ids.get(slug)! }])),
    };
  },
});

export const create = mutation({
  args: { eventSlug: v.string(), repeat: seriesRepeatValidator },
  handler: async (ctx, { eventSlug, repeat }): Promise<{ seriesId: Id<"eventSeries">; created: number }> => {
    requireRecurringEventsEnabled();
    const validation = validateEventSlug(eventSlug);
    if (!validation.ok) throw new Error("Current event code is invalid.");
    const event = await getEventBySlug(ctx.db, validation.slug);
    if (event === null) throw new Error("Event was not found.");
    // An event without a community has no club to manage it.
    if (event.communityProfileId === undefined) throw new Error("You do not have access to this action.");
    requireClubPermission(await resolveClubActor(ctx, event.communityProfileId), "manage_events");
    return createSeriesFromEvent(ctx, event, repeat, (await requireUser(ctx)).userId, Date.now());
  },
});

export const end = mutation({
  args: { seriesId: v.id("eventSeries"), state: v.optional(v.union(v.literal("ended"), v.literal("removed"))) },
  handler: async (ctx, { seriesId, state = "ended" }): Promise<{ unpublished: Id<"events">[]; detached: Id<"events">[] }> => {
    requireRecurringEventsEnabled();
    const series = await ctx.db.get(seriesId);
    if (series === null) throw new Error("Series was not found.");
    requireClubPermission(await resolveClubActor(ctx, series.communityProfileId), "manage_events");
    const now = Date.now();
    const ended = { ...series, state, endsOn: eventDateForInstant(now, series.timezone), updatedAt: now };
    await ctx.db.patch(seriesId, { state, endsOn: ended.endsOn, updatedAt: now });
    return retireOccurrences(ctx, ended, now);
  },
});

export const update = mutation({
  args: {
    seriesId: v.id("eventSeries"),
    title: v.optional(v.string()),
    summary: nullableString,
    timezone: v.optional(v.string()),
    venueLabel: nullableString,
    worldSlug: nullableString,
    mediaLinks: eventDraftArgs.mediaLinks,
    watchMode: eventDraftArgs.watchMode,
    watchSurfaceEnabled: v.optional(v.boolean()),
    bannerImageUrl: nullableString,
    thumbnailImageUrl: nullableString,
    sourceUrl: nullableString,
    rule: v.optional(eventSeriesRuleValidator),
    endsOn: nullableString,
    count: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { seriesId, ...update }): Promise<{ seriesId: Id<"eventSeries">; changed: SeriesOwnedEventField[] }> => {
    requireRecurringEventsEnabled();
    const series = await ctx.db.get(seriesId);
    if (series === null) throw new Error("Series was not found.");
    requireClubPermission(await resolveClubActor(ctx, series.communityProfileId), "manage_events");
    const now = Date.now();
    const { patch, changed, datesChanged } = await seriesUpdatePatch(ctx.db, series, update, now);
    await ctx.db.patch(seriesId, { ...patch, updatedAt: now });
    const updated = (await ctx.db.get(seriesId))!;
    // An ended or removed series has already retired its upcoming nights, so only the series record changes.
    if (updated.state === "active") {
      if (datesChanged) await retireOccurrences(ctx, updated, now);
      // Retired nights are unpublished or detached by now, so fan-out never enqueues one of them a second time.
      for (const eventId of await fanOutSeriesEdit(ctx, updated, changed)) {
        await enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert");
      }
      await materializeSeries(ctx, seriesId, now);
    }
    return { seriesId, changed };
  },
});

export const resetOverride = mutation({
  args: { eventId: v.id("events"), field: v.string() },
  handler: async (ctx, { eventId, field }): Promise<{ eventId: Id<"events">; changed: boolean }> => {
    requireRecurringEventsEnabled();
    const event = await ctx.db.get(eventId);
    if (event === null) throw new Error("Event was not found.");
    if (event.communityProfileId === undefined) throw new Error("You do not have access to this action.");
    requireClubPermission(await resolveClubActor(ctx, event.communityProfileId), "manage_events");
    if (event.moderationRemovedAt !== undefined) throw new ConvexError({ code: "REMOVED_EVENT" });
    const overrides = event.overrides ?? [];
    if (!isSeriesOwnedEventField(field) || !overrides.includes(field)) throw new Error("Field is not overridden on this night.");
    const series = event.seriesId === undefined ? null : await ctx.db.get(event.seriesId);
    if (series === null) throw new Error("Series was not found.");
    const now = Date.now();
    if (!isUpcomingNight(series, event, now)) throw new Error("Only upcoming nights can be reset.");
    await ctx.db.patch(eventId, { overrides: overrides.filter((name) => name !== field), updatedAt: now });
    const changed = await applySeriesFields(ctx, series, (await ctx.db.get(eventId))!, [field], now);
    // Throwing rolls the transaction back, so the night keeps a time it cannot give up, and its override.
    const after = (await ctx.db.get(eventId))!;
    if (!changed && (await seriesOverridesFor(ctx.db, series, after, after.occurrenceDate!)).includes(field)) {
      throw new Error("Series times do not fit this night.");
    }
    await enqueueEventSync(ctx.db, ctx.scheduler, eventId, "upsert");
    return { eventId, changed };
  },
});
