import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { userOwnsProfile } from "./_profileOwnership";
import {
  consumeProfileAssetUploads,
  PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
  hasProfileAssetCapacity,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl,
  sanitizeProfileAssetLabel,
} from "./_profileAssets";
import {
  reviewDecisionSchema,
  reviewRebaseSchema,
  type ReviewRebase,
  type ReviewDecision,
  type CommandReceipt,
} from "../packages/api-contracts/src/media-review";
import {
  identityEmailVerified,
  isCurrentEmailVerificationAttestation,
} from "./_identity";
import { automaticProfileImage } from "./_profileImageFallback";

export type ReviewActor = {
  user: Doc<"users">;
  subject: AuthSubject;
  emailVerified?: boolean;
};
export async function trustedReviewActor(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  attestation?: {
    emailVerified?: boolean;
    emailVerificationAttestedAt?: number;
  },
): Promise<ReviewActor> {
  const user = await ctx.db.get(userId);
  if (user === null) throw new Error("Review actor unavailable.");
  return {
    user,
    emailVerified:
      attestation?.emailVerified === true &&
      isCurrentEmailVerificationAttestation(
        attestation.emailVerificationAttestedAt,
      ),
    subject: {
      tokenIdentifier: `api:${userId}`,
      issuer: "vrdex:api",
      subject: String(userId),
    },
  };
}
export async function browserReviewActor(
  ctx: QueryCtx | MutationCtx,
): Promise<ReviewActor> {
  return {
    ...(await requireActiveBrowserSessionSubject(ctx)),
    emailVerified: await identityEmailVerified(ctx),
  };
}
export function assertReviewActorVerified(actor: ReviewActor) {
  if (!actor.user.email || actor.emailVerified !== true)
    throw new Error("A verified email address is required for media review.");
}
export const reviewActorAttestationArgs = {
  emailVerified: v.optional(v.boolean()),
  emailVerificationAttestedAt: v.optional(v.number()),
};
function assertContributionsEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true")
    throw new Error("Profile media contributions are not enabled.");
}
function sanitizeNote(value: string | undefined, maxLength: number) {
  return value?.trim().replace(/\s+/g, " ").slice(0, maxLength) || undefined;
}
const submissionId = v.id("profileMediaSubmissions");
const requestedPlacement = v.union(
  v.literal("profile_image"),
  v.literal("primary_logo"),
);
export async function reviewerContext(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles">,
  actor?: ReviewActor,
  submission?: Doc<"profileMediaSubmissions">,
) {
  const currentActor = actor ?? (await browserReviewActor(ctx));
  assertReviewActorVerified(currentActor);
  const { user, subject } = currentActor;
  const access = await getAccountFeatureAccess(ctx.db, user._id);
  const ownsProfile = await userOwnsProfile(ctx.db, profile._id, user._id);
  const assigned =
    submission !== undefined &&
    access.canReviewMedia &&
    profile.claimState === "unclaimed" &&
    profile.publicationState === "published" &&
    profile.publicSurfacingState === "public" &&
    (await hasSubmissionAssignment(ctx, submission, user._id));
  if (!access.superAdmin && !ownsProfile && !assigned) {
    throw new ConvexError({
      code: "MEDIA_REVIEW_ACCESS_REQUIRED",
      message: "Profile media review access is required.",
    });
  }
  if (!access.superAdmin && !assigned && profile.claimState === "unclaimed") {
    throw new Error(
      "Only a moderator can review media for an unclaimed profile.",
    );
  }
  return { user, subject, access, ownsProfile };
}

