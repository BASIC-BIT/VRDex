import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const collectorRuntimeCapabilityValidator = v.union(
  v.literal("telemetry_v1"),
  v.literal("vrchat_proof_v1"),
);

export type CollectorRuntimeCapability = "telemetry_v1" | "vrchat_proof_v1";

export const proofCheckOutcomeValidator = v.union(
  v.literal("not_found"),
  v.literal("found"),
  v.literal("rate_limited"),
  v.literal("auth_required"),
  v.literal("provider_unavailable"),
  v.literal("control_plane_error"),
);

export const proofResolutionReasonValidator = v.union(
  v.literal("verified"),
  v.literal("connection_added"),
  v.literal("claimant_canceled"),
  v.literal("expired"),
  v.literal("already_owned"),
  v.literal("not_claimable"),
  v.literal("verification_failed"),
);

export const profileClaimLifecycleEventValidator = v.union(
  v.literal("attempt_created"),
  v.literal("proof_dispatched"),
  v.literal("provider_checked"),
  v.literal("attempt_resolved"),
);

export const profileClaimLifecycleActorValidator = v.union(
  v.literal("web"),
  v.literal("collector"),
  v.literal("adapter"),
  v.literal("cron"),
);

export type ProofCheckOutcome = Doc<"profileVerificationAttempts">["lastCheckOutcome"];
export type ProofResolutionReason = Doc<"profileVerificationAttempts">["resolutionReason"];

export async function recordProfileClaimLifecycleEvent(
  ctx: MutationCtx,
  input: {
    profileId: Id<"profiles">;
    attemptId: Id<"profileVerificationAttempts">;
    method: Doc<"profileVerificationAttempts">["method"];
    targetType: Doc<"profileVerificationAttempts">["targetType"];
    event: "attempt_created" | "proof_dispatched" | "provider_checked" | "attempt_resolved";
    actorSurface: "web" | "collector" | "adapter" | "cron";
    outcome?: ProofCheckOutcome | ProofResolutionReason;
    workerReleaseSha?: string;
    createdAt: number;
  },
) {
  await ctx.db.insert("profileClaimLifecycleEvents", {
    profileId: input.profileId,
    attemptId: input.attemptId,
    method: input.method,
    targetType: input.targetType,
    event: input.event,
    actorSurface: input.actorSurface,
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.workerReleaseSha === undefined
      ? {}
      : { workerReleaseSha: input.workerReleaseSha.slice(0, 64) }),
    createdAt: input.createdAt,
  });
}
