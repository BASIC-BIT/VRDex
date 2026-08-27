import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { identityEmailVerified } from "./_identity";
import {
  consumeProfileAssetUploads,
  createProfileAssetUploadIntentRecord,
  normalizeProfileAssetFileName,
  normalizeProfileAssetSourceUrl,
  PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
  PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl,
  sanitizeProfileAssetLabel,
} from "./_profileAssets";
import { userOwnsProfile } from "./_profileOwnership";

const OPEN_SUBMISSION_STATUSES = ["upload_pending", "submitted", "under_review"] as const;
const MAX_OPEN_PER_USER = 3;
const MAX_OPEN_PER_PROFILE = 2;
const MAX_CREATED_PER_USER_PER_DAY = 6;
const MAX_CREATED_PER_PROFILE_PER_DAY = 20;
const CREATE_COOLDOWN_MS = 30 * 1_000;

const submissionId = v.id("profileMediaSubmissions");
const requestedPlacement = v.union(v.literal("profile_image"), v.literal("primary_logo"));
const reviewQueueStatus = v.union(
  v.literal("submitted"),
  v.literal("under_review"),
  v.literal("approved"),
);

function assertContributionsEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true") {
    throw new Error("Profile media contributions are not enabled.");
  }
}

function sanitizeNote(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

async function openSubmissionCountForUser(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  now: number,
) {
  const groups = await Promise.all(
    OPEN_SUBMISSION_STATUSES.map((status) =>
      ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_submitterUserId_status_expiresAt", (query) =>
          query.eq("submitterUserId", userId).eq("status", status).gt("expiresAt", now),
        )
        .take(MAX_OPEN_PER_USER + 1),
    ),
  );
  return groups.reduce((count, group) => count + group.length, 0);
}

async function openSubmissionCountForProfile(
  ctx: Pick<QueryCtx, "db">,
  profileId: Id<"profiles">,
  now: number,
) {
  const groups = await Promise.all(
    OPEN_SUBMISSION_STATUSES.map((status) =>
      ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_profileId_status_expiresAt", (query) =>
          query.eq("profileId", profileId).eq("status", status).gt("expiresAt", now),
        )
        .take(MAX_OPEN_PER_PROFILE + 1),
    ),
  );
  return groups.reduce((count, group) => count + group.length, 0);
}

async function assertSubmissionRateLimits(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  profileId: Id<"profiles">,
  now: number,
) {
  const since = now - 24 * 60 * 60 * 1_000;
  const [recentForUser, recentForProfile] = await Promise.all([
    ctx.db
      .query("profileMediaSubmissions")
      .withIndex("by_submitterUserId_createdAt", (query) =>
        query.eq("submitterUserId", userId).gt("createdAt", since),
      )
      .order("desc")
      .take(MAX_CREATED_PER_USER_PER_DAY + 1),
    ctx.db
      .query("profileMediaSubmissions")
      .withIndex("by_profileId_createdAt", (query) =>
        query.eq("profileId", profileId).gt("createdAt", since),
      )
      .order("desc")
      .take(MAX_CREATED_PER_PROFILE_PER_DAY + 1),
  ]);
  if (recentForUser.length >= MAX_CREATED_PER_USER_PER_DAY) {
    throw new Error("Media contribution could not be submitted.");
  }
  if (recentForProfile.length >= MAX_CREATED_PER_PROFILE_PER_DAY) {
    throw new Error("Media contribution could not be submitted.");
  }
  if ((recentForUser[0]?.createdAt ?? 0) > now - CREATE_COOLDOWN_MS) {
    throw new Error("Media contribution could not be submitted.");
  }
}

function assertEligibleTarget(
  profile: Doc<"profiles"> | null,
  placement: "profile_image" | "primary_logo",
) {
  if (
    profile === null ||
    profile.publicationState !== "published" ||
    profile.publicSurfacingState !== "public"
  ) {
    throw new Error("This profile is not accepting media contributions.");
  }
  if (profile.claimState !== "unclaimed") {
    throw new Error("This profile has been claimed. Its owner manages its media.");
  }
  if (
    (profile.profileType === "person" && placement !== "profile_image") ||
    (profile.profileType === "community" && placement !== "primary_logo")
  ) {
    throw new Error("That media placement is not available for this profile type.");
  }
  return profile;
}