export const legacyDecisionArgs = {
  submissionId,
  decision: v.union(v.literal("approve"), v.literal("reject")),
  expectedProfileUpdatedAt: v.number(),
  finalPlacement: v.optional(requestedPlacement),
  label: v.optional(v.string()),
  altText: v.optional(v.string()),
  credit: v.optional(v.string()),
  creditUrl: v.optional(v.string()),
  publicDisposition: v.optional(v.string()),
  privateReason: v.string(),
};
type LegacyDecision = {
  submissionId: Id<"profileMediaSubmissions">;
  decision: "approve" | "reject";
  expectedProfileUpdatedAt: number;
  finalPlacement?: "profile_image" | "primary_logo";
  label?: string;
  altText?: string;
  credit?: string;
  creditUrl?: string;
  publicDisposition?: string;
  privateReason: string;
};
export async function applyReviewDecision(
  ctx: MutationCtx,
  args: LegacyDecision,
  actor?: ReviewActor,
) {
  assertContributionsEnabled();
  const submission = await ctx.db.get(args.submissionId);
  if (
    submission === null ||
    (submission.status !== "submitted" && submission.status !== "under_review")
  ) {
    throw new Error("This media contribution is not awaiting a decision.");
  }
  const now = Date.now();
  if (submission.expiresAt <= now) {
    throw new Error("This media contribution has expired.");
  }
  const profile = await ctx.db.get(submission.profileId);
  if (
    profile === null ||
    profile.publicationState !== "published" ||
    profile.publicSurfacingState !== "public"
  ) {
    throw new Error("The target profile is no longer public.");
  }
  const { subject, user, ownsProfile } = await reviewerContext(
    ctx,
    profile,
    actor,
    submission,
  );
  if (submission.submitterUserId === user._id) {
    throw new Error("You cannot decide your own media contribution.");
  }
  if (
    profile.updatedAt !== args.expectedProfileUpdatedAt ||
    (args.decision === "approve" &&
      profile.updatedAt !== submission.targetProfileUpdatedAt)
  ) {
    throw new Error("The target profile changed. Refresh before deciding.");
  }
  const privateReason = sanitizeNote(args.privateReason, 1_000);
  if (privateReason === undefined)
    throw new Error("A private review reason is required.");
  const publicDisposition = sanitizeNote(args.publicDisposition, 240);
  if (args.decision === "reject") {
    if (publicDisposition === undefined) {
      throw new Error("A contributor-visible rejection reason is required.");
    }
    await ctx.db.patch(submission._id, {
      status: "rejected",
      reviewer: subject,
      reviewedAt: now,
      publicDisposition,
      privateReason,
      decisionProfileUpdatedAt: profile.updatedAt,
      blobDeleteAfter: now + PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
      updatedAt: now,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_media_submission_rejected",
      actor: subject,
      sourceType: "moderator",
      createdAt: now,
    });
    return { status: "rejected" as const };
  }

  if (submission.uploadIntentId === undefined) {
    throw new Error("The submitted media upload is missing.");
  }
  const intent = await ctx.db.get(submission.uploadIntentId);
  if (
    intent === null ||
    intent.state !== "uploaded" ||
    intent.purpose !== "community_proposal" ||
    intent.targetSubmissionId !== submission._id ||
    intent.targetProfileId !== profile._id
  ) {
    throw new Error("The submitted media upload is not ready for approval.");
  }
  const currentPlacement = await ctx.db
    .query("profileAssetPlacements")
    .withIndex("by_profileId_placement_state_position", (query) =>
      query
        .eq("profileId", profile._id)
        .eq("placement", submission.requestedPlacement)
        .eq("state", "active"),
    )
    .first();
  if (
    (currentPlacement?.assetId ?? undefined) !==
    submission.targetPlacementAssetId
  ) {
    throw new Error(
      "The profile media placement changed. Refresh before deciding.",
    );
  }
  if (intent.contentSha256 !== undefined) {
    const existing = await ctx.db
      .query("profileAssets")
      .withIndex("by_profileId_contentSha256_state", (q) =>
        q
          .eq("profileId", profile._id)
          .eq("contentSha256", intent.contentSha256)
          .eq("state", "active"),
      )
      .first();
    if (existing !== null)
      throw new Error("This image is already published on the profile.");
  }

  const finalPlacement = args.finalPlacement ?? submission.requestedPlacement;
  if (
    (profile.profileType === "person" && finalPlacement !== "profile_image") ||
    (profile.profileType === "community" && finalPlacement !== "primary_logo")
  ) {
    throw new Error(
      "That media placement is not available for this profile type.",
    );
  }
  const finalLabel =
    "label" in args ? sanitizeProfileAssetLabel(args.label) : submission.label;
  const finalAltText =
    "altText" in args
      ? sanitizeProfileAssetAltText(args.altText)
      : submission.altText;
  const finalCredit =
    "credit" in args
      ? sanitizeProfileAssetCredit(args.credit)
      : submission.credit;
  const finalCreditUrl =
    "creditUrl" in args
      ? sanitizeProfileAssetCreditUrl(args.creditUrl)
      : submission.creditUrl;
  if (finalCredit === undefined) {
    throw new Error("Asset credit is required before approval.");
  }
  const assetIds = await consumeProfileAssetUploads(ctx.db, {
    profileId: profile._id,
    requestedBy: intent.requestedBy,
    approvedSubmissionId: submission._id,
    uploads: [
      {
        intentId: intent._id,
        uploadToken: intent.uploadToken,
        label: finalLabel,
        altText: finalAltText,
        credit: finalCredit,
        creditUrl: finalCreditUrl,
        placements: [finalPlacement],
      },
    ],
    source: "community_submitted",
    now,
  });
  const approvedAssetId = assetIds[0];
  if (approvedAssetId === undefined)
    throw new Error("Media approval did not create an asset.");
  await ctx.db.patch(submission._id, {
    status: "approved",
    reviewer: subject,
    reviewedAt: now,
    ...(publicDisposition !== undefined ? { publicDisposition } : {}),
    privateReason,
    decisionProfileUpdatedAt: profile.updatedAt,
    approvedAssetId,
    updatedAt: now,
  });
  await ctx.db.insert("profileAuditEvents", {
    profileId: profile._id,
    action: "profile_media_submission_approved",
    actor: subject,
    sourceType: ownsProfile ? "owner" : "moderator",
    createdAt: now,
  });
  return { status: "approved" as const, assetId: approvedAssetId };
}

