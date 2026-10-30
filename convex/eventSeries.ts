import { v } from "convex/values";

import { materializeSeries } from "./_eventSeries";
import { recurringEventsEnabled } from "./_eventSeriesModel";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";

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
