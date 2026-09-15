import { transferPublishedCharge } from "./_contributionCapacity";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import {
  assertReviewActorVerified,
  reviewSnapshot,
  type ReviewActor,
} from "./_mediaReview";
import {
  consumeProfileAssetUploads,
  hasProfileAssetCapacity,
} from "./_profileAssets";
import {
  mediaPublicationSchema,
  publicationEvidenceSchema,
  type MediaPublication,
  type PublicationEvidence,
  type CommandReceipt,
} from "../packages/api-contracts/src/media-review";

export type PublicationFacts = {
  publisherGrant: boolean;
  independentReviewerGrant: boolean;
  publicUnclaimed: boolean;
  ownSubmission: boolean;
  sourceRecorded: boolean;
  credit: string;
  identityConfirmed: boolean;
  attributionConfirmed: boolean;
  publicationPermitted: boolean;
  noKnownRestrictions: boolean;
  currentPlacement: unknown | null;
  legacyImageUrl: string | null;
  automaticImageUrl: string | null;
  priorSuppression: boolean;
  priorRejection: boolean;
  unresolvedDispute: boolean;
};
export function eligible(f: PublicationFacts): boolean {
  return (
    f.publisherGrant &&
    f.publicUnclaimed &&
    f.ownSubmission &&
    f.sourceRecorded &&
    !!f.credit.trim() &&
    f.identityConfirmed &&
    f.attributionConfirmed &&
    f.publicationPermitted &&
    f.noKnownRestrictions &&
    f.currentPlacement === null &&
    !f.legacyImageUrl &&
    !f.automaticImageUrl &&
    !f.priorSuppression &&
    !f.priorRejection &&
    !f.unresolvedDispute
  );
}

export async function requirePublisher(
  ctx: Pick<QueryCtx, "db">,
  actor: ReviewActor,
  submission: Doc<"profileMediaSubmissions">,
  profile: Doc<"profiles">,
) {
  assertReviewActorVerified(actor);
  const access = await getAccountFeatureAccess(ctx.db, actor.user._id);
  if (
    !access.canPublishMedia ||
    submission.submitterUserId !== actor.user._id ||
    profile.claimState !== "unclaimed" ||
    profile.publicationState !== "published" ||
    profile.publicSurfacingState !== "public"
  )
    throw new Error("Trusted publication access is required.");
  return access;
}

export async function recordPublicationRestriction(
  ctx: MutationCtx,
  submission: Doc<"profileMediaSubmissions">,
  actorUserId: Doc<"users">["_id"],
  kind: "rejection" | "suppression" | "dispute" | "identity",
) {
  return ctx.db.insert("mediaPublicationRestrictions", {
    profileId: submission.profileId,
    contentSha256: submission.contentSha256,
    submissionId: submission._id,
    actorUserId,
    kind,
    correctionOfOperationId: submission.publicationOperationId,
    createdAt: Date.now(),
  });
}

async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
// Candidate-only revision keeps declarations stable across target refreshes, but never across evidence edits.
export function evidenceRevision(submission: Doc<"profileMediaSubmissions">) {
  return digest({
    submissionId: submission._id,
    submitterUserId: submission.submitterUserId,
    originalFileName: submission.originalFileName,
    contributorNote: submission.contributorNote,
    label: submission.label,
    altText: submission.altText,
    hash: submission.contentSha256,
    intent: submission.uploadIntentId,
    sourceUrl: submission.sourceUrl,
    sourceKind: submission.sourceKind,
    sourceDescription: submission.sourceDescription,
    credit: submission.credit,
    creditUrl: submission.creditUrl,
    placement: submission.requestedPlacement,
    profileId: submission.profileId,
  });
}