async function hash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function reviewSnapshot(
  ctx: Pick<QueryCtx, "db">,
  submission: Doc<"profileMediaSubmissions">,
  profile: Doc<"profiles">,
) {
  const placement = await ctx.db
    .query("profileAssetPlacements")
    .withIndex("by_profileId_placement_state_position", (q) =>
      q
        .eq("profileId", profile._id)
        .eq("placement", submission.requestedPlacement)
        .eq("state", "active"),
    )
    .first();
  const currentAsset =
    placement === null ? null : await ctx.db.get(placement.assetId);
  const authoredPlacements = await ctx.db
    .query("profileAssetPlacements")
    .withIndex("by_profileId_state", (q) =>
      q.eq("profileId", profile._id).eq("state", "active"),
    )
    .collect();
  const hasAuthoredProfileImage = authoredPlacements.some(
    (row) =>
      row.placement === "profile_image" || row.placement === "primary_logo",
  );
  const currentAutomaticImageUrl =
    (await automaticProfileImage(
      ctx.db,
      profile,
      "profile_page",
      hasAuthoredProfileImage,
    )) ?? null;
  const intent =
    submission.uploadIntentId === undefined
      ? null
      : await ctx.db.get(submission.uploadIntentId);
  const candidateReady =
    intent !== null &&
    intent.purpose === "community_proposal" &&
    intent.targetSubmissionId === submission._id &&
    intent.targetProfileId === profile._id &&
    (intent.state === "uploaded" || intent.state === "consumed") &&
    submission.blobDeletedAt === undefined &&
    submission.blobCleanupToken === undefined &&
    intent.contentSha256 === submission.contentSha256;
  // The hash binds the stored rendition and provenance, current target and placement,
  // and explicit rebase revision. Advisory startReview is deliberately excluded.
  const reviewVersion = await hash({
    candidate: {
      id: submission._id,
      submitterUserId: submission.submitterUserId,
      contributorNote: submission.contributorNote,
      originalFileName: submission.originalFileName,
      uploadIntentId: submission.uploadIntentId,
      hash: submission.contentSha256,
      sourceUrl: submission.sourceUrl,
      sourceKind: submission.sourceKind,
      sourceDescription: submission.sourceDescription,
      credit: submission.credit,
      creditUrl: submission.creditUrl,
      label: submission.label,
      altText: submission.altText,
      expiresAt: submission.expiresAt,
      targetProfileUpdatedAt: submission.targetProfileUpdatedAt,
      targetPlacementAssetId: submission.targetPlacementAssetId,
      requestedPlacement: submission.requestedPlacement,
    },
    intent,
    profile,
    placement,
    currentAsset,
    currentAutomaticImageUrl,
    revision: submission.reviewRevision ?? 0,
  });
  return {
    reviewVersion,
    currentPlacement:
      placement === null
        ? null
        : {
            assetId: placement.assetId,
            placementId: placement._id,
            credit: currentAsset?.credit ?? null,
            sourceUrl: currentAsset?.sourceUrl ?? null,
          },
    currentAvatarImageUrl: profile.avatarImageUrl ?? null,
    currentAutomaticImageUrl,
    candidate: {
      rendition: candidateReady
        ? { submissionId: submission._id, kind: "stored_candidate" as const }
        : null,
      sourceUrl: submission.sourceUrl,
      sourceKind: submission.sourceKind,
      sourceDescription: submission.sourceDescription,
      credit: submission.credit,
      contentSha256: submission.contentSha256 ?? null,
    },
  };
}
export async function decideReviewCommand(
  ctx: MutationCtx,
  input: ReviewDecision,
  actor: ReviewActor,
): Promise<CommandReceipt> {
  const args = reviewDecisionSchema.parse(input);
  const id = ctx.db.normalizeId("profileMediaSubmissions", args.submissionId);
  const submission = id === null ? null : await ctx.db.get(id);
  const profile =
    submission === null ? null : await ctx.db.get(submission.profileId);
  if (submission === null || profile === null)
    throw new Error("Media contribution unavailable.");
  // Revalidate authority before receipt lookup: losing ownership or the reviewer
  // grant also loses access to historical operation results.
  await reviewerContext(ctx, profile, actor, submission);
  const inputHash = await hash(args);
  const previous = await ctx.db
    .query("mediaReviewReceipts")
    .withIndex("by_actorUserId_idempotencyKey", (q) =>
      q
        .eq("actorUserId", actor.user._id)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (previous !== null)
    return previous.inputHash === inputHash
      ? previous.receipt
      : {
          operationId: previous.receipt.operationId,
          operationState: "refused",
          code: "idempotency_conflict",
        };
  const snapshot = await reviewSnapshot(ctx, submission, profile);
  let code: string | undefined;
  if (process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true")
    code = "review_disabled";
  else if (submission.submitterUserId === actor.user._id) code = "self_review";
  else if (
    submission.status !== "submitted" &&
    submission.status !== "under_review"
  )
    code = "already_decided";
  else if (submission.expiresAt <= Date.now()) code = "expired";
  else if (
    profile.publicationState !== "published" ||
    profile.publicSurfacingState !== "public"
  )
    code = "target_unavailable";
  else if (snapshot.reviewVersion !== args.expectedReviewVersion)
    code = "review_changed";
  else if (
    args.decision === "approve" &&
    profile.updatedAt !== submission.targetProfileUpdatedAt
  )
    code = "target_changed";
  else if (
    args.decision === "approve" &&
    (snapshot.currentPlacement?.assetId ?? undefined) !==
      submission.targetPlacementAssetId
  )
    code = "placement_changed";
  else if (args.decision === "reject" && args.publicReason === undefined)
    code = "public_reason_required";
  else if (args.decision === "approve" && snapshot.candidate.rendition === null)
    code = "candidate_unavailable";
  if (code === undefined && args.decision === "approve") {
    if (
      (profile.profileType === "person" &&
        submission.requestedPlacement !== "profile_image") ||
      (profile.profileType === "community" &&
        submission.requestedPlacement !== "primary_logo")
    )
      code = "placement_unavailable";
    else if (!submission.credit.trim()) code = "credit_required";
    else if (submission.contentSha256 !== undefined) {
      const duplicate = await ctx.db
        .query("profileAssets")
        .withIndex("by_profileId_contentSha256_state", (q) =>
          q
            .eq("profileId", profile._id)
            .eq("contentSha256", submission.contentSha256)
            .eq("state", "active"),
        )
        .first();
      if (duplicate !== null) code = "already_published";
    }
  }
  if (code === undefined && args.decision === "approve") {
    let retiringPublicAsset = 0;
    if (snapshot.currentPlacement !== null) {
      const asset = await ctx.db.get(snapshot.currentPlacement.assetId);
      if (
        asset !== null &&
        asset.profileId === profile._id &&
        asset.state === "active" &&
        asset.visibility === "public" &&
        asset.retiredAt === undefined
      ) {
        const [before, after] = await Promise.all([
          ctx.db
            .query("profileAssetPlacements")
            .withIndex("by_assetId_state_placement", (q) =>
              q
                .eq("assetId", asset._id)
                .eq("state", "active")
                .lt("placement", submission.requestedPlacement),
            )
            .first(),
          ctx.db
            .query("profileAssetPlacements")
            .withIndex("by_assetId_state_placement", (q) =>
              q
                .eq("assetId", asset._id)
                .eq("state", "active")
                .gt("placement", submission.requestedPlacement),
            )
            .first(),
        ]);
        if (before === null && after === null) retiringPublicAsset = 1;
      }
    }
    if (
      !(await hasProfileAssetCapacity(
        ctx.db,
        profile._id,
        1 - retiringPublicAsset,
      ))
    )
      code = "capacity_exceeded";
  }
  const receipt: CommandReceipt = {
    operationId: crypto.randomUUID(),
    operationState: code === undefined ? "committed" : "refused",
    resourceId: submission._id,
    ...(code === undefined ? {} : { code }),
  };
  if (code === undefined) {
    await applyReviewDecision(
      ctx,
      {
        submissionId: submission._id,
        expectedProfileUpdatedAt: profile.updatedAt,
        decision: args.decision,
        privateReason: args.privateReason,
        ...(args.publicReason === undefined
          ? {}
          : { publicDisposition: args.publicReason }),
      },
      actor,
    );
    await ctx.db.patch(submission._id, {
      reviewRevision: (submission.reviewRevision ?? 0) + 1,
    });
  }
  await ctx.db.insert("mediaReviewReceipts", {
    actorUserId: actor.user._id,
    idempotencyKey: args.idempotencyKey,
    inputHash,
    submissionId: submission._id,
    receipt,
    createdAt: Date.now(),
  });
  return receipt;
}

export async function activeBatchAssignment(
  ctx: Pick<QueryCtx, "db">,
  batchId: Id<"contributionBatches">,
  userId: Id<"users">,
) {
  if (process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED !== "true") return false;
  const access = await getAccountFeatureAccess(ctx.db, userId);
  if (!access.canReviewMedia) return false;
  const assignment = await ctx.db
    .query("contributionBatchReviewers")
    .withIndex("by_batch_reviewer", (q) =>
      q.eq("batchId", batchId).eq("reviewerUserId", userId),
    )
    .unique();
  return assignment?.active === true && assignment.expiresAt > Date.now();
}
export async function hasSubmissionAssignment(
  ctx: Pick<QueryCtx, "db">,
  submission: Doc<"profileMediaSubmissions">,
  userId: Id<"users">,
) {
  const attempt = await ctx.db
    .query("contributionItemAttempts")
    .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id))
    .unique();
  const revision = attempt ? await ctx.db.get(attempt.revisionId) : null;
  return (
    revision !== null &&
    revision.actorUserId === submission.submitterUserId &&
    (await activeBatchAssignment(ctx, revision.batchId, userId))
  );
}
export async function rebaseReviewCommand(
  ctx: MutationCtx,
  input: ReviewRebase,
  actor: ReviewActor,
): Promise<CommandReceipt> {
  const args = reviewRebaseSchema.parse(input);
  const id = ctx.db.normalizeId("profileMediaSubmissions", args.submissionId);
  const submission = id ? await ctx.db.get(id) : null;
  const profile = submission ? await ctx.db.get(submission.profileId) : null;
  if (!submission || !profile)
    throw new Error("Media contribution unavailable.");
  await reviewerContext(ctx, profile, actor, submission);
  const inputHash = await hash({ command: "rebase", ...args });
  const previous = await ctx.db
    .query("mediaReviewReceipts")
    .withIndex("by_actorUserId_idempotencyKey", (q) =>
      q
        .eq("actorUserId", actor.user._id)
        .eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (previous)
    return previous.inputHash === inputHash
      ? previous.receipt
      : {
          operationId: previous.receipt.operationId,
          operationState: "refused",
          code: "idempotency_conflict",
        };
  const snapshot = await reviewSnapshot(ctx, submission, profile);
  const code =
    process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true"
      ? "review_disabled"
      : submission.submitterUserId === actor.user._id
        ? "self_review"
        : !["submitted", "under_review"].includes(submission.status)
          ? "already_decided"
          : submission.expiresAt <= Date.now()
            ? "expired"
            : profile.publicationState !== "published" ||
                profile.publicSurfacingState !== "public"
              ? "target_unavailable"
              : snapshot.reviewVersion !== args.expectedReviewVersion
                ? "review_changed"
                : undefined;
  const receipt: CommandReceipt = {
    operationId: crypto.randomUUID(),
    resourceId: submission._id,
    operationState: code ? "refused" : "committed",
    ...(code ? { code } : {}),
  };
  if (!code) {
    await ctx.db.insert("mediaReviewRebases", {
      submissionId: submission._id,
      actorUserId: actor.user._id,
      priorTargetUpdatedAt: submission.targetProfileUpdatedAt,
      currentTargetUpdatedAt: profile.updatedAt,
      priorPlacementAssetId: submission.targetPlacementAssetId,
      currentPlacementAssetId: snapshot.currentPlacement?.assetId,
      priorTargetSnapshot: JSON.stringify({
        profileId: submission.profileId,
        slug: submission.targetProfileSlug,
        displayName: submission.targetProfileDisplayName,
        updatedAt: submission.targetProfileUpdatedAt,
      }),
      currentTargetSnapshot: JSON.stringify({
        profileId: profile._id,
        slug: profile.slug,
        displayName: profile.displayName,
        claimState: profile.claimState,
        publicationState: profile.publicationState,
        publicSurfacingState: profile.publicSurfacingState,
        updatedAt: profile.updatedAt,
      }),
      currentPlacementSnapshot: JSON.stringify({
        placement: snapshot.currentPlacement,
        avatarImageUrl: snapshot.currentAvatarImageUrl,
        automaticImageUrl: snapshot.currentAutomaticImageUrl,
      }),
      priorReviewVersion: snapshot.reviewVersion,
      reviewRevision: (submission.reviewRevision ?? 0) + 1,
      createdAt: Date.now(),
    });
    await ctx.db.patch(submission._id, {
      targetProfileSlug: profile.slug,
      targetProfileDisplayName: profile.displayName,
      targetProfileUpdatedAt: profile.updatedAt,
      targetPlacementAssetId: snapshot.currentPlacement?.assetId,
      reviewRevision: (submission.reviewRevision ?? 0) + 1,
      updatedAt: Date.now(),
    });
  }
  await ctx.db.insert("mediaReviewReceipts", {
    actorUserId: actor.user._id,
    idempotencyKey: args.idempotencyKey,
    inputHash,
    submissionId: submission._id,
    receipt,
    createdAt: Date.now(),
  });
  return receipt;
}