async function reviewerContext(
  ctx: QueryCtx | MutationCtx,
  profile: Doc<"profiles">,
) {
  const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
  const access = await getAccountFeatureAccess(ctx.db, user._id);
  const ownsProfile = await userOwnsProfile(ctx.db, profile._id, user._id);
  if (!access.superAdmin && !ownsProfile) {
    throw new Error("Profile media review access is required.");
  }
  if (!access.superAdmin && profile.claimState === "unclaimed") {
    throw new Error("Only a moderator can review media for an unclaimed profile.");
  }
  return { user, subject, access, ownsProfile };
}

function publicSubmission(submission: Doc<"profileMediaSubmissions">, profile: Doc<"profiles">) {
  return {
    submissionId: submission._id,
    profileId: profile._id,
    profileSlug: profile.slug,
    profileDisplayName: profile.displayName,
    profileType: profile.profileType,
    requestedPlacement: submission.requestedPlacement,
    status: submission.status,
    sourceUrl: submission.sourceUrl,
    label: submission.label,
    altText: submission.altText,
    credit: submission.credit,
    creditUrl: submission.creditUrl,
    contributorNote: submission.contributorNote,
    publicDisposition: submission.publicDisposition,
    approvedAssetId: submission.approvedAssetId,
    targetProfileUpdatedAt: submission.targetProfileUpdatedAt,
    currentProfileUpdatedAt: profile.updatedAt,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

async function reviewSubmission(
  ctx: Pick<QueryCtx, "db">,
  submission: Doc<"profileMediaSubmissions">,
  profile: Doc<"profiles">,
  includeModeratorEvidence: boolean,
) {
  const duplicates = submission.contentSha256 === undefined
    ? []
    : await ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_profileId_contentSha256_status", (query) =>
          query.eq("profileId", profile._id).eq("contentSha256", submission.contentSha256),
        )
        .take(20);
  const priorProposalCount = duplicates.filter(
    (candidate) => candidate._id !== submission._id,
  ).length;
  const submitter = includeModeratorEvidence
    ? await ctx.db.get(submission.submitterUserId)
    : null;

  return {
    ...publicSubmission(submission, profile),
    priorProposalCount,
    canSuppress: includeModeratorEvidence && submission.status === "approved",
    ...(includeModeratorEvidence
      ? {
          submitterDisplayName: submitter?.name,
          submitterEmail: submitter?.email,
          submitterTokenIdentifier: submission.submitter.tokenIdentifier,
          ...(submission.reviewer === undefined
            ? {}
            : { reviewerTokenIdentifier: submission.reviewer.tokenIdentifier }),
          ...(submission.privateReason === undefined
            ? {}
            : { privateReason: submission.privateReason }),
        }
      : {}),
  };
}

export const createUploadIntent = mutation({
  args: {
    profileId: v.id("profiles"),
    requestedPlacement,
    originalFileName: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    sourceUrl: v.string(),
    label: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.string(),
    creditUrl: v.optional(v.string()),
    contributorNote: v.optional(v.string()),
    expectedProfileUpdatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    assertContributionsEnabled();
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    if (!(await identityEmailVerified(ctx)) || user.email === undefined) {
      throw new Error("Verify email");
    }
    const profile = assertEligibleTarget(await ctx.db.get(args.profileId), args.requestedPlacement);
    if (profile.updatedAt !== args.expectedProfileUpdatedAt) {
      throw new Error("Refresh profile");
    }
    const now = Date.now();
    if (await openSubmissionCountForUser(ctx, user._id, now) >= MAX_OPEN_PER_USER) {
      throw new Error("You already have three media contributions awaiting a decision.");
    }
    if (await openSubmissionCountForProfile(ctx, profile._id, now) >= MAX_OPEN_PER_PROFILE) {
      throw new Error("This profile already has two media contributions awaiting a decision.");
    }

    await assertSubmissionRateLimits(ctx, user._id, profile._id, now);
    const sourceUrl = normalizeProfileAssetSourceUrl(args.sourceUrl);
    const originalFileName = normalizeProfileAssetFileName(args.originalFileName);
    const credit = sanitizeProfileAssetCredit(args.credit);
    if (sourceUrl === undefined || originalFileName === undefined || credit === undefined) {
      throw new Error("A source URL, file name, and credit are required.");
    }
    const label = sanitizeProfileAssetLabel(args.label);
    const altText = sanitizeProfileAssetAltText(args.altText);
    const creditUrl = sanitizeProfileAssetCreditUrl(args.creditUrl);
    const contributorNote = sanitizeNote(args.contributorNote, 500);
    const targetPlacement = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (query) =>
        query
          .eq("profileId", profile._id)
          .eq("placement", args.requestedPlacement)
          .eq("state", "active"),
      )
      .first();
    const submissionId = await ctx.db.insert("profileMediaSubmissions", {
      profileId: profile._id,
      submitterUserId: user._id,
      submitter: subject,
      requestedPlacement: args.requestedPlacement,
      originalFileName,
      sourceUrl,
      ...(label !== undefined ? { label } : {}),
      ...(altText !== undefined ? { altText } : {}),
      credit,
      ...(creditUrl !== undefined ? { creditUrl } : {}),
      ...(contributorNote !== undefined ? { contributorNote } : {}),
      status: "upload_pending",
      targetProfileUpdatedAt: profile.updatedAt,
      ...(targetPlacement === null ? {} : { targetPlacementAssetId: targetPlacement.assetId }),
      expiresAt: now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: subject,
      targetProfileId: profile._id,
      targetSubmissionId: submissionId,
      purpose: "community_proposal",
      originalFileName,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      label,
      altText,
      credit,
      creditUrl,
      placements: [args.requestedPlacement],
      source: "community_submitted",
      now,
    });
    await ctx.db.patch(submissionId, { uploadIntentId: intent.intentId, updatedAt: now });
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_media_submission_created",
      actor: subject,
      sourceType: "community",
      createdAt: now,
    });
    return {
      submissionId,
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      uploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}`,
      ...(process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED === "true"
        ? { directUploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}/direct-upload` }
        : {}),
      uploadTokenHeader: "x-vrdex-upload-token",
      expiresAt: intent.expiresAt,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireActiveBrowserSessionSubject(ctx);
    const groups = await Promise.all(
      [
        "upload_pending",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "withdrawn",
        "superseded",
      ].map((status) =>
        ctx.db
          .query("profileMediaSubmissions")
          .withIndex("by_submitterUserId_status_createdAt", (query) =>
            query.eq("submitterUserId", user._id).eq("status", status as Doc<"profileMediaSubmissions">["status"]),
          )
          .order("desc")
          .take(40),
      ),
    );
    const rows = groups.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
    return await Promise.all(
      rows.map(async (submission) => {
        const profile = await ctx.db.get(submission.profileId);
        return profile === null ? null : publicSubmission(submission, profile);
      }),
    ).then((items) => items.filter((item) => item !== null));
  },
});