export async function publicationCommand(
  ctx: MutationCtx,
  input: MediaPublication | PublicationEvidence,
  actor: ReviewActor,
  declaration = false,
): Promise<CommandReceipt> {
  const args = declaration
    ? publicationEvidenceSchema.parse(input)
    : mediaPublicationSchema.parse(input);
  const id = ctx.db.normalizeId("profileMediaSubmissions", args.submissionId);
  const submission = id ? await ctx.db.get(id) : null;
  const profile = submission ? await ctx.db.get(submission.profileId) : null;
  if (!submission || !profile)
    throw new Error("Media contribution unavailable.");
  const access = await requirePublisher(ctx, actor, submission, profile);
  const inputHash = await digest({
    command: declaration ? "declare" : "publish",
    ...args,
  });
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
  const revision = await evidenceRevision(submission);
  let code =
    process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true"
      ? "review_disabled"
      : !["submitted", "under_review"].includes(submission.status)
        ? "already_decided"
        : submission.expiresAt <= Date.now()
          ? "expired"
          : snapshot.reviewVersion !== args.expectedReviewVersion
            ? "review_changed"
            : !snapshot.candidate.rendition || !submission.contentSha256
              ? "candidate_unavailable"
              : undefined;
  if (!declaration && !code) {
    const otherImage = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (q) =>
        q
          .eq("profileId", profile._id)
          .eq(
            "placement",
            submission.requestedPlacement === "profile_image"
              ? "primary_logo"
              : "profile_image",
          )
          .eq("state", "active"),
      )
      .first();
    const evidence = submission.publicationEvidenceId
      ? await ctx.db.get(submission.publicationEvidenceId)
      : null;
    const [
      identityRestriction,
      disputeRestriction,
      contentRestriction,
      priorRejected,
      suppressedAsset,
    ] = await Promise.all([
      ctx.db
        .query("mediaPublicationRestrictions")
        .withIndex("by_profileId_kind", (q) =>
          q.eq("profileId", profile._id).eq("kind", "identity"),
        )
        .first(),
      ctx.db
        .query("mediaPublicationRestrictions")
        .withIndex("by_profileId_kind", (q) =>
          q.eq("profileId", profile._id).eq("kind", "dispute"),
        )
        .first(),
      submission.contentSha256
        ? ctx.db
            .query("mediaPublicationRestrictions")
            .withIndex("by_contentSha256", (q) =>
              q.eq("contentSha256", submission.contentSha256),
            )
            .first()
        : null,
      submission.contentSha256
        ? ctx.db
            .query("profileMediaSubmissions")
            .withIndex("by_contentSha256_status", (q) =>
              q
                .eq("contentSha256", submission.contentSha256)
                .eq("status", "rejected"),
            )
            .first()
        : null,
      submission.contentSha256
        ? ctx.db
            .query("profileAssets")
            .withIndex("by_contentSha256_suppressed", (q) =>
              q
                .eq("contentSha256", submission.contentSha256)
                .gt("moderatorSuppressedAt", 0),
            )
            .first()
        : null,
    ]);
    const restriction =
      identityRestriction ?? disputeRestriction ?? contentRestriction;
    if (restriction)
      await ctx.db.patch(submission._id, {
        priorRestrictionId: restriction._id,
      });
    const confirmed =
      evidence?.actorUserId === actor.user._id &&
      evidence.submissionId === submission._id &&
      evidence.candidateVersion === revision;
    if (
      !eligible({
        publisherGrant: access.canPublishMedia,
        independentReviewerGrant: access.canReviewMedia,
        publicUnclaimed: true,
        ownSubmission: true,
        sourceRecorded:
          !!submission.sourceUrl?.trim() ||
          (submission.sourceKind === "local" &&
            !!submission.sourceDescription?.trim()),
        credit: submission.credit,
        identityConfirmed: confirmed && evidence.identityConfirmed,
        attributionConfirmed: confirmed && evidence.attributionConfirmed,
        publicationPermitted: confirmed && evidence.publicationPermitted,
        noKnownRestrictions: confirmed && evidence.noKnownRestrictions,
        currentPlacement: snapshot.currentPlacement ?? otherImage,
        legacyImageUrl: snapshot.currentAvatarImageUrl,
        automaticImageUrl: snapshot.currentAutomaticImageUrl,
        priorSuppression: !!suppressedAsset,
        priorRejection: !!priorRejected,
        unresolvedDispute: !!restriction,
      })
    )
      code = "independent_review_required";
    else if (profile.updatedAt !== submission.targetProfileUpdatedAt)
      code = "target_changed";
    else if (submission.targetPlacementAssetId !== undefined)
      code = "independent_review_required";
    else if (
      (profile.profileType === "person" &&
        submission.requestedPlacement !== "profile_image") ||
      (profile.profileType === "community" &&
        submission.requestedPlacement !== "primary_logo")
    )
      code = "placement_unavailable";
    else if (!(await hasProfileAssetCapacity(ctx.db, profile._id, 1)))
      code = "capacity_exceeded";
  }
  const receipt: CommandReceipt = {
    operationId: crypto.randomUUID(),
    resourceId: submission._id,
    operationState: code ? "refused" : "committed",
    ...(code ? { code } : {}),
  };
  if (!code && declaration) {
    const values = publicationEvidenceSchema.parse(args);
    const evidenceId = await ctx.db.insert("mediaPublicationEvidence", {
      submissionId: submission._id,
      actorUserId: actor.user._id,
      candidateVersion: revision,
      identityConfirmed: values.identityConfirmed,
      attributionConfirmed: values.attributionConfirmed,
      publicationPermitted: values.publicationPermitted,
      noKnownRestrictions: values.noKnownRestrictions,
      createdAt: Date.now(),
    });
    await ctx.db.patch(submission._id, {
      publicationEvidenceId: evidenceId,
      reviewRevision: (submission.reviewRevision ?? 0) + 1,
    });
  } else if (!code) {
    const intent = submission.uploadIntentId
      ? await ctx.db.get(submission.uploadIntentId)
      : null;
    if (!intent || intent.state !== "uploaded")
      throw new Error("Candidate unavailable.");
    const [assetId] = await consumeProfileAssetUploads(ctx.db, {
      profileId: profile._id,
      requestedBy: intent.requestedBy,
      approvedSubmissionId: submission._id,
      uploads: [
        {
          intentId: intent._id,
          uploadToken: intent.uploadToken,
          label: submission.label,
          altText: submission.altText,
          credit: submission.credit,
          creditUrl: submission.creditUrl,
          placements: [submission.requestedPlacement],
        },
      ],
      source: "community_submitted",
      now: Date.now(),
    });
    if (!assetId) throw new Error("Publication did not create an asset.");
    await transferPublishedCharge(ctx.db, submission);
    await ctx.db.patch(submission._id, {
      status: "approved",
      approvedAssetId: assetId,
      publicationMethod: "trusted_publisher",
      publicationActorUserId: actor.user._id,
      publicationEvidenceRevision: snapshot.reviewVersion,
      publicationOperationId: receipt.operationId,
      decisionProfileUpdatedAt: profile.updatedAt,
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
