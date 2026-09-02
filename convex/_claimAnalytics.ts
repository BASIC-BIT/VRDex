import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const claimAnalyticsEntrySource = v.union(
  v.literal("account"),
  v.literal("profile"),
  v.literal("search"),
);

export type ClaimAnalyticsEntrySource = "account" | "profile" | "search";
export type ClaimAnalyticsMethod = "discord" | "vrchat" | "vrclinking";
export type ClaimAnalyticsOutcome =
  | "claimed_unverified"
  | "claimed_verified"
  | "rejected"
  | "canceled"
  | "expired"
  | "conflict"
  | "not_claimable";

export type ClaimAnalyticsContext = {
  journeyId: string;
  entrySource: ClaimAnalyticsEntrySource;
};

export type ClaimAnalyticsMilestone = {
  event: "claim_attempt_created" | "claim_verification_started" | "claim_resolved";
  profileType: "person" | "community";
  method: ClaimAnalyticsMethod;
  outcome?: ClaimAnalyticsOutcome;
  connectionOnly?: boolean;
  timeToFirstCheckBucket?: "under_1m" | "under_2m" | "under_5m" | "over_5m";
  timeToResolutionBucket?: "under_1m" | "under_5m" | "under_15m" | "under_1h" | "over_1h";
  occurredAt: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function claimAnalyticsContext(
  journeyId: string | undefined,
  entrySource: ClaimAnalyticsEntrySource | undefined,
): ClaimAnalyticsContext {
  if (journeyId !== undefined && !UUID_PATTERN.test(journeyId)) {
    throw new Error("analyticsJourneyId must be an opaque UUID.");
  }

  return {
    journeyId: journeyId ?? crypto.randomUUID(),
    entrySource: entrySource ?? "profile",
  };
}

export function claimAnalyticsMethodForRequest(
  method: Doc<"profileClaimRequests">["method"],
): ClaimAnalyticsMethod {
  return method === "vrclinking_attestation"
    ? "vrclinking"
    : method === "vrchat_user_proof" || method === "vrchat_group_proof"
      ? "vrchat"
      : "discord";
}

export function claimAnalyticsMethodForAttempt(
  attempt: Pick<Doc<"profileVerificationAttempts">, "method">,
): ClaimAnalyticsMethod {
  return claimAnalyticsMethodForRequest(attempt.method);
}

export function timeToFirstCheckBucket(milliseconds: number): ClaimAnalyticsMilestone["timeToFirstCheckBucket"] {
  if (milliseconds < 60_000) return "under_1m";
  if (milliseconds < 120_000) return "under_2m";
  if (milliseconds < 300_000) return "under_5m";
  return "over_5m";
}

export function timeToResolutionBucket(milliseconds: number): ClaimAnalyticsMilestone["timeToResolutionBucket"] {
  if (milliseconds < 60_000) return "under_1m";
  if (milliseconds < 300_000) return "under_5m";
  if (milliseconds < 900_000) return "under_15m";
  if (milliseconds < 3_600_000) return "under_1h";
  return "over_1h";
}

/**
 * Commit one sanitized milestone with the claim transition that produced it.
 * Delivery runs later. A missing PostHog deployment key therefore cannot make
 * ownership, cancellation, or proof resolution wait on analytics.
 */
export async function enqueueClaimAnalyticsEvent(
  ctx: MutationCtx,
  analytics: ClaimAnalyticsContext,
  milestone: ClaimAnalyticsMilestone,
): Promise<void> {
  const eventKey = `${analytics.journeyId}:${milestone.event}`;
  const existing = await ctx.db
    .query("claimAnalyticsOutbox")
    .withIndex("by_eventKey", (query) => query.eq("eventKey", eventKey))
    .unique();

  if (existing !== null) {
    return;
  }

  const now = Date.now();
  await ctx.db.insert("claimAnalyticsOutbox", {
    eventKey,
    journeyId: analytics.journeyId,
    event: milestone.event,
    profileType: milestone.profileType,
    method: milestone.method,
    entrySource: analytics.entrySource,
    ...(milestone.outcome === undefined ? {} : { outcome: milestone.outcome }),
    ...(milestone.connectionOnly === undefined
      ? {}
      : { connectionOnly: milestone.connectionOnly }),
    ...(milestone.timeToFirstCheckBucket === undefined
      ? {}
      : { timeToFirstCheckBucket: milestone.timeToFirstCheckBucket }),
    ...(milestone.timeToResolutionBucket === undefined
      ? {}
      : { timeToResolutionBucket: milestone.timeToResolutionBucket }),
    occurredAt: milestone.occurredAt,
    state: "pending",
    attemptCount: 0,
    nextAttemptAt: now,
  });

  await ctx.scheduler.runAfter(0, internal.claimAnalyticsDelivery.deliverPending, {});
}

export function analyticsContextFromAttempt(
  attempt: Pick<Doc<"profileVerificationAttempts">, "analyticsJourneyId" | "analyticsEntrySource">,
): ClaimAnalyticsContext | null {
  return attempt.analyticsJourneyId === undefined
    ? null
    : {
        journeyId: attempt.analyticsJourneyId,
        entrySource: attempt.analyticsEntrySource ?? "profile",
      };
}

export function analyticsContextFromRequest(
  request: Pick<Doc<"profileClaimRequests">, "analyticsJourneyId" | "analyticsEntrySource">,
): ClaimAnalyticsContext | null {
  return request.analyticsJourneyId === undefined
    ? null
    : {
        journeyId: request.analyticsJourneyId,
        entrySource: request.analyticsEntrySource ?? "profile",
      };
}

export async function enqueueAttemptResolution(
  ctx: MutationCtx,
  attempt: Pick<
    Doc<"profileVerificationAttempts">,
    | "analyticsJourneyId"
    | "analyticsEntrySource"
    | "createdAt"
    | "method"
  >,
  profileType: "person" | "community",
  outcome: ClaimAnalyticsOutcome,
  now: number,
  connectionOnly = false,
): Promise<void> {
  const analytics = analyticsContextFromAttempt(attempt);
  if (analytics === null) return;

  await enqueueClaimAnalyticsEvent(ctx, analytics, {
    event: "claim_resolved",
    profileType,
    method: claimAnalyticsMethodForAttempt(attempt),
    outcome,
    connectionOnly,
    timeToResolutionBucket: timeToResolutionBucket(now - attempt.createdAt),
    occurredAt: now,
  });
}

export async function enqueueRequestResolution(
  ctx: MutationCtx,
  request: Pick<
    Doc<"profileClaimRequests">,
    | "analyticsJourneyId"
    | "analyticsEntrySource"
    | "createdAt"
    | "method"
    | "profileType"
  >,
  outcome: ClaimAnalyticsOutcome,
  now: number,
): Promise<void> {
  const analytics = analyticsContextFromRequest(request);
  if (analytics === null) return;

  await enqueueClaimAnalyticsEvent(ctx, analytics, {
    event: "claim_resolved",
    profileType: request.profileType,
    method: claimAnalyticsMethodForRequest(request.method),
    outcome,
    connectionOnly: false,
    timeToResolutionBucket: timeToResolutionBucket(now - request.createdAt),
    occurredAt: now,
  });
}