export const getReviewAccess = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireActiveBrowserSessionSubject(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    const ownerships = await ctx.db
      .query("profileOwners")
      .withIndex("by_userId_state", (query) =>
        query.eq("userId", user._id).eq("state", "active"),
      )
      .collect();
    const profiles = (
      await Promise.all(ownerships.map((ownership) => ctx.db.get(ownership.profileId)))
    ).filter((profile): profile is Doc<"profiles"> => profile !== null);
    return {
      superAdmin: access.superAdmin,
      profiles: profiles.map((profile) => ({
        profileId: profile._id,
        slug: profile.slug,
        displayName: profile.displayName,
        profileType: profile.profileType,
      })),
    };
  },
});

export const getCandidateForStorage = query({
  args: { submissionId },
  handler: async (ctx, args) => {
    assertContributionsEnabled();
    const submission = await ctx.db.get(args.submissionId);
    if (submission === null || submission.uploadIntentId === undefined) return null;
    const profile = await ctx.db.get(submission.profileId);
    if (profile === null) return null;
    const reviewAccess = await reviewerContext(ctx, profile);
    if (
      !reviewAccess.access.superAdmin &&
      submission.status !== "submitted" &&
      submission.status !== "under_review" &&
      submission.status !== "approved"
    ) {
      return null;
    }
    const intent = await ctx.db.get(submission.uploadIntentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.targetSubmissionId !== submission._id ||
      intent.targetProfileId !== profile._id ||
      (intent.state !== "uploaded" && intent.state !== "consumed")
    ) {
      return null;
    }
    return {
      storageKey: intent.storageKey,
      mimeType: intent.mimeType,
      originalFileName: intent.originalFileName,
      profileDisplayName: profile.displayName,
    };
  },
});

