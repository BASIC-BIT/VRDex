"use node";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { posthogClaimAnalyticsConfig } from "./claimAnalyticsDelivery";

type DeliveryResult = { delivered: number; configured: boolean };

export const deliverPending = internalAction({
  args: {},
  handler: async (ctx): Promise<DeliveryResult> => {
    const config = posthogClaimAnalyticsConfig(process.env);
    if (config === null) return { delivered: 0, configured: false };

    const row: Doc<"productAnalyticsOutbox"> | null = await ctx.runMutation(
      internal.productAnalytics.claimNext,
      {},
    );
    if (row === null) return { delivered: 0, configured: true };

    try {
      const response = await fetch(config.captureUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: config.projectKey,
          event: row.event,
          timestamp: new Date(row.createdAt).toISOString(),
          properties: {
            distinct_id: row.distinctId,
            $insert_id: row._id,
            $process_person_profile: false,
            ...row.properties,
          },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      await response.text();
      if (response.ok) {
        await ctx.runMutation(internal.productAnalytics.recordSuccess, { outboxId: row._id });
        return { delivered: 1, configured: true };
      }
    } catch {
      // Fall through to the retry schedule.
    }
    await ctx.runMutation(internal.productAnalytics.recordFailure, { outboxId: row._id });
    return { delivered: 0, configured: true };
  },
});
