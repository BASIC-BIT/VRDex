import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { assertReviewActorVerified, hash, reviewSnapshot, type ReviewActor } from "./_mediaReview";
import { selectProfileAssetIdentity, PROFILE_MEDIA_SUBMISSION_RETENTION_MS } from "./_profileAssets";
import { effectiveContributionPolicy } from "./_contributionCapacity";
import { assertSubmissionRateLimits, openSubmissionCountForUser, openSubmissionCountForProfile } from "./profileMediaSubmissions";
import {
  contributionCommandBaseSchema, contributionPlacementCommandSchema,
  type ContributionCommandBase, type ContributionPlacementCommand,
  type PublishedContributionDetail, type CommandReceipt,
} from "../packages/api-contracts/src/media-review";

async function contributionState(ctx: QueryCtx | MutationCtx, submissionId: string, actor: ReviewActor) {
  assertReviewActorVerified(actor);
  const id = ctx.db.normalizeId("profileMediaSubmissions", submissionId);
  const submission = id ? await ctx.db.get(id) : null;
  const profile = submission ? await ctx.db.get(submission.profileId) : null;
  const asset = submission?.approvedAssetId ? await ctx.db.get(submission.approvedAssetId) : null;
  if (!submission || !profile || !asset || submission.submitterUserId !== actor.user._id ||
    submission.status !== "approved" || submission.requestKind === "identity_placement" ||
    asset.sourceSubmissionId !== submission._id || asset.profileId !== profile._id ||
    asset.state !== "active" || asset.visibility !== "public" || asset.retiredAt !== undefined || asset.moderatorSuppressedAt !== undefined)
    throw new ConvexError({ code: "MEDIA_RESOURCE_UNAVAILABLE", message: "Published contribution unavailable." });
  const placement = profile.profileType === "person" ? "profile_image" as const : "primary_logo" as const;
  const snapshot = await reviewSnapshot(ctx, { ...submission, requestKind: "identity_placement", candidateAssetId: asset._id, requestedPlacement: placement }, profile);
  const identityPlacements = await ctx.db.query("profileAssetPlacements").withIndex("by_profileId_state", q => q.eq("profileId", profile._id).eq("state", "active"))
    .filter(q => q.or(q.eq(q.field("placement"), "profile_image"), q.eq(q.field("placement"), "primary_logo"))).collect();
  const current = await ctx.db.query("profileAssetPlacements").withIndex("by_profileId_placement_state_position", q =>
    q.eq("profileId", profile._id).eq("placement", placement).eq("state", "active")).first();
  const access = await getAccountFeatureAccess(ctx.db, actor.user._id);
  const restrictions = await Promise.all([
    ctx.db.query("mediaPublicationRestrictions").withIndex("by_profileId_kind", q => q.eq("profileId", profile._id).eq("kind", "identity")).first(),
    ctx.db.query("mediaPublicationRestrictions").withIndex("by_profileId_kind", q => q.eq("profileId", profile._id).eq("kind", "dispute")).first(),
    asset.contentSha256 ? ctx.db.query("mediaPublicationRestrictions").withIndex("by_contentSha256_kind", q => q.eq("contentSha256", asset.contentSha256).eq("kind", "suppression")).first() : null,
    asset.contentSha256 ? ctx.db.query("mediaPublicationRestrictions").withIndex("by_contentSha256_kind", q => q.eq("contentSha256", asset.contentSha256).eq("kind", "rejection")).first() : null,
  ]);
  const publicUnclaimed = profile.claimState === "unclaimed" && profile.publicationState === "published" && profile.publicSurfacingState === "public";
  const publisher = access.canPublishMedia && publicUnclaimed && !restrictions.some(Boolean);
  const ownSelection = !!current && current.assetId === asset._id && current.selectionActorUserId === actor.user._id &&
    current.selectionOperationId?.startsWith("contribution-primary:") === true;
  return { submission, profile, asset, placement, snapshot, current, identityPlacements, publisher, publicUnclaimed, restrictions, ownSelection,
    version: await hash({ asset, source: submission, placement: current, picture: snapshot.currentImage, restrictions, publicUnclaimed, revision: snapshot.reviewVersion }) };
}

export async function publishedContributionDetail(ctx: QueryCtx | MutationCtx, submissionId: string, actor: ReviewActor): Promise<PublishedContributionDetail> {
  const s = await contributionState(ctx, submissionId, actor);
  const ownKitOnly = s.publicUnclaimed && !s.restrictions.some(Boolean) &&
    !s.identityPlacements.some(row => row.assetId === s.asset._id);
  return {
    submissionId: s.submission._id, assetId: s.asset._id, profileId: s.profile._id, profileSlug: s.profile.slug,
    contributionVersion: s.version,
    metadata: { label: s.asset.label ?? "Image", altText: s.asset.altText, credit: s.asset.credit ?? "",
      creditUrl: s.asset.creditUrl, sourceUrl: s.asset.sourceUrl, sourceDescription: s.submission.sourceDescription },
    canSelectPrimary: s.publisher && !s.identityPlacements.length && !s.snapshot.currentImage,
    canClearPrimary: s.publisher && s.ownSelection,
    canEditMetadata: ownKitOnly, canRemove: ownKitOnly && s.submission.legalHoldAt === undefined,
  };
}

