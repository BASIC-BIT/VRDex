import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import type { AuthSubject } from "./_communityAuthority";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { identityEmailVerified } from "./_identity";
import { isProfileFieldVisible } from "./_profileFieldVisibility";
import {
  consumeProfileAssetUploads,
  createProfileAssetUploadIntentRecord,
  normalizeProfileAssetFileName,
  normalizeProfileAssetSourceUrl,
  PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
  PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS,
  PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS,
  PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
  finalizeProfileAssetUploadIntentUpload,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl,
  sanitizeProfileAssetLabel,
} from "./_profileAssets";
import { userOwnsProfile } from "./_profileOwnership";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { recordApiWriteAuditEvent } from "./_apiWriteAuditEvents";
import { requireMcpAttributionText, requireSha256Hex } from "./_mcpWriteReceipts";

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
  v.literal("rejected"),
);

const MCP_EMAIL_ATTESTATION_SKEW_MS = 30_000;

function assertContributionsEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true") {
    throw new Error("Profile media contributions are not enabled.");
  }
}

function sanitizeNote(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function mcpContributorSubject(userId: Id<"users">): AuthSubject {
  return {
    tokenIdentifier: `api:${userId}`,
    issuer: "vrdex:api",
    subject: String(userId),
    displayName: "API user",
  };
}

function rejectMcpMediaSubmission(code: string, message?: string): never {
  throw new ConvexError({ code, ...(message === undefined ? {} : { message }) });
}

function normalizeMcpSubmissionSourceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return rejectMcpMediaSubmission("MCP_MEDIA_SOURCE_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return rejectMcpMediaSubmission("MCP_MEDIA_SOURCE_INVALID");
  }
  return url.toString();
}