export const listForReview = query({
  args: {
    profileId: v.optional(v.id("profiles")),
    status: v.optional(reviewQueueStatus),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const status = args.status ?? "submitted";
    let submissionsPage;
    let includeModeratorEvidence = false;
    if (args.profileId !== undefined) {
      const profile = await ctx.db.get(args.profileId);
      if (profile === null) {
        return { page: [], isDone: true, continueCursor: "" };
      }
      const reviewAccess = await reviewerContext(ctx, profile);
      includeModeratorEvidence = reviewAccess.access.superAdmin;
      submissionsPage = await ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_profileId_status_createdAt", (query) =>
          query.eq("profileId", profile._id).eq("status", status),
        )
        .order("asc")
        .paginate(args.paginationOpts);
    } else {
      const { user } = await requireActiveBrowserSessionSubject(ctx);
      const access = await getAccountFeatureAccess(ctx.db, user._id);
      if (!access.superAdmin) throw new Error("Super admin access is required.");
      includeModeratorEvidence = true;
      submissionsPage = await ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_status_createdAt", (query) => query.eq("status", status))
        .order("asc")
        .paginate(args.paginationOpts);
    }
    const page = await Promise.all(
      submissionsPage.page.map(async (submission) => {
        const profile = await ctx.db.get(submission.profileId);
        return profile === null
          ? null
          : await reviewSubmission(ctx, submission, profile, includeModeratorEvidence);
      }),
    ).then((items) => items.filter((item) => item !== null));
    return { ...submissionsPage, page };
  },
});

export const withdraw = mutation({
  args: { submissionId },
  handler: async (ctx, args) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (submission === null || submission.submitterUserId !== user._id) return false;
    if (!OPEN_SUBMISSION_STATUSES.includes(submission.status as (typeof OPEN_SUBMISSION_STATUSES)[number])) {
      throw new Error("This media contribution can no longer be withdrawn.");
    }
    const now = Date.now();
    await ctx.db.patch(submission._id, {
      status: "withdrawn",
      blobDeleteAfter: now + PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
      updatedAt: now,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: submission.profileId,
      action: "profile_media_submission_withdrawn",
      actor: subject,
      sourceType: "community",
      createdAt: now,
    });
    return true;
  },
});

export const startReview = mutation({
  args: { submissionId },
  handler: async (ctx, args) => {
    assertContributionsEnabled();
    const submission = await ctx.db.get(args.submissionId);
    if (submission === null || submission.status !== "submitted") {
      throw new Error("This media contribution is not awaiting review.");
    }
    if (submission.expiresAt <= Date.now()) {
      throw new Error("This media contribution has expired.");
    }
    const profile = await ctx.db.get(submission.profileId);
    if (profile === null) throw new Error("The target profile no longer exists.");
    const { subject, user } = await reviewerContext(ctx, profile);
    if (submission.submitterUserId === user._id) {
      throw new Error("You cannot review your own media contribution.");
    }
    const now = Date.now();
    await ctx.db.patch(submission._id, {
      status: "under_review",
      reviewer: subject,
      updatedAt: now,
    });
    return true;
  },
});

