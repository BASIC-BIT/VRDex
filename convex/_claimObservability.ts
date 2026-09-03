import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

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

// Retained while the legacy lifecycle table ages out in production.
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