function mcpSubmissionSummary(submission: Doc<"profileMediaSubmissions">) {
  return {
    submissionId: submission._id,
    profileSlug: submission.targetProfileSlug,
    profileDisplayName: submission.targetProfileDisplayName,
    requestedPlacement: submission.requestedPlacement,
    status: submission.status,
    ...(submission.publicDisposition === undefined
      ? {}
      : { publicDisposition: submission.publicDisposition }),
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

async function failMcpMediaSubmissionRecord(
  ctx: MutationCtx,
  intent: Doc<"profileAssetUploadIntents">,
  submission: Doc<"profileMediaSubmissions">,
  errorCode: string,
  now: number,
) {
  const normalizedCode = errorCode.trim().slice(0, 80) || "MCP_MEDIA_IMPORT_REJECTED";
  await ctx.db.patch(intent._id, {
    mcpFailureCode: normalizedCode,
    processingToken: undefined,
    processingStartedAt: undefined,
    expiresAt: Math.min(intent.expiresAt, now - 1),
    updatedAt: now,
  });
  if (submission.status === "upload_pending") {
    await ctx.db.patch(submission._id, {
      status: "withdrawn",
      blobDeleteAfter: now + PROFILE_MEDIA_SUBMISSION_RETENTION_MS,
      updatedAt: now,
    });
  }
  return { status: "rejected" as const, errorCode: normalizedCode };
}

function mcpTargetRefusal(
  profile: Doc<"profiles"> | null,
  expectedUpdatedAt: number,
) {
  if (
    profile === null ||
    profile.publicationState !== "published" ||
    profile.publicSurfacingState !== "public"
  ) {
    return "MCP_MEDIA_TARGET_UNAVAILABLE";
  }
  if (profile.claimState !== "unclaimed") return "MCP_MEDIA_TARGET_CLAIMED";
  if (profile.profileType !== "person") return "MCP_MEDIA_TARGET_TYPE";
  if (profile.updatedAt !== expectedUpdatedAt) return "MCP_MEDIA_PROFILE_CHANGED";
  return null;
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

async function submissionRateLimit(
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
    return "user_daily" as const;
  }
  if (recentForProfile.length >= MAX_CREATED_PER_PROFILE_PER_DAY) {
    return "profile_daily" as const;
  }
  if ((recentForUser[0]?.createdAt ?? 0) > now - CREATE_COOLDOWN_MS) {
    return "cooldown" as const;
  }
  return null;
}

async function assertSubmissionRateLimits(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  profileId: Id<"profiles">,
  now: number,
) {
  if (await submissionRateLimit(ctx, userId, profileId, now) !== null) {
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
    throw new ConvexError({
      code: "MEDIA_TARGET_UNAVAILABLE",
      message: "This profile is not accepting media contributions.",
    });
  }
  if (profile.claimState !== "unclaimed") {
    throw new ConvexError({
      code: "MEDIA_TARGET_CLAIMED",
      message: "This profile has been claimed. Its owner manages its media.",
    });
  }
  if (
    (profile.profileType === "person" && placement !== "profile_image") ||
    (profile.profileType === "community" && placement !== "primary_logo")
  ) {
    throw new ConvexError({
      code: "MEDIA_PLACEMENT_INVALID",
      message: "That media placement is not available for this profile type.",
    });
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
    throw new ConvexError({
      code: "MEDIA_REVIEW_ACCESS_REQUIRED",
      message: "Profile media review access is required.",
    });
  }
  if (!access.superAdmin && profile.claimState === "unclaimed") {
    throw new Error("Only a moderator can review media for an unclaimed profile.");
  }
  return { user, subject, access, ownsProfile };
}

function publicSubmission(
  submission: Doc<"profileMediaSubmissions">,
  profile: Doc<"profiles">,
  usePublicProfileIdentity = false,
) {
  const profileIsPublic =
    profile.publicationState === "published" && profile.publicSurfacingState === "public";

  return {
    submissionId: submission._id,
    profileId: profile._id,
    profileSlug: usePublicProfileIdentity && !profileIsPublic
      ? submission.targetProfileSlug
      : profile.slug,
    profileDisplayName: usePublicProfileIdentity && !profileIsPublic
      ? submission.targetProfileDisplayName
      : profile.displayName,
    profileIsPublic,
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
        .withIndex("by_profileId_contentSha256_createdAt", (query) =>
          query
            .eq("profileId", profile._id)
            .eq("contentSha256", submission.contentSha256)
            .lt("createdAt", submission.createdAt),
        )
        .take(21);
  const priorProposalCount = Math.min(duplicates.length, 20);
  const priorProposalCountTruncated = duplicates.length > priorProposalCount;
  const submitter = includeModeratorEvidence
    ? await ctx.db.get(submission.submitterUserId)
    : null;

  return {
    ...publicSubmission(submission, profile),
    priorProposalCount,
    priorProposalCountTruncated,
    canViewCandidate:
      includeModeratorEvidence ||
      submission.status === "submitted" ||
      submission.status === "under_review" ||
      submission.status === "approved",
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
      throw new ConvexError({ code: "MEDIA_EMAIL_UNVERIFIED", message: "Verify email" });
    }
    const profile = assertEligibleTarget(await ctx.db.get(args.profileId), args.requestedPlacement);
    if (profile.updatedAt !== args.expectedProfileUpdatedAt) {
      throw new ConvexError({ code: "MEDIA_PROFILE_CHANGED", message: "Refresh profile" });
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
      throw new ConvexError({
        code: "MEDIA_INPUT_INVALID",
        message: "A source URL, file name, and credit are required.",
      });
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
      targetProfileSlug: profile.slug,
      targetProfileDisplayName: profile.displayName,
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

export const prepareMcpMediaSubmission = internalMutation({
  args: {
    actorUserId: v.id("users"),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    requestId: v.string(),
    idempotencyKeyHash: v.string(),
    requestFingerprint: v.string(),
    slug: v.string(),
    sourceUrl: v.string(),
    credit: v.string(),
    creditUrl: v.optional(v.string()),
    label: v.optional(v.string()),
    altText: v.optional(v.string()),
    contributorNote: v.optional(v.string()),
    expectedUpdatedAt: v.number(),
    emailVerificationAttestedAt: v.optional(v.number()),
    emailVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Coded so the hosted handler reports the global switch as a deterministic
    // refusal. A plain throw here would read as an indeterminate write.
    if (process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true") {
      return rejectMcpMediaSubmission("MCP_MEDIA_DISABLED");
    }
    const oauthClientId = requireMcpAttributionText(args.oauthClientId, "OAuth client id", 256);
    const oauthTokenId = requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256);
    const requestId = requireMcpAttributionText(args.requestId, "Request id", 256);
    const idempotencyKeyHash = requireSha256Hex(args.idempotencyKeyHash, "Idempotency key hash");
    const requestFingerprint = requireSha256Hex(args.requestFingerprint, "Request fingerprint");
    const existingIntent = await ctx.db
      .query("profileAssetUploadIntents")
      .withIndex("by_mcp_actor_client_key", (query) =>
        query
          .eq("mcpActorUserId", args.actorUserId)
          .eq("mcpOauthClientId", oauthClientId)
          .eq("mcpIdempotencyKeyHash", idempotencyKeyHash),
      )
      .unique();

    if (
      args.emailVerificationAttestedAt === undefined ||
      args.emailVerified === undefined
    ) {
      return { status: "verification_required" as const };
    }
    const verificationAge = Date.now() - args.emailVerificationAttestedAt;
    // The attestation is stamped on Vercel and checked here on Convex, so a
    // little backward skew is normal and must not read as a forged timestamp.
    if (
      !Number.isSafeInteger(args.emailVerificationAttestedAt) ||
      verificationAge < -MCP_EMAIL_ATTESTATION_SKEW_MS ||
      verificationAge > 2 * 60 * 1_000
    ) {
      return rejectMcpMediaSubmission("MCP_MEDIA_EMAIL_ATTESTATION_INVALID");
    }

    if (existingIntent !== null) {
      if (
        existingIntent.mcpRequestFingerprint !== requestFingerprint ||
        existingIntent.targetSubmissionId === undefined
      ) {
        return rejectMcpMediaSubmission("MCP_MEDIA_IDEMPOTENCY_CONFLICT");
      }
      const submission = await ctx.db.get(existingIntent.targetSubmissionId);
      if (submission === null || submission.submitterUserId !== args.actorUserId) {
        return rejectMcpMediaSubmission("MCP_MEDIA_SUBMISSION_DENIED");
      }
      if (existingIntent.mcpFailureCode !== undefined) {
        return existingIntent.mcpFailureCode === "MCP_MEDIA_IMPORT_EXPIRED"
          ? { status: "expired" as const }
          : { status: "failed" as const, errorCode: existingIntent.mcpFailureCode };
      }
      if (submission.status !== "upload_pending") {
        return { status: "completed" as const, submission: mcpSubmissionSummary(submission) };
      }
      const now = Date.now();
      if (existingIntent.expiresAt < now) {
        await failMcpMediaSubmissionRecord(
          ctx,
          existingIntent,
          submission,
          "MCP_MEDIA_IMPORT_EXPIRED",
          now,
        );
        return { status: "expired" as const };
      }
      // Replaying a finished submission above needs no verification; resuming
      // an import below does.
      if (!args.emailVerified) {
        return { status: "failed" as const, errorCode: "MCP_MEDIA_EMAIL_UNVERIFIED" };
      }
      if (
        existingIntent.processingToken !== undefined &&
        (existingIntent.processingStartedAt === undefined ||
          existingIntent.processingStartedAt > now - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS)
      ) {
        return { status: "processing" as const, submissionId: submission._id };
      }
      return {
        status: "pending" as const,
        intentId: existingIntent._id,
        submissionId: submission._id,
      };
    }

    const existingRefusal = await ctx.db
      .query("mcpProfileMediaSubmissionRefusalReceipts")
      .withIndex("by_actor_client_key", (query) =>
        query
          .eq("actorUserId", args.actorUserId)
          .eq("oauthClientId", oauthClientId)
          .eq("idempotencyKeyHash", idempotencyKeyHash),
      )
      .unique();
    if (existingRefusal !== null) {
      if (existingRefusal.requestFingerprint !== requestFingerprint) {
        return rejectMcpMediaSubmission("MCP_MEDIA_IDEMPOTENCY_CONFLICT");
      }
      return { status: "failed" as const, errorCode: existingRefusal.errorCode };
    }
    const refuse = async (errorCode: string) => {
      await ctx.db.insert("mcpProfileMediaSubmissionRefusalReceipts", {
        actorUserId: args.actorUserId,
        oauthClientId,
        idempotencyKeyHash,
        requestFingerprint,
        errorCode,
        createdAt: Date.now(),
      });
      return { status: "failed" as const, errorCode };
    };
    const actor = await ctx.db.get(args.actorUserId);
    if (actor === null) {
      return await refuse("MCP_MEDIA_EMAIL_UNVERIFIED");
    }
    if (!args.emailVerified) {
      return await refuse("MCP_MEDIA_EMAIL_UNVERIFIED");
    }

    const slug = validateProfileSlug(args.slug);
    const profile = !slug.ok ? null : await getProfileBySlug(ctx.db, slug.slug);
    if (!Number.isSafeInteger(args.expectedUpdatedAt) || args.expectedUpdatedAt < 0) {
      return await refuse("MCP_MEDIA_PROFILE_CHANGED");
    }
    const targetRefusal = mcpTargetRefusal(profile, args.expectedUpdatedAt);
    if (targetRefusal !== null) {
      return await refuse(targetRefusal);
    }
    const eligible = profile!;

    const now = Date.now();
    if (await openSubmissionCountForUser(ctx, actor._id, now) >= MAX_OPEN_PER_USER) {
      return await refuse("MCP_MEDIA_OPEN_USER_LIMIT");
    }
    if (await openSubmissionCountForProfile(ctx, eligible._id, now) >= MAX_OPEN_PER_PROFILE) {
      return await refuse("MCP_MEDIA_OPEN_PROFILE_LIMIT");
    }
    const creationLimit = await submissionRateLimit(ctx, actor._id, eligible._id, now);
    if (creationLimit === "user_daily") {
      return await refuse("MCP_MEDIA_USER_DAILY_LIMIT");
    }
    if (creationLimit === "profile_daily") {
      return await refuse("MCP_MEDIA_PROFILE_DAILY_LIMIT");
    }
    if (creationLimit === "cooldown") {
      return await refuse("MCP_MEDIA_COOLDOWN");
    }

    let sourceUrl;
    let credit;
    let label;
    let altText;
    let creditUrl;
    try {
      sourceUrl = normalizeProfileAssetSourceUrl(normalizeMcpSubmissionSourceUrl(args.sourceUrl));
      credit = sanitizeProfileAssetCredit(args.credit);
      label = sanitizeProfileAssetLabel(args.label);
      altText = sanitizeProfileAssetAltText(args.altText);
      creditUrl = sanitizeProfileAssetCreditUrl(args.creditUrl);
    } catch {
      return await refuse("MCP_MEDIA_INPUT_INVALID");
    }
    if (sourceUrl === undefined || credit === undefined) {
      return await refuse("MCP_MEDIA_INPUT_INVALID");
    }
    const contributorNote = sanitizeNote(args.contributorNote, 500);
    const targetPlacement = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (query) =>
        query
          .eq("profileId", eligible._id)
          .eq("placement", "profile_image")
          .eq("state", "active"),
      )
      .first();
    const subject = mcpContributorSubject(actor._id);
    const submissionId = await ctx.db.insert("profileMediaSubmissions", {
      profileId: eligible._id,
      targetProfileSlug: eligible.slug,
      targetProfileDisplayName: eligible.displayName,
      submitterUserId: actor._id,
      submitter: subject,
      requestedPlacement: "profile_image",
      sourceUrl,
      ...(label === undefined ? {} : { label }),
      ...(altText === undefined ? {} : { altText }),
      credit,
      ...(creditUrl === undefined ? {} : { creditUrl }),
      ...(contributorNote === undefined ? {} : { contributorNote }),
      status: "upload_pending",
      targetProfileUpdatedAt: eligible.updatedAt,
      ...(targetPlacement === null ? {} : { targetPlacementAssetId: targetPlacement.assetId }),
      expiresAt: now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: subject,
      targetProfileId: eligible._id,
      targetSubmissionId: submissionId,
      purpose: "community_proposal",
      sourceUrl,
      label,
      altText,
      credit,
      creditUrl,
      placements: ["profile_image"],
      source: "community_submitted",
      now,
    });
    await ctx.db.patch(submissionId, { uploadIntentId: intent.intentId, updatedAt: now });
    await ctx.db.patch(intent.intentId, {
      mcpActorUserId: actor._id,
      mcpOauthClientId: oauthClientId,
      mcpOauthTokenId: oauthTokenId,
      mcpRequestId: requestId,
      mcpIdempotencyKeyHash: idempotencyKeyHash,
      mcpRequestFingerprint: requestFingerprint,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: eligible._id,
      action: "profile_media_submission_created",
      actor: subject,
      sourceType: "community",
      createdAt: now,
    });
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_asset_upload_intent_created",
      actorKind: "user_delegated_oauth",
      actorUserId: actor._id,
      oauthClientId,
      oauthTokenId,
      requestId,
      idempotencyKeyHash,
      mcpToolName: "vrdex_profile_media_submit",
      resourceType: "profile_asset_upload_intent",
      routeClass: "authenticated_mcp_write",
      targetProfileId: eligible._id,
      now,
    });

    return { status: "pending" as const, intentId: intent.intentId, submissionId };
  },
});

export const claimMcpMediaSubmissionImport = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.mcpActorUserId === undefined ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.targetSubmissionId === undefined ||
      intent.targetProfileId === undefined ||
      intent.sourceUrl === undefined
    ) {
      return { status: "not_found" as const };
    }
    const submission = await ctx.db.get(intent.targetSubmissionId);
    if (
      submission === null ||
      submission.profileId !== intent.targetProfileId ||
      submission.uploadIntentId !== intent._id ||
      submission.submitterUserId !== intent.mcpActorUserId ||
      submission.status !== "upload_pending"
    ) {
      return { status: "not_found" as const };
    }
    const now = Date.now();
    if (intent.mcpFailureCode !== undefined || intent.state !== "pending") {
      return { status: "not_found" as const };
    }
    if (intent.expiresAt < now) {
      return await failMcpMediaSubmissionRecord(
        ctx,
        intent,
        submission,
        "MCP_MEDIA_IMPORT_EXPIRED",
        now,
      );
    }
    const profile = await ctx.db.get(intent.targetProfileId);
    const targetRefusal = mcpTargetRefusal(profile, submission.targetProfileUpdatedAt);
    if (targetRefusal !== null) {
      return await failMcpMediaSubmissionRecord(ctx, intent, submission, targetRefusal, now);
    }
    if (
      intent.processingToken !== undefined &&
      (intent.processingStartedAt === undefined ||
        intent.processingStartedAt > now - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS)
    ) {
      return { status: "in_use" as const };
    }
    const attempts = intent.processingAttempts ?? 0;
    if (attempts >= PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS) {
      return await failMcpMediaSubmissionRecord(
        ctx,
        intent,
        submission,
        "MCP_MEDIA_IMPORT_ATTEMPTS_EXHAUSTED",
        now,
      );
    }
    await ctx.db.patch(intent._id, {
      processingToken: args.processingToken,
      processingStartedAt: now,
      processingAttempts: attempts + 1,
      updatedAt: now,
    });
    return {
      status: "claimed" as const,
      intentId: intent._id,
      sourceUrl: intent.sourceUrl,
      storageKey: intent.storageKey,
      ...(intent.sourceStorageKey === undefined
        ? {}
        : { sourceStorageKey: intent.sourceStorageKey }),
      ...(intent.downloadStorageKey === undefined
        ? {}
        : { downloadStorageKey: intent.downloadStorageKey }),
      expiresAt: intent.expiresAt,
    };
  },
});