export const decide = mutation({
  args: {
    submissionId,
    decision: v.union(v.literal("approve"), v.literal("reject")),
    expectedProfileUpdatedAt: v.number(),
    publicDisposition: v.optional(v.string()),
    privateReason: v.string(),
  },
  handler: async (ctx, args) => {
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
    const { subject, user, ownsProfile } = await reviewerContext(ctx, profile);
    if (submission.submitterUserId === user._id) {
      throw new Error("You cannot decide your own media contribution.");
    }
    if (profile.updatedAt !== args.expectedProfileUpdatedAt) {
      throw new Error("The target profile changed. Refresh before deciding.");
    }
    const privateReason = sanitizeNote(args.privateReason, 1_000);
    if (privateReason === undefined) throw new Error("A private review reason is required.");
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
    if ((currentPlacement?.assetId ?? undefined) !== submission.targetPlacementAssetId) {
      throw new Error("The profile media placement changed. Refresh before deciding.");
    }
    if (intent.contentSha256 !== undefined) {
      const existing = await ctx.db
        .query("profileAssets")
        .withIndex("by_profileId", (query) => query.eq("profileId", profile._id))
        .collect();
      if (existing.some((asset) => asset.state === "active" && asset.contentSha256 === intent.contentSha256)) {
        throw new Error("This image is already published on the profile.");
      }
    }
    const assetIds = await consumeProfileAssetUploads(ctx.db, {
      profileId: profile._id,
      requestedBy: intent.requestedBy,
      approvedSubmissionId: submission._id,
      uploads: [{
        intentId: intent._id,
        uploadToken: intent.uploadToken,
        label: submission.label,
        altText: submission.altText,
        credit: submission.credit,
        creditUrl: submission.creditUrl,
        placements: [submission.requestedPlacement],
      }],
      source: "community_submitted",
      now,
    });
    const approvedAssetId = assetIds[0];
    if (approvedAssetId === undefined) throw new Error("Media approval did not create an asset.");
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
  },
});

export const suppressApprovedAsset = mutation({
  args: {
    submissionId,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    if (!access.superAdmin) throw new Error("Super admin access is required.");
    const reason = sanitizeNote(args.reason, 1_000);
    if (reason === undefined) throw new Error("A suppression reason is required.");
    const submission = await ctx.db.get(args.submissionId);
    if (submission === null || submission.approvedAssetId === undefined) {
      throw new Error("This contribution has no approved asset.");
    }
    const asset = await ctx.db.get(submission.approvedAssetId);
    if (
      asset === null ||
      asset.profileId !== submission.profileId ||
      asset.source !== "community_submitted"
    ) {
      throw new Error("The approved contribution asset no longer matches this submission.");
    }
    if (asset.moderatorSuppressedAt !== undefined) return { suppressed: false };
    const now = Date.now();
    await ctx.db.patch(asset._id, {
      state: "deleted",
      deletedAt: now,
      moderatorSuppressedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: submission.profileId,
      action: "profile_media_submission_asset_suppressed",
      actor: subject,
      sourceType: "moderator",
      note: reason,
      createdAt: now,
    });
    return { suppressed: true };
  },
});

