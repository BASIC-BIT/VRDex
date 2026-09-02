"use node";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

const DEFAULT_POSTHOG_INGEST_HOST = "https://us.i.posthog.com";
type DeliveryClaim = { row: Doc<"claimAnalyticsOutbox"> | null };
type DeliveryResult = { delivered: number; configured: boolean };

export function posthogClaimAnalyticsConfig(
  env: Record<string, string | undefined>,
): { projectKey: string; captureUrl: string } | null {
  const projectKey = env.POSTHOG_PROJECT_API_KEY?.trim();
  if (!projectKey || !projectKey.startsWith("phc_")) return null;

  const rawHost = env.POSTHOG_INGEST_HOST?.trim() || DEFAULT_POSTHOG_INGEST_HOST;
  let host: URL;
  try {
    host = new URL(rawHost);
  } catch {
    return null;
  }

  if (host.protocol !== "https:") return null;
  return { projectKey, captureUrl: new URL("/capture/", host).toString() };
}

export function posthogClaimEvent(row: Doc<"claimAnalyticsOutbox">) {
  return {
    api_key: "configured-at-delivery",
    event: row.event,
    timestamp: new Date(row.occurredAt).toISOString(),
    properties: {
      distinct_id: `claim:${row.journeyId}`,
      journey_id: row.journeyId,
      $insert_id: row.eventKey,
      $process_person_profile: false,
      profile_type: row.profileType,
      method: row.method,
      entry_source: row.entrySource,
      ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
      ...(row.connectionOnly === undefined
        ? {}
        : { connection_only: row.connectionOnly ? "true" : "false" }),
      ...(row.timeToFirstCheckBucket === undefined
        ? {}
        : { time_to_first_check_bucket: row.timeToFirstCheckBucket }),
      ...(row.timeToResolutionBucket === undefined
        ? {}
        : { time_to_resolution_bucket: row.timeToResolutionBucket }),
    },
  };
}

export const deliverPending = internalAction({
  args: {},
  handler: async (ctx): Promise<DeliveryResult> => {
    const { row }: DeliveryClaim = await ctx.runMutation(
      internal.claimAnalytics.claimNextForDelivery,
      {},
    );
    if (row === null) return { delivered: 0, configured: true };

    const config = posthogClaimAnalyticsConfig(process.env);
    if (config === null) {
      await ctx.runMutation(internal.claimAnalytics.disableDelivery, { outboxId: row._id });
      return { delivered: 0, configured: false };
    }

    const payload = posthogClaimEvent(row);
    payload.api_key = config.projectKey;
    try {
      const response = await fetch(config.captureUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      await response.text();
      if (!response.ok) {
        await ctx.runMutation(internal.claimAnalytics.recordDeliveryFailure, {
          outboxId: row._id,
        });
        return { delivered: 0, configured: true };
      }

      await ctx.runMutation(internal.claimAnalytics.recordDeliverySuccess, {
        outboxId: row._id,
      });
      return { delivered: 1, configured: true };
    } catch {
      await ctx.runMutation(internal.claimAnalytics.recordDeliveryFailure, {
        outboxId: row._id,
      });
      return { delivered: 0, configured: true };
    }
  },
});