export const markMcpMediaSubmissionImported = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    sourceMimeType: v.optional(v.string()),
    sourceByteSize: v.optional(v.number()),
    sourceContentSha256: v.optional(v.string()),
    downloadMimeType: v.optional(v.string()),
    downloadByteSize: v.optional(v.number()),
    downloadContentSha256: v.optional(v.string()),
    contentSha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertContributionsEnabled();
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.mcpActorUserId === undefined ||
      intent.mcpOauthClientId === undefined ||
      intent.mcpOauthTokenId === undefined ||
      intent.mcpRequestId === undefined ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.targetSubmissionId === undefined ||
      intent.targetProfileId === undefined ||
      intent.processingToken !== args.processingToken
    ) {
      return rejectMcpMediaSubmission("MCP_MEDIA_IMPORT_UNAVAILABLE");
    }
    const submission = await ctx.db.get(intent.targetSubmissionId);
    if (
      submission === null ||
      submission.submitterUserId !== intent.mcpActorUserId ||
      submission.status !== "upload_pending"
    ) {
      return rejectMcpMediaSubmission("MCP_MEDIA_IMPORT_UNAVAILABLE");
    }
    const profile = await ctx.db.get(intent.targetProfileId);
    const targetRefusal = mcpTargetRefusal(profile, submission.targetProfileUpdatedAt);
    if (targetRefusal !== null) return rejectMcpMediaSubmission(targetRefusal);

    await finalizeProfileAssetUploadIntentUpload(ctx.db, {
      ...args,
      uploadToken: intent.uploadToken,
      now: Date.now(),
    });
    const updated = await ctx.db.get(submission._id);
    if (updated === null || updated.status !== "submitted") {
      return rejectMcpMediaSubmission("MCP_MEDIA_IMPORT_UNAVAILABLE");
    }
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_media_submission_submitted",
      actorKind: "user_delegated_oauth",
      actorUserId: intent.mcpActorUserId,
      oauthClientId: intent.mcpOauthClientId,
      oauthTokenId: intent.mcpOauthTokenId,
      requestId: intent.mcpRequestId,
      idempotencyKeyHash: intent.mcpIdempotencyKeyHash,
      mcpToolName: "vrdex_profile_media_submit",
      resourceType: "profile_media_submission",
      routeClass: "authenticated_mcp_write",
      targetProfileId: intent.targetProfileId,
      targetSubmissionId: submission._id,
      now: Date.now(),
    });
    return mcpSubmissionSummary(updated);
  },
});

