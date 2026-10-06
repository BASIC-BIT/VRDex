import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

async function eligible(ctx: MutationCtx, submission: Doc<"profileMediaSubmissions">) {
  const profile = await ctx.db.get(submission.profileId);
  const asset = submission.approvedAssetId ? await ctx.db.get(submission.approvedAssetId) : null;
  if (!profile || !asset || submission.status !== "approved" || submission.requestKind === "identity_placement" ||
    profile.claimState !== "unclaimed" || profile.publicationState !== "published" || profile.publicSurfacingState !== "public" ||
    asset.profileId !== profile._id || asset.state !== "active" || asset.visibility !== "public" ||
    asset.source !== "community_submitted" || asset.retiredAt !== undefined || asset.moderatorSuppressedAt !== undefined ||
    submission.legalHoldAt !== undefined || asset.contentSha256 !== submission.contentSha256) return null;
  const matches = await ctx.db.query("profileMediaSubmissions").withIndex("by_approvedAssetId", q => q.eq("approvedAssetId", asset._id)).take(2);
  if (matches.length !== 1 || matches[0]._id !== submission._id ||
    (asset.sourceSubmissionId !== undefined && asset.sourceSubmissionId !== submission._id)) return null;
    const restrictions = await Promise.all([
      ctx.db.query("mediaPublicationRestrictions").withIndex("by_profileId_kind", q => q.eq("profileId", profile._id).eq("kind", "identity")).first(),
      ctx.db.query("mediaPublicationRestrictions").withIndex("by_profileId_kind", q => q.eq("profileId", profile._id).eq("kind", "dispute")).first(),
      asset.contentSha256 ? ctx.db.query("mediaPublicationRestrictions").withIndex("by_contentSha256_kind", q => q.eq("contentSha256", asset.contentSha256).eq("kind", "suppression")).first() : null,
      asset.contentSha256 ? ctx.db.query("mediaPublicationRestrictions").withIndex("by_contentSha256_kind", q => q.eq("contentSha256", asset.contentSha256).eq("kind", "rejection")).first() : null,
    ]);
    if (restrictions.some(Boolean)) return null;

  return { profile, asset };
}
async function gallery(ctx: MutationCtx, asset: Doc<"profileAssets">, dryRun: boolean) {
  const existing = await ctx.db.query("profileAssetPlacements").withIndex("by_assetId_state_placement", q =>
    q.eq("assetId", asset._id).eq("state", "active").eq("placement", "gallery")).first();
  if (existing) return false;
  if (!dryRun) await ctx.db.insert("profileAssetPlacements", { profileId: asset.profileId, assetId: asset._id,
    placement: "gallery", position: asset.uploadedAt, state: "active", updatedAt: Date.now() });
  return true;
}
export const convertBatch = internalMutation({
  args: { dryRun: v.boolean(), cursor: v.union(v.string(), v.null()), limit: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 40) throw new ConvexError("Migration limit must be 1..40.");
    const page = await ctx.db.query("profileMediaSubmissions").paginate({ cursor: args.cursor, numItems: args.limit });
    let changed = 0, skipped = 0, conflicts = 0;
    for (const submission of page.page) {
      if (submission.requestKind !== "identity_placement" && submission.uploadIntentId &&
        ["upload_pending", "submitted", "under_review"].includes(submission.status) &&
        (submission.requestKind !== "kit_asset" || submission.requestedPlacement !== "gallery")) {
        const intent = await ctx.db.get(submission.uploadIntentId);
        if (!intent || intent.purpose !== "community_proposal" || intent.targetSubmissionId !== submission._id ||
          intent.targetProfileId !== submission.profileId || !["pending", "uploaded"].includes(intent.state)) { conflicts++; continue; }
        if (!args.dryRun) {
          await ctx.db.patch(submission._id, { requestKind: "kit_asset", requestedPlacement: "gallery", reviewRevision: (submission.reviewRevision ?? 0) + 1 });
          await ctx.db.patch(intent._id, { placements: ["gallery"] });
        }
        changed++; continue;
      }
      if (submission.status !== "approved" || !submission.approvedAssetId || submission.requestKind === "identity_placement") { skipped++; continue; }
      const s = await eligible(ctx, submission);
      if (!s) { conflicts++; continue; }
      const legacy = submission.requestKind === undefined;
      const patch: { sourceSubmissionId?: typeof submission._id; sourceDescription?: string } = {};
      if (s.asset.sourceSubmissionId === undefined) patch.sourceSubmissionId = submission._id;
      // ponytail: any profile metadata correction blocks initialization; asset-scoped audit index if needed.
      const audits = await Promise.all(["profile_media_contribution_metadata_updated", "profile_asset_metadata_updated"].map(action =>
        ctx.db.query("profileAuditEvents").withIndex("by_profileId_action", q => q.eq("profileId", s.profile._id).eq("action", action)).first()));
      const approvalTime = submission.reviewedAt ?? (submission.publicationMethod === "trusted_publisher" ? submission.updatedAt : undefined);
      if (legacy && approvalTime !== undefined && s.asset.updatedAt === approvalTime && !s.asset.sourceUrl && !s.asset.sourceDescription && submission.sourceDescription && !audits.some(Boolean))
        patch.sourceDescription = submission.sourceDescription;
      const retained = await gallery(ctx, s.asset, args.dryRun);
      if (Object.keys(patch).length && !args.dryRun) await ctx.db.patch(s.asset._id, patch);
      if (retained || Object.keys(patch).length) changed++; else skipped++;
    }
    return { scanned: page.page.length, changed, skipped, conflicts, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
export const correctPrimaryToKit = internalMutation({
  args: { dryRun: v.boolean(), submissionId: v.id("profileMediaSubmissions"), expectedAssetId: v.id("profileAssets"),
    expectedPlacementId: v.id("profileAssetPlacements"), expectedPlacementUpdatedAt: v.number(), expectedSelectionOperationId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    const s = submission ? await eligible(ctx, submission) : null;
    const placement = await ctx.db.get(args.expectedPlacementId);
    if (!s || !placement || s.asset._id !== args.expectedAssetId || placement.assetId !== s.asset._id ||
      placement.profileId !== s.profile._id || placement.state !== "active" ||
      placement.placement !== (s.profile.profileType === "person" ? "profile_image" : "primary_logo") ||
      placement.updatedAt !== args.expectedPlacementUpdatedAt || (placement.selectionOperationId ?? null) !== args.expectedSelectionOperationId ||
      placement.selectionOperationId !== undefined || placement.selectionActorUserId !== undefined)
      return { changed: false, code: "resource_changed_or_protected" };
    const primaries = await ctx.db.query("profileAssetPlacements").withIndex("by_profileId_placement_state_position", q =>
      q.eq("profileId", s.profile._id).eq("placement", placement.placement).eq("state", "active")).take(2);
    if (primaries.length !== 1 || primaries[0]._id !== placement._id) return { changed: false, code: "placement_ambiguous" };
    await gallery(ctx, s.asset, args.dryRun);
    if (!args.dryRun) await ctx.db.patch(placement._id, { state: "deleted", updatedAt: Date.now() });
    return { changed: true, code: args.dryRun ? "would_correct" : "corrected" };
  },
});
