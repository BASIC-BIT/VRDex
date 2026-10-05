import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { assertReviewActorVerified, hash, reviewSnapshot, type ReviewActor } from "./_mediaReview";
import { selectProfileAssetIdentity, PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
  sanitizeProfileAssetLabel, sanitizeProfileAssetAltText, sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl, normalizeProfileAssetSourceUrl } from "./_profileAssets";
import { isProfileFieldVisible } from "./_profileFieldVisibility";
import { effectiveContributionPolicy } from "./_contributionCapacity";
import { assertSubmissionRateLimits, openSubmissionCountForUser, openSubmissionCountForProfile } from "./profileMediaSubmissions";
import {
  contributionCommandBaseSchema, contributionPlacementCommandSchema,
  contributionManageCommandSchema,
  type ContributionCommandBase, type ContributionPlacementCommand,
  type ContributionManageCommand,
  type PublishedContributionDetail, type CommandReceipt,
} from "../packages/api-contracts/src/media-review";

async function contributionState(ctx: QueryCtx | MutationCtx, submissionId: string, actor: ReviewActor, allowDeleted = false) {
  assertReviewActorVerified(actor);
  const id = ctx.db.normalizeId("profileMediaSubmissions", submissionId);
  const submission = id ? await ctx.db.get(id) : null;
  const profile = submission ? await ctx.db.get(submission.profileId) : null;
  const asset = submission?.approvedAssetId ? await ctx.db.get(submission.approvedAssetId) : null;
  if (!submission || !profile || !asset || submission.submitterUserId !== actor.user._id ||
    submission.status !== "approved" || submission.requestKind === "identity_placement" ||
    asset.sourceSubmissionId !== submission._id || asset.profileId !== profile._id ||
    (!allowDeleted && asset.state !== "active") || asset.visibility !== "public" || asset.retiredAt !== undefined || asset.moderatorSuppressedAt !== undefined)
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
  const kitVisible = publicUnclaimed && isProfileFieldVisible(profile, "mediaKit", "profile_page");
  const assetPlacements = await ctx.db.query("profileAssetPlacements").withIndex("by_assetId_state", q =>
    q.eq("assetId", asset._id).eq("state", "active")).take(20);
  const protectedSelection = assetPlacements.length === 20 || assetPlacements.some(row => row.placement !== "gallery" ||
    (row.selectionActorUserId !== undefined && row.selectionActorUserId !== actor.user._id));
  const ownKitOnly = kitVisible && !restrictions.some(Boolean) && asset.state === "active" &&
    !protectedSelection;
  return { submission, profile, asset, placement, snapshot, current, identityPlacements, publisher, publicUnclaimed, restrictions, ownSelection, kitVisible, ownKitOnly, protectedSelection,
    version: await hash({ asset, source: submission, placement: current, assetPlacements, picture: snapshot.currentImage, restrictions, publicUnclaimed, revision: snapshot.reviewVersion }) };
}