export const hasDuplicateMcpMediaSubmissionImport = internalQuery({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
    contentSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.processingToken !== args.processingToken ||
      intent.targetSubmissionId === undefined ||
      intent.targetProfileId === undefined ||
      intent.state !== "pending" ||
      intent.expiresAt < Date.now()
    ) {
      return false;
    }
    const [assets, submissions] = await Promise.all([
      ctx.db
        .query("profileAssets")
        .withIndex("by_profileId", (query) => query.eq("profileId", intent.targetProfileId!))
        .collect(),
      Promise.all(([
        "submitted",
        "under_review",
        "approved",
      ] as const).map((status) =>
        ctx.db
          .query("profileMediaSubmissions")
          .withIndex("by_profileId_contentSha256_status", (query) =>
            query
              .eq("profileId", intent.targetProfileId!)
              .eq("contentSha256", args.contentSha256)
              .eq("status", status),
          )
          .first(),
      )),
    ]);
    return assets.some((asset) => asset.contentSha256 === args.contentSha256)
      || submissions.some(
        (submission) => submission !== null && submission._id !== intent.targetSubmissionId,
      );
  },
});

export const failMcpMediaSubmissionImport = internalMutation({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.processingToken !== args.processingToken ||
      intent.targetSubmissionId === undefined ||
      intent.mcpActorUserId === undefined
    ) {
      return false;
    }
    const submission = await ctx.db.get(intent.targetSubmissionId);
    if (
      submission === null ||
      submission.submitterUserId !== intent.mcpActorUserId ||
      submission.status !== "upload_pending"
    ) {
      return false;
    }
    await failMcpMediaSubmissionRecord(ctx, intent, submission, args.errorCode, Date.now());
    return true;
  },
});