export const prepareDueBlobCleanup = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    if (!access.superAdmin) throw new Error("Super admin access is required.");
    const now = Date.now();

    for (const status of OPEN_SUBMISSION_STATUSES) {
      const oldest = await ctx.db
        .query("profileMediaSubmissions")
        .withIndex("by_status_createdAt", (query) => query.eq("status", status))
        .order("asc")
        .take(50);
      for (const submission of oldest) {
        if (submission.expiresAt > now || submission.blobDeleteAfter !== undefined) continue;
        await ctx.db.patch(submission._id, {
          status: "superseded",
          blobDeleteAfter: submission.expiresAt + PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
          updatedAt: now,
        });
        await ctx.db.insert("profileAuditEvents", {
          profileId: submission.profileId,
          action: "profile_media_submission_expired",
          actor: subject,
          sourceType: "moderator",
          createdAt: now,
        });
      }
    }

    const due = await ctx.db
      .query("profileMediaSubmissions")
      .withIndex("by_cleanupEligibility_blobDeleteAfter", (query) =>
        query
          .eq("blobDeletedAt", undefined)
          .eq("legalHoldAt", undefined)
          .gt("blobDeleteAfter", 0)
          .lte("blobDeleteAfter", now),
      )
      .take(200);
    const eligible = due
      .filter((submission) =>
        submission.blobDeleteAfter !== undefined &&
        submission.blobDeleteAfter <= now &&
        submission.legalHoldAt === undefined &&
        submission.blobDeletedAt === undefined,
      )
      .slice(0, 20);
    return await Promise.all(
      eligible.map(async (submission) => {
        const cleanupToken = submission.blobCleanupToken ?? `${submission._id}:${now}`;
        if (submission.blobCleanupToken === undefined) {
          await ctx.db.patch(submission._id, {
            blobCleanupToken: cleanupToken,
            blobCleanupReservedAt: now,
            updatedAt: now,
          });
        }
        const intent = submission.uploadIntentId === undefined
          ? null
          : await ctx.db.get(submission.uploadIntentId);
        return {
          submissionId: submission._id,
          cleanupToken,
          storageKeys: intent === null
            ? []
            : [
                intent.storageKey,
                intent.sourceStorageKey,
                intent.downloadStorageKey,
                intent.quarantineStorageKey,
              ].filter((key): key is string => key !== undefined),
        };
      }),
    );
  },
});

export const markBlobCleanupComplete = mutation({
  args: {
    items: v.array(v.object({ submissionId, cleanupToken: v.string() })),
  },
  handler: async (ctx, args) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    if (!access.superAdmin) throw new Error("Super admin access is required.");
    if (args.items.length > 20) throw new Error("Cleanup batch is too large.");
    const now = Date.now();
    let completed = 0;
    const items = new Map(args.items.map((item) => [item.submissionId, item.cleanupToken]));
    for (const [id, cleanupToken] of items) {
      const submission = await ctx.db.get(id);
      if (
        submission === null ||
        submission.blobCleanupToken !== cleanupToken ||
        submission.blobDeleteAfter === undefined ||
        submission.blobDeleteAfter > now ||
        submission.legalHoldAt !== undefined ||
        submission.blobDeletedAt !== undefined
      ) {
        continue;
      }
      await ctx.db.patch(id, {
        blobDeletedAt: now,
        blobDeleteAfter: undefined,
        blobCleanupToken: undefined,
        blobCleanupReservedAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("profileAuditEvents", {
        profileId: submission.profileId,
        action: "profile_media_submission_blob_deleted",
        actor: subject,
        sourceType: "moderator",
        createdAt: now,
      });
      completed += 1;
    }
    return { completed };
  },
});

export const setBlobLegalHold = mutation({
  args: {
    submissionId,
    held: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, subject } = await requireActiveBrowserSessionSubject(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    if (!access.superAdmin) throw new Error("Super admin access is required.");
    const reason = sanitizeNote(args.reason, 1_000);
    if (reason === undefined) throw new Error("A legal-hold reason is required.");
    const submission = await ctx.db.get(args.submissionId);
    if (submission === null) throw new Error("Media contribution not found.");
    if (args.held && submission.blobDeletedAt !== undefined) {
      throw new Error("Candidate file has already been deleted.");
    }
    if (args.held && submission.blobCleanupToken !== undefined) {
      throw new Error("Candidate file cleanup is already in progress.");
    }
    const now = Date.now();
    await ctx.db.patch(submission._id, {
      legalHoldAt: args.held ? now : undefined,
      updatedAt: now,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: submission.profileId,
      action: args.held
        ? "profile_media_submission_legal_hold_set"
        : "profile_media_submission_legal_hold_cleared",
      actor: subject,
      sourceType: "moderator",
      note: reason,
      createdAt: now,
    });
    return { held: args.held };
  },
});