async function command(ctx: MutationCtx, input: ContributionCommandBase | ContributionPlacementCommand, actor: ReviewActor, proposal: boolean): Promise<CommandReceipt> {
  const args = proposal ? contributionCommandBaseSchema.parse(input) : contributionPlacementCommandSchema.parse(input);
  const s = await contributionState(ctx, args.submissionId, actor);
  const inputHash = await hash({ command: proposal ? "propose_placement" : "place_contribution", ...args });
  const previous = await ctx.db.query("mediaReviewReceipts").withIndex("by_actorUserId_idempotencyKey", q =>
    q.eq("actorUserId", actor.user._id).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (previous) {
    if (!s.publicUnclaimed || (!proposal && !s.publisher) || s.restrictions.some(Boolean))
      return { operationId: previous.receipt.operationId, operationState: "refused", code: "authority_changed" };
    return previous.inputHash === inputHash ? previous.receipt : { operationId: previous.receipt.operationId, operationState: "refused", code: "idempotency_conflict" };
  }
  const selecting = "action" in args && args.action === "select_primary";
  let code = process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" ? "review_disabled" :
    !s.publicUnclaimed ? "target_unavailable" : s.restrictions.some(Boolean) ? "publication_restricted" :
    !proposal && !s.publisher ? "publisher_required" : s.version !== args.expectedContributionVersion ? "contribution_changed" :
    !proposal && selecting && (s.identityPlacements.length || s.snapshot.currentImage) ? "primary_occupied" :
    !proposal && !selecting && !s.ownSelection ? "selection_changed" : undefined;
  if (!code && proposal) {
    const now = Date.now();
    const policy = await effectiveContributionPolicy(ctx.db, actor.user._id);
    if (await openSubmissionCountForUser(ctx, actor.user._id, now) >= policy.limits.openActor ||
      await openSubmissionCountForProfile(ctx, s.profile._id, now) >= policy.limits.openTarget) code = "proposal_capacity";
    if (!code) {
      try { await assertSubmissionRateLimits(ctx, actor.user._id, s.profile._id, now); }
      catch { code = "proposal_rate_limited"; }
    }
  }
  const receipt: CommandReceipt = { operationId: !proposal && selecting ? `contribution-primary:${crypto.randomUUID()}` : crypto.randomUUID(), operationState: code ? "refused" : "committed", resourceId: s.submission._id, ...(code ? { code } : {}) };
  if (!code) {
    const now = Date.now();
    if (proposal) receipt.resourceId = await ctx.db.insert("profileMediaSubmissions", {
      requestKind: "identity_placement", candidateAssetId: s.asset._id, profileId: s.profile._id,
      targetProfileSlug: s.profile.slug, targetProfileDisplayName: s.profile.displayName,
      submitterUserId: actor.user._id, submitter: actor.subject, requestedPlacement: s.placement,
      targetProfileUpdatedAt: s.profile.updatedAt, targetPlacementAssetId: s.current?.assetId,
      targetPlacementVersion: s.snapshot.placementTargetVersion,
      sourceUrl: s.asset.sourceUrl, sourceKind: s.submission.sourceKind, sourceDescription: s.submission.sourceDescription,
      credit: s.asset.credit ?? s.submission.credit, creditUrl: s.asset.creditUrl,
      label: s.asset.label, altText: s.asset.altText, contentSha256: s.asset.contentSha256,
      status: "submitted", expiresAt: now + PROFILE_MEDIA_SUBMISSION_RETENTION_MS, createdAt: now, updatedAt: now,
    });
    else if (selecting) await selectProfileAssetIdentity(ctx.db, { profileId: s.profile._id, assetId: s.asset._id, placement: s.placement, actorUserId: actor.user._id, operationId: receipt.operationId, now });
    else await ctx.db.patch(s.current!._id, { state: "deleted", updatedAt: now });
    await ctx.db.insert("profileAuditEvents", { profileId: s.profile._id, action: proposal ? "profile_media_placement_proposed" : selecting ? "profile_media_primary_selected" : "profile_media_primary_cleared", actor: actor.subject, sourceType: "community", createdAt: now });
  }
  await ctx.db.insert("mediaReviewReceipts", { actorUserId: actor.user._id, submissionId: s.submission._id, idempotencyKey: args.idempotencyKey, inputHash, receipt, createdAt: Date.now() });
  return receipt;
}
export function contributionPlacementCommand(ctx: MutationCtx, input: ContributionPlacementCommand, actor: ReviewActor) { return command(ctx, input, actor, false); }
export function proposeContributionPlacement(ctx: MutationCtx, input: ContributionCommandBase, actor: ReviewActor) { return command(ctx, input, actor, true); }