export const getMcpMediaSubmissionImportState = internalQuery({
  args: {
    intentId: v.id("profileAssetUploadIntents"),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.purpose !== "community_proposal" ||
      intent.targetSubmissionId === undefined
    ) {
      return null;
    }
    const submission = await ctx.db.get(intent.targetSubmissionId);
    if (submission === null) return null;
    return {
      intentState: intent.state,
      ...(intent.mcpFailureCode === undefined ? {} : { failureCode: intent.mcpFailureCode }),
      leaseMatches: intent.processingToken === args.processingToken,
      submission: mcpSubmissionSummary(submission),
    };
  },
});

export const getMcpContributorIdentity = internalQuery({
  args: { actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    return actor === null ? null : { clerkUserId: actor.clerkUserId };
  },
});

export const listMcpMediaSubmissionsForActor = internalQuery({
  args: { actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    const groups = await Promise.all(
      ([
        "upload_pending",
        "submitted",
        "under_review",
        "approved",
        "rejected",
        "withdrawn",
        "superseded",
      ] as const).map((status) =>
        ctx.db
          .query("profileMediaSubmissions")
          .withIndex("by_submitterUserId_status_createdAt", (query) =>
            query.eq("submitterUserId", args.actorUserId).eq("status", status),
          )
          .order("desc")
          .take(40),
      ),
    );
    const rows = groups.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
    const submissions = await Promise.all(rows.map(async (submission) => {
      let approvedAssetId: Id<"profileAssets"> | undefined;
      if (submission.approvedAssetId !== undefined) {
        const [asset, profile] = await Promise.all([
          ctx.db.get(submission.approvedAssetId),
          ctx.db.get(submission.profileId),
        ]);
        const placements = asset === null
          ? []
          : await ctx.db
              .query("profileAssetPlacements")
              .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
              .collect();
        const activePlacements = placements.filter((placement) => placement.state === "active");
        const visibleOnProfile =
          profile !== null &&
          (activePlacements.length === 0
            ? isProfileFieldVisible(profile, "mediaKit", "profile_page")
            : activePlacements.some((placement) =>
                placement.placement === "profile_image"
                  ? isProfileFieldVisible(profile, "avatarImageUrl", "profile_page")
                  : placement.placement === "banner"
                    ? isProfileFieldVisible(profile, "bannerImageUrl", "profile_page")
                    : isProfileFieldVisible(profile, "mediaKit", "profile_page"),
              ));
        if (
          asset !== null &&
          asset.profileId === submission.profileId &&
          asset.state === "active" &&
          asset.visibility === "public" &&
          profile !== null &&
          profile.publicationState === "published" &&
          profile.publicSurfacingState === "public" &&
          visibleOnProfile
        ) {
          approvedAssetId = asset._id;
        }
      }
      return {
        ...mcpSubmissionSummary(submission),
        ...(approvedAssetId === undefined ? {} : { approvedAssetId }),
      };
    }));
    return { submissions };
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
        return profile === null ? null : publicSubmission(submission, profile, true);
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
    finalPlacement: v.optional(requestedPlacement),
    label: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    creditUrl: v.optional(v.string()),
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
    const finalPlacement = args.finalPlacement ?? submission.requestedPlacement;
    if (
      (profile.profileType === "person" && finalPlacement !== "profile_image") ||
      (profile.profileType === "community" && finalPlacement !== "primary_logo")
    ) {
      throw new Error("That media placement is not available for this profile type.");
    }
    const finalLabel = "label" in args
      ? sanitizeProfileAssetLabel(args.label)
      : submission.label;
    const finalAltText = "altText" in args
      ? sanitizeProfileAssetAltText(args.altText)
      : submission.altText;
    const finalCredit = "credit" in args
      ? sanitizeProfileAssetCredit(args.credit)
      : submission.credit;
    const finalCreditUrl = "creditUrl" in args
      ? sanitizeProfileAssetCreditUrl(args.creditUrl)
      : submission.creditUrl;
    if (finalCredit === undefined) {
      throw new Error("Asset credit is required before approval.");
    }
    const assetIds = await consumeProfileAssetUploads(ctx.db, {
      profileId: profile._id,
      requestedBy: intent.requestedBy,
      approvedSubmissionId: submission._id,
      uploads: [{
        intentId: intent._id,
        uploadToken: intent.uploadToken,
        label: finalLabel,
        altText: finalAltText,
        credit: finalCredit,
        creditUrl: finalCreditUrl,
        placements: [finalPlacement],
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