export async function publishedContributionDetail(ctx: QueryCtx | MutationCtx, submissionId: string, actor: ReviewActor): Promise<PublishedContributionDetail> {
  const s = await contributionState(ctx, submissionId, actor);
  const metadata = s.kitVisible ? s.asset : s.submission;
  return {
    submissionId: s.submission._id, assetId: s.asset._id, profileId: s.profile._id, profileSlug: s.profile.slug,
    contributionVersion: s.version,
    metadata: { label: metadata.label ?? "Image", altText: metadata.altText, credit: metadata.credit ?? "",
      creditUrl: metadata.creditUrl, sourceUrl: metadata.sourceUrl, sourceDescription: metadata.sourceDescription },
    canSelectPrimary: s.publisher && !s.identityPlacements.length && !s.snapshot.currentImage,
    canClearPrimary: s.publisher && s.ownSelection,
    canEditMetadata: s.ownKitOnly, canRemove: s.ownKitOnly && s.submission.legalHoldAt === undefined,
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
      sourceUrl: s.asset.sourceUrl, sourceKind: s.submission.sourceKind, sourceDescription: s.asset.sourceDescription,
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

export async function contributionManageCommand(ctx: MutationCtx, input: ContributionManageCommand, actor: ReviewActor): Promise<CommandReceipt> {
  const args = contributionManageCommandSchema.parse(input);
  // Logical deletion must still permit exact-input recovery of its durable receipt.
  const s = await contributionState(ctx, args.submissionId, actor, true);
  const inputHash = await hash({ command: "manage_contribution", ...args });
  const previous = await ctx.db.query("mediaReviewReceipts").withIndex("by_actorUserId_idempotencyKey", q =>
    q.eq("actorUserId", actor.user._id).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (previous) {
    if (!s.kitVisible || s.restrictions.some(Boolean) || s.protectedSelection)
      return { operationId: previous.receipt.operationId, operationState: "refused", code: "authority_changed" };
    return previous.inputHash === inputHash ? previous.receipt : { operationId: previous.receipt.operationId, operationState: "refused", code: "idempotency_conflict" };
  }
  let code = process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" || process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true" ? "review_disabled" :
    !s.kitVisible ? "target_unavailable" : s.restrictions.some(Boolean) ? "publication_restricted" :
    !s.ownKitOnly ? "asset_protected" : args.action === "remove" && s.submission.legalHoldAt !== undefined ? "legal_hold" :
    s.version !== args.expectedContributionVersion ? "contribution_changed" : undefined;
  const before = { label: s.asset.label, altText: s.asset.altText, credit: s.asset.credit,
    creditUrl: s.asset.creditUrl, sourceUrl: s.asset.sourceUrl, sourceDescription: s.asset.sourceDescription };
  const after = { ...before };
  if (!code && args.action === "update_metadata") {
    try {
      if (!Object.keys(args.metadata).length) throw new Error("Metadata change required.");
      for (const key of ["label", "altText", "credit", "creditUrl", "sourceUrl", "sourceDescription"] as const) {
        if (!Object.prototype.hasOwnProperty.call(args.metadata, key)) continue;
        const value = args.metadata[key] ?? undefined;
        after[key] = key === "label" ? sanitizeProfileAssetLabel(value) :
          key === "altText" ? sanitizeProfileAssetAltText(value) :
          key === "credit" ? sanitizeProfileAssetCredit(value) :
          key === "creditUrl" ? sanitizeProfileAssetCreditUrl(value) :
          key === "sourceUrl" ? normalizeProfileAssetSourceUrl(value) : value?.trim().replace(/\s+/g, " ") || undefined;
      }
      if (!after.label || !after.credit || (!after.sourceUrl && !after.sourceDescription)) throw new Error("Title, credit and provenance required.");
    } catch { code = "invalid_metadata"; }
  }
  const receipt: CommandReceipt = { operationId: crypto.randomUUID(), operationState: code ? "refused" : "committed",
    resourceId: s.submission._id, ...(code ? { code } : {}) };
  if (!code) {
    const now = Date.now();
    const updatedAt = Math.max(now, s.asset.updatedAt + 1);
    await ctx.db.patch(s.asset._id, args.action === "remove" ? { state: "deleted", deletedAt: now, updatedAt } : { ...after, updatedAt });
    await ctx.db.insert("profileAuditEvents", { profileId: s.profile._id,
      action: args.action === "remove" ? "profile_media_contribution_removed" : "profile_media_contribution_metadata_updated",
      actor: actor.subject, sourceType: "community", note: JSON.stringify({ assetId: s.asset._id, operationId: receipt.operationId,
        before, after: args.action === "remove" ? { state: "deleted" } : after }), createdAt: now });
  }
  await ctx.db.insert("mediaReviewReceipts", { actorUserId: actor.user._id, submissionId: s.submission._id,
    idempotencyKey: args.idempotencyKey, inputHash, receipt, createdAt: Date.now() });
  return receipt;
}
