import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  mutation,
  type DatabaseReader,
  type DatabaseWriter,
  type MutationCtx,
} from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import { requireUser } from "./_identity";
import {
  activeBrowserSessionOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";
import {
  normalizeProfilePublicSectionOrder,
  toPublicProfileAppearance,
} from "./_profileAppearance";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import { isProfileFieldVisible } from "./_profileFieldVisibility";
import {
  PROFILE_ASSET_MAX_ACTIVE_COUNT,
  PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS,
  PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS,
  assertProfileMediaVersion,
  assertProfileAssetIntentCapacity,
  createProfileAssetUploadIntentRecord,
  finalizeProfileAssetUploadIntentUpload,
  getProfileMediaVersion,
  getProfileAssetDisplayPreference,
  getPublicProfileMediaKit,
  normalizeProfileAvatarAppearance,
  publicProfileAssetImageUrl,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCaption,
  sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl,
  sanitizeProfileAssetLabel,
  type ProfileAssetPlacement,
} from "./_profileAssets";
import {
  apiWriteAuditActorKindValidator,
  recordApiWriteAuditEvent,
} from "./_apiWriteAuditEvents";
import {
  requireMcpAttributionText,
  requireSha256Hex,
} from "./_mcpWriteReceipts";

const profileAssetUploadIntentId = v.id("profileAssetUploadIntents");
const profileId = v.id("profiles");
const profilePublicSection = v.union(
  v.literal("about"),
  v.literal("events"),
  v.literal("links"),
  v.literal("media_kit"),
  v.literal("worlds"),
  v.literal("details"),
);
const profileAssetPlacement = v.union(
  v.literal("profile_image"),
  v.literal("banner"),
  v.literal("primary_logo"),
  v.literal("additional_logo"),
  v.literal("gallery"),
  v.literal("featured"),
);
const profileAssetUploadIntentArgs = {
  originalFileName: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  mimeType: v.string(),
  byteSize: v.optional(v.number()),
};
const profileAssetAttachMetadataArgs = {
  label: v.optional(v.string()),
  caption: v.optional(v.string()),
  altText: v.optional(v.string()),
  credit: v.optional(v.string()),
  creditUrl: v.optional(v.string()),
  placements: v.optional(v.array(profileAssetPlacement)),
  position: v.optional(v.number()),
};
const nullableMetadataValue = v.union(v.string(), v.null());
const mcpProfileAssetMetadataPatch = v.object({
  label: v.optional(nullableMetadataValue),
  caption: v.optional(nullableMetadataValue),
  altText: v.optional(nullableMetadataValue),
  credit: v.optional(nullableMetadataValue),
  creditUrl: v.optional(nullableMetadataValue),
});
const PROFILE_ASSET_ACCESSIBILITY_GENERATION_DAILY_LIMIT = 20;
const PROFILE_ASSET_ACCESSIBILITY_GENERATION_COOLDOWN_MS = 5_000;
const PROFILE_ASSET_ACCESSIBILITY_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE_ASSET_ACCESSIBILITY_MODEL = /^[a-z0-9][a-z0-9._:-]{0,99}$/iu;

function assertProfileMediaKitEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true") {
    throw new ConvexError("Profile media kits are not enabled.");
  }
}

function profileMediaDirectUploadEnabled() {
  return process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED === "true";
}

function assertProfileMediaAccessibilityGenerationEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED !== "true") {
    throw new Error("Profile media accessibility generation is not enabled.");
  }
}

function requestsGalleryPlacement(placements: Array<"profile_image" | "banner" | "primary_logo" | "additional_logo" | "gallery" | "featured"> | undefined) {
  return placements?.some((placement) => placement === "gallery" || placement === "featured") ?? false;
}

async function requireOwnedAppearanceProfile(ctx: MutationCtx, requestedProfileId: Id<"profiles">) {
  const { user } = await requireUser(ctx);
  const profile = await ctx.db.get(requestedProfileId);

  if (profile === null) {
    throw new Error("Profile not found.");
  }

  if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
    throw new Error("Only the profile owner can update profile appearance.");
  }

  return profile;
}

function apiOwnerAuthSubject(userId: Doc<"users">["_id"]): AuthSubject {
  return {
    tokenIdentifier: `api:${userId}`,
    issuer: "vrdex:api",
    subject: String(userId),
    displayName: "API user",
  };
}

function profilePath(profile: Doc<"profiles">): string {
  return `/${profile.slug}`;
}

async function requireApiOwnedClaimedProfileBySlug(
  ctx: MutationCtx,
  slug: string,
  ownerUserId: Id<"users">,
) {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw new Error("Current profile slug is invalid.");
  }

  const profile = await getProfileBySlug(ctx.db, validation.slug);

  if (profile === null) {
    throw new Error("Profile was not found.");
  }

  if (!(await userOwnsProfile(ctx.db, profile._id, ownerUserId))) {
    throw new Error("You do not have permission to update this profile.");
  }

  if (profile.claimState === "unclaimed") {
    throw new Error("Only a claimed profile owner can update profile assets.");
  }

  return profile;
}

function rejectMcpMediaMutation(message: string): never {
  throw new ConvexError({ code: "MCP_MEDIA_INVALID", message });
}

async function requireMcpOwnedClaimedProfileBySlug(
  ctx: MutationCtx,
  slug: string,
  ownerUserId: Id<"users">,
) {
  try {
    return await requireApiOwnedClaimedProfileBySlug(ctx, slug, ownerUserId);
  } catch {
    return rejectMcpMediaMutation("The owned claimed profile is unavailable.");
  }
}

async function assertMcpProfileAssetIntentCapacity(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  now: number,
) {
  try {
    await assertProfileAssetIntentCapacity(db, profileId, now);
  } catch {
    rejectMcpMediaMutation("The profile media quota is full.");
  }
}

async function patchProfileDisplayPreference(
  ctx: MutationCtx,
  requestedProfileId: Id<"profiles">,
  values: {
    avatarAppearance?: ReturnType<typeof normalizeProfileAvatarAppearance>;
    sectionOrder?: ReturnType<typeof normalizeProfilePublicSectionOrder>;
  },
) {
  const existing = await getProfileAssetDisplayPreference(ctx.db, requestedProfileId);
  const now = Date.now();

  if (existing === null) {
    await ctx.db.insert("profileAssetDisplayPreferences", {
      profileId: requestedProfileId,
      compactDisplay: "auto",
      ...values,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(existing._id, {
    ...values,
    updatedAt: now,
  });
}

export const createUploadIntent = internalMutation({
  args: profileAssetUploadIntentArgs,
  handler: async (ctx, args) => {
    const { subject } = await requireActiveBrowserSessionSubject(ctx);
    const now = Date.now();

    return await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: subject,
      ...args,
      purpose: "owner_publish",
      now,
    });
  },
});

export const createUploadIntentForApiProfileOwner = internalMutation({
  args: {
    actorKind: apiWriteAuditActorKindValidator,
    ownerUserId: v.id("users"),
    slug: v.string(),
    ...profileAssetUploadIntentArgs,
    ...profileAssetAttachMetadataArgs,
  },
  handler: async (ctx, args) => {
    if (requestsGalleryPlacement(args.placements)) {
      assertProfileMediaKitEnabled();
    }
    const profile = await requireApiOwnedClaimedProfileBySlug(ctx, args.slug, args.ownerUserId);
    const now = Date.now();
    await assertProfileAssetIntentCapacity(ctx.db, profile._id, now);
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: apiOwnerAuthSubject(args.ownerUserId),
      targetProfileId: profile._id,
      originalFileName: args.originalFileName,
      sourceUrl: args.sourceUrl,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      label: args.label,
      caption: args.caption,
      altText: args.altText,
      credit: args.credit,
      creditUrl: args.creditUrl,
      placements: args.placements,
      position: args.position,
      source: "owner_authored",
      purpose: "owner_publish",
      now,
    });
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_asset_upload_intent_created",
      actorKind: args.actorKind,
      ownerUserId: args.ownerUserId,
      resourceType: "profile_asset_upload_intent",
      routeClass: "asset_upload_intent",
      targetProfileId: profile._id,
      targetIntentId: intent.intentId,
      now,
    });

    return {
      profileId: profile._id,
      slug: profile.slug,
      profileType: profile.profileType,
      profilePath: profilePath(profile),
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      uploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}`,
      ...(args.sourceUrl === undefined && profileMediaDirectUploadEnabled()
        ? { directUploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}/direct-upload` }
        : {}),
      uploadTokenHeader: "x-vrdex-upload-token",
      expiresAt: intent.expiresAt,
    };
  },
});

export const createImportIntentForMcpOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    requestId: v.string(),
    idempotencyKeyHash: v.string(),
    requestFingerprint: v.string(),
    slug: v.string(),
    expectedMediaVersion: v.string(),
    sourceUrl: v.string(),
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    creditUrl: v.optional(v.string()),
    placements: v.array(profileAssetPlacement),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const oauthClientId = requireMcpAttributionText(
      args.oauthClientId,
      "OAuth client id",
      256,
    );
    const idempotencyKeyHash = requireSha256Hex(
      args.idempotencyKeyHash,
      "Idempotency key hash",
    );
    const requestFingerprint = requireSha256Hex(
      args.requestFingerprint,
      "Request fingerprint",
    );
    const existing = await ctx.db
      .query("profileAssetUploadIntents")
      .withIndex("by_mcp_owner_client_key", (query) =>
        query
          .eq("mcpOwnerUserId", args.ownerUserId)
          .eq("mcpOauthClientId", oauthClientId)
          .eq("mcpIdempotencyKeyHash", idempotencyKeyHash),
      )
      .unique();

    if (existing !== null) {
      if (existing.mcpRequestFingerprint !== requestFingerprint) {
        throw new ConvexError({ code: "MCP_WRITE_DENIED" });
      }
      if (existing.targetProfileId === undefined) {
        throw new ConvexError({ code: "MCP_WRITE_DENIED" });
      }
      const profile = await ctx.db.get(existing.targetProfileId);

      if (
        profile === null ||
        profile.claimState === "unclaimed" ||
        !(await userOwnsProfile(ctx.db, profile._id, args.ownerUserId))
      ) {
        throw new ConvexError({ code: "MCP_WRITE_DENIED" });
      }
      if (existing.state === "consumed" && existing.mcpAssetIds !== undefined) {
        return {
          status: "completed" as const,
          assetIds: existing.mcpAssetIds,
          media: await buildOwnedMediaInventory(ctx.db, profile),
        };
      }
      if (existing.expiresAt < Date.now()) {
        return { status: "expired" as const };
      }

      return { status: "pending" as const, intentId: existing._id };
    }

    if (args.placements.length === 0) {
      rejectMcpMediaMutation("Imported profile media requires at least one placement.");
    }
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(args.sourceUrl);
    } catch {
      return rejectMcpMediaMutation("Profile media source URL is invalid.");
    }
    if (sourceUrl.search || sourceUrl.hash) {
      rejectMcpMediaMutation("Profile media source URLs must not contain query parameters or fragments.");
    }

    const profile = await requireMcpOwnedClaimedProfileBySlug(ctx, args.slug, args.ownerUserId);
    await assertProfileMediaVersion(ctx.db, profile._id, args.expectedMediaVersion);
    const now = Date.now();
    await assertMcpProfileAssetIntentCapacity(ctx.db, profile._id, now);
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: apiOwnerAuthSubject(args.ownerUserId),
      targetProfileId: profile._id,
      sourceUrl: args.sourceUrl,
      label: args.label,
      caption: args.caption,
      altText: args.altText,
      credit: args.credit,
      creditUrl: args.creditUrl,
      placements: args.placements,
      source: "owner_authored",
      purpose: "owner_publish",
      now,
    });
    await ctx.db.patch(intent.intentId, {
      mcpOwnerUserId: args.ownerUserId,
      mcpOauthClientId: oauthClientId,
      mcpOauthTokenId: requireMcpAttributionText(args.oauthTokenId, "OAuth token id", 256),
      mcpRequestId: requireMcpAttributionText(args.requestId, "Request id", 256),
      mcpIdempotencyKeyHash: idempotencyKeyHash,
      mcpRequestFingerprint: requestFingerprint,
      mcpExpectedMediaVersion: args.expectedMediaVersion,
    });
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_asset_upload_intent_created",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      oauthClientId,
      oauthTokenId: args.oauthTokenId,
      requestId: args.requestId,
      idempotencyKeyHash,
      mcpToolName: "vrdex_profile_media_manage",
      resourceType: "profile_asset_upload_intent",
      routeClass: "authenticated_mcp_write",
      targetProfileId: profile._id,
      now,
    });

    return { status: "pending" as const, intentId: intent.intentId };
  },
});

export const createUploadIntentForOwnedProfile = mutation({
  args: {
    profileId,
    replacesAssetId: v.optional(v.id("profileAssets")),
    ...profileAssetUploadIntentArgs,
    ...profileAssetAttachMetadataArgs,
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);

    if (profile.claimState === "unclaimed") {
      throw new Error("Claim this profile before adding media.");
    }

    const { user } = await requireUser(ctx);
    const now = Date.now();
    if (args.replacesAssetId !== undefined) {
      const replacedAsset = await ctx.db.get(args.replacesAssetId);
      if (
        replacedAsset === null ||
        replacedAsset.profileId !== profile._id ||
        replacedAsset.state !== "active"
      ) {
        throw new Error("The media being replaced is no longer active.");
      }
      const existingReplacement = await ctx.db
        .query("profileAssetUploadIntents")
        .withIndex("by_targetProfileId_state_expiresAt", (query) =>
          query.eq("targetProfileId", profile._id).eq("state", "pending").gt("expiresAt", now),
        )
        .filter((query) => query.eq(query.field("replacesAssetId"), args.replacesAssetId))
        .first();
      if (existingReplacement !== null) {
        throw new Error("This media already has a replacement in progress.");
      }
    }
    await assertProfileAssetIntentCapacity(ctx.db, profile._id, now, args.replacesAssetId === undefined ? 1 : 0);
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: apiOwnerAuthSubject(user._id),
      targetProfileId: profile._id,
      ...(args.replacesAssetId !== undefined ? { replacesAssetId: args.replacesAssetId } : {}),
      originalFileName: args.originalFileName,
      sourceUrl: args.sourceUrl,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      label: args.label,
      caption: args.caption,
      altText: args.altText,
      credit: args.credit,
      creditUrl: args.creditUrl,
      placements: args.placements ?? ["gallery"],
      position: args.position,
      source: "owner_authored",
      purpose: "owner_publish",
      now,
    });

    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_asset_upload_intent_created",
      actor: apiOwnerAuthSubject(user._id),
      sourceType: "owner",
      note: "Owner started a profile media upload.",
      createdAt: now,
    });

    return {
      ...intent,
      uploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}`,
      ...(args.sourceUrl === undefined && profileMediaDirectUploadEnabled()
        ? { directUploadUrl: `/api/v0/profile-assets/upload-intents/${intent.intentId}/direct-upload` }
        : {}),
      uploadTokenHeader: "x-vrdex-upload-token",
    };
  },
});

export const cancelOwnedUploadIntent = mutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const { user } = await requireUser(ctx);
    const intent = await ctx.db.get(args.intentId);

    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.targetProfileId === undefined ||
      intent.state !== "pending" ||
      intent.requestedBy.issuer !== "vrdex:api" ||
      intent.requestedBy.subject !== String(user._id) ||
      !(await userOwnsProfile(ctx.db, intent.targetProfileId, user._id))
    ) {
      return false;
    }

    const now = Date.now();
    if (
      intent.processingToken !== undefined &&
      (intent.processingStartedAt === undefined ||
        intent.processingStartedAt > now - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS)
    ) {
      return false;
    }
    await ctx.db.patch(intent._id, {
      expiresAt: Math.min(intent.expiresAt, now - 1),
      updatedAt: now,
    });
    return true;
  },
});

async function claimProfileAssetUploadIntentForStorage(
  ctx: MutationCtx,
  intent: Doc<"profileAssetUploadIntents">,
  processingToken: string,
) {
    const now = Date.now();

    if (intent.state !== "pending" || intent.expiresAt < now) {
      return { status: "not_found" as const };
    }

    if (intent.processingToken !== undefined) {
      if (
        intent.processingStartedAt !== undefined &&
        intent.processingStartedAt <= now - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS
      ) {
        await ctx.db.patch(intent._id, {
          expiresAt: Math.min(intent.expiresAt, now - 1),
          updatedAt: now,
        });
        return { status: "not_found" as const };
      }
      return { status: "in_use" as const };
    }

    const processingAttempts = intent.processingAttempts ?? 0;
    if (processingAttempts >= PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS) {
      await ctx.db.patch(intent._id, {
        expiresAt: Math.min(intent.expiresAt, now - 1),
        updatedAt: now,
      });
      return { status: "not_found" as const };
    }

    await ctx.db.patch(intent._id, {
      processingToken,
      processingStartedAt: now,
      processingAttempts: processingAttempts + 1,
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      intentId: intent._id,
      originalFileName: intent.originalFileName,
      sourceUrl: intent.sourceUrl,
      mimeType: intent.mimeType,
      byteSize: intent.byteSize,
      storageKey: intent.storageKey,
      quarantineStorageKey: intent.quarantineStorageKey,
      sourceStorageKey: intent.sourceStorageKey,
      downloadStorageKey: intent.downloadStorageKey,
      expiresAt: intent.expiresAt,
    };
}

export const claimUploadIntentForStorage = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);

    if (intent === null || intent.uploadToken !== args.uploadToken) {
      return { status: "not_found" as const };
    }

    return await claimProfileAssetUploadIntentForStorage(ctx, intent, args.processingToken);
  },
});

export const claimMcpImportIntentForStorage = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);

    if (
      intent === null ||
      intent.mcpOwnerUserId === undefined ||
      intent.mcpOauthClientId === undefined ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.sourceUrl === undefined
    ) {
      return { status: "not_found" as const };
    }

    return await claimProfileAssetUploadIntentForStorage(ctx, intent, args.processingToken);
  },
});

export const claimOwnedAccessibilityGeneration = mutation({
  args: {
    profileId,
    requestId: v.string(),
    provider: v.literal("openai"),
    model: v.string(),
    imageBytes: v.number(),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    assertProfileMediaAccessibilityGenerationEnabled();
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const { user } = await requireUser(ctx);
    const requestId = args.requestId.trim();
    const provider = args.provider.trim();
    const model = args.model.trim();
    if (
      !PROFILE_ASSET_ACCESSIBILITY_REQUEST_ID.test(requestId) ||
      provider !== "openai" ||
      !PROFILE_ASSET_ACCESSIBILITY_MODEL.test(model)
    ) {
      throw new Error("Accessibility generation request metadata is invalid.");
    }
    if (!Number.isSafeInteger(args.imageBytes) || args.imageBytes <= 0 || args.imageBytes > 1_500_000) {
      throw new Error("Accessibility generation image is too large.");
    }

    const replay = await ctx.db
      .query("profileAssetAccessibilityGenerationEvents")
      .withIndex("by_requestId", (query) => query.eq("requestId", requestId))
      .unique();
    if (
      replay !== null &&
      replay.userId === user._id &&
      replay.profileId === profile._id
    ) {
      return { eventId: replay._id, replay: true, userId: user._id };
    }
    if (replay !== null) {
      throw new Error("Accessibility generation request is invalid.");
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("profileAssetAccessibilityGenerationEvents")
      .withIndex("by_userId_createdAt", (query) =>
        query.eq("userId", user._id).gt("createdAt", now - 24 * 60 * 60 * 1_000),
      )
      .collect();
    if (recent.length >= PROFILE_ASSET_ACCESSIBILITY_GENERATION_DAILY_LIMIT) {
      throw new Error("Accessibility generation limit reached. Try again tomorrow.");
    }
    const latest = recent.reduce(
      (value, event) => Math.max(value, event.createdAt),
      0,
    );
    if (latest > now - PROFILE_ASSET_ACCESSIBILITY_GENERATION_COOLDOWN_MS) {
      throw new Error("Wait a moment before generating again.");
    }

    const eventId = await ctx.db.insert("profileAssetAccessibilityGenerationEvents", {
      requestId,
      userId: user._id,
      profileId: profile._id,
      provider,
      model,
      result: "started",
      imageBytes: args.imageBytes,
      createdAt: now,
    });
    return { eventId, replay: false, userId: user._id };
  },
});

export const finishAccessibilityGeneration = internalMutation({
  args: {
    eventId: v.id("profileAssetAccessibilityGenerationEvents"),
    requestId: v.string(),
    result: v.union(v.literal("succeeded"), v.literal("failed")),
    descriptionLength: v.optional(v.number()),
    latencyMs: v.number(),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (
      event === null ||
      event.requestId !== args.requestId ||
      event.result !== "started"
    ) {
      return false;
    }
    await ctx.db.patch(event._id, {
      result: args.result,
      ...(args.descriptionLength !== undefined
        ? { descriptionLength: Math.max(0, Math.round(args.descriptionLength)) }
        : {}),
      latencyMs: Math.max(0, Math.round(args.latencyMs)),
      ...(args.errorCode !== undefined ? { errorCode: args.errorCode.slice(0, 80) } : {}),
      completedAt: Date.now(),
    });
    return true;
  },
});

export const getUploadIntentForDirectStorage = internalQuery({
  args: {
    intentId: v.string(),
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intentId = ctx.db.normalizeId("profileAssetUploadIntents", args.intentId);
    if (intentId === null) {
      return null;
    }
    const intent = await ctx.db.get(intentId);
    const now = Date.now();
    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.state !== "pending" ||
      intent.expiresAt < now ||
      intent.sourceUrl !== undefined ||
      intent.quarantineStorageKey === undefined
    ) {
      return null;
    }
    return {
      storageKey: intent.quarantineStorageKey,
      mimeType: intent.mimeType,
      byteSize: intent.byteSize,
      expiresAt: intent.expiresAt,
    };
  },
});

export const getUploadIntentStateForStorageCleanup = internalQuery({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (intent === null || intent.uploadToken !== args.uploadToken) {
      return null;
    }
    if (intent.state === "consumed") {
      return { state: intent.state };
    }
    if (intent.processingToken !== args.processingToken) {
      return null;
    }
    return { state: intent.state };
  },
});

export const releaseUploadIntentStorageClaim = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.processingToken !== args.processingToken ||
      intent.state !== "pending"
    ) {
      return false;
    }
    await ctx.db.patch(intent._id, {
      processingToken: undefined,
      processingStartedAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const markUploadIntentUploaded = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
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
    const intent = await ctx.db.get(args.intentId);
    if (requestsGalleryPlacement(intent?.placements) || intent?.replacesAssetId !== undefined) {
      assertProfileMediaKitEnabled();
    }
    const now = Date.now();

    return await finalizeProfileAssetUploadIntentUpload(ctx.db, { ...args, now });
  },
});

export const hasDuplicateAssetForUpload = query({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    contentSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.targetProfileId === undefined ||
      intent.state !== "pending" ||
      intent.expiresAt < Date.now()
    ) {
      return false;
    }

    const assets = await ctx.db
      .query("profileAssets")
      .withIndex("by_profileId", (query) => query.eq("profileId", intent.targetProfileId!))
      .collect();
    return assets.some((asset) => asset.contentSha256 === args.contentSha256);
  },
});

export const hasDuplicateAssetForMcpImport = internalQuery({
  args: {
    intentId: profileAssetUploadIntentId,
    processingToken: v.string(),
    contentSha256: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.processingToken !== args.processingToken ||
      intent.targetProfileId === undefined ||
      intent.state !== "pending" ||
      intent.expiresAt < Date.now()
    ) {
      return false;
    }

    const assets = await ctx.db
      .query("profileAssets")
      .withIndex("by_profileId", (query) => query.eq("profileId", intent.targetProfileId!))
      .collect();
    return assets.some((asset) => asset.contentSha256 === args.contentSha256);
  },
});

export const markMcpImportIntentUploaded = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
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
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.processingToken !== args.processingToken
    ) {
      throw new ConvexError("Profile media upload intent was not found.");
    }
    assertProfileMediaKitEnabled();

    try {
      return await finalizeProfileAssetUploadIntentUpload(ctx.db, {
        ...args,
        uploadToken: intent.uploadToken,
        now: Date.now(),
      });
    } catch (error) {
      if (error instanceof ConvexError) {
        const data = error.data;
        if (
          typeof data === "object" &&
          data !== null &&
          "code" in data &&
          typeof data.code === "string"
        ) {
          throw error;
        }
      }
      throw new ConvexError({
        code: "MCP_MEDIA_INVALID",
        message: "Profile media import was rejected during finalization.",
      });
    }
  },
});

export const releaseMcpImportIntentStorageClaim = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (
      intent === null ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.processingToken !== args.processingToken ||
      intent.state !== "pending"
    ) {
      return false;
    }
    await ctx.db.patch(intent._id, {
      processingToken: undefined,
      processingStartedAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const getMcpImportIntentStateForStorageCleanup = internalQuery({
  args: {
    intentId: profileAssetUploadIntentId,
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (intent === null || intent.mcpIdempotencyKeyHash === undefined) {
      return null;
    }
    if (intent.state === "consumed") {
      return { state: intent.state };
    }
    if (intent.processingToken !== args.processingToken) {
      return null;
    }
    return { state: intent.state };
  },
});

async function buildOwnedMediaInventory(
  db: DatabaseReader,
  profile: Doc<"profiles">,
) {
  const [assets, activePlacementRecords, mediaVersion] = await Promise.all([
    db
      .query("profileAssets")
      .withIndex("by_profileId", (query) => query.eq("profileId", profile._id))
      .collect(),
    db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_state", (query) =>
        query.eq("profileId", profile._id).eq("state", "active"),
      )
      .collect(),
    getProfileMediaVersion(db, profile._id),
  ]);
  const activePlacements = activePlacementRecords.sort(
    (first, second) =>
      first.placement.localeCompare(second.placement) ||
      first.position - second.position ||
      String(first.assetId).localeCompare(String(second.assetId)),
  );
  const placementsByAssetId = new Map<Id<"profileAssets">, typeof activePlacements>();

  for (const placement of activePlacements) {
    const current = placementsByAssetId.get(placement.assetId) ?? [];
    current.push(placement);
    placementsByAssetId.set(placement.assetId, current);
  }

  return {
    profileId: profile._id,
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    mediaVersion,
    activePublicAssetCount: assets.filter(
      (asset) => asset.state === "active" && asset.visibility === "public",
    ).length,
    assets: assets
      .filter(
        (asset) =>
          asset.visibility === "public" &&
          asset.retiredAt === undefined &&
          asset.moderatorSuppressedAt === undefined,
      )
      .sort((first, second) => {
        if (first.state !== second.state) {
          return first.state === "active" ? -1 : 1;
        }

        const firstGallery = placementsByAssetId
          .get(first._id)
          ?.find((placement) => placement.placement === "gallery")?.position;
        const secondGallery = placementsByAssetId
          .get(second._id)
          ?.find((placement) => placement.placement === "gallery")?.position;
        return (
          (firstGallery ?? Number.MAX_SAFE_INTEGER) -
            (secondGallery ?? Number.MAX_SAFE_INTEGER) ||
          String(first._id).localeCompare(String(second._id))
        );
      })
      .map((asset) => ({
        assetId: asset._id,
        state: asset.state,
        source: asset.source,
        ...(asset.label === undefined ? {} : { label: asset.label }),
        ...(asset.caption === undefined ? {} : { caption: asset.caption }),
        ...(asset.altText === undefined ? {} : { altText: asset.altText }),
        ...(asset.credit === undefined ? {} : { credit: asset.credit }),
        ...(asset.creditUrl === undefined ? {} : { creditUrl: asset.creditUrl }),
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        ...(asset.downloadMimeType === undefined
          ? {}
          : { downloadMimeType: asset.downloadMimeType }),
        ...(asset.downloadByteSize === undefined
          ? {}
          : { downloadByteSize: asset.downloadByteSize }),
        sourcePreserved: asset.sourceStorageKey !== undefined,
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        placements: (placementsByAssetId.get(asset._id) ?? []).map((placement) => ({
          placement: placement.placement,
          position: placement.position,
        })),
      })),
  };
}

export const getOwnedMediaForMcpActor = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const validation = validateProfileSlug(args.slug);

    if (!validation.ok) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (
      profile === null ||
      profile.claimState === "unclaimed" ||
      !(await userOwnsProfile(ctx.db, profile._id, args.ownerUserId))
    ) {
      return null;
    }

    return await buildOwnedMediaInventory(ctx.db, profile);
  },
});

export const listOwnedMediaKitProfiles = query({
  args: {},
  handler: async (ctx) => {
    assertProfileMediaKitEnabled();
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return null;
    }
    const { user } = activeSession;

    const owners = await ctx.db
      .query("profileOwners")
      .withIndex("by_userId_state", (query) => query.eq("userId", user._id).eq("state", "active"))
      .collect();
    const results = [];

    for (const owner of owners) {
      const profile = await ctx.db.get(owner.profileId);
      if (profile === null || profile.claimState === "unclaimed") {
        continue;
      }

      const [assets, activePlacementRecords] = await Promise.all([
        ctx.db.query("profileAssets").withIndex("by_profileId", (query) => query.eq("profileId", profile._id)).collect(),
        ctx.db
          .query("profileAssetPlacements")
          .withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id).eq("state", "active"))
          .collect(),
      ]);
      const activePlacements = activePlacementRecords.sort((first, second) => first.position - second.position);
      const featuredAssetId = activePlacements.find((placement) => placement.placement === "featured")?.assetId;
      const profileImageAssetId = activePlacements.find((placement) => placement.placement === "profile_image")?.assetId;
      const primaryLogoAssetId = activePlacements.find((placement) => placement.placement === "primary_logo")?.assetId;
      const galleryPosition = new Map(
        activePlacements
          .filter((placement) => placement.placement === "gallery")
          .map((placement, index) => [placement.assetId, index]),
      );
      results.push({
        profileId: profile._id,
        profileType: profile.profileType,
        slug: profile.slug,
        displayName: profile.displayName,
        activePublicAssetCount: assets.filter(
          (asset) => asset.state === "active" && asset.visibility === "public",
        ).length,
        assets: assets
          .filter((asset) =>
            asset.visibility === "public" &&
            asset.retiredAt === undefined &&
            asset.moderatorSuppressedAt === undefined,
          )
          .sort((first, second) => {
            if (first.state !== second.state) {
              return first.state === "active" ? -1 : 1;
            }
            return (galleryPosition.get(first._id) ?? Number.MAX_SAFE_INTEGER) -
              (galleryPosition.get(second._id) ?? Number.MAX_SAFE_INTEGER);
          })
          .map((asset) => ({
            assetId: asset._id,
            state: asset.state,
            source: asset.source,
            label: asset.label,
            caption: asset.caption,
            altText: asset.altText,
            credit: asset.credit,
            creditUrl: asset.creditUrl,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            downloadMimeType: asset.downloadMimeType,
            downloadByteSize: asset.downloadByteSize,
            sourcePreserved: asset.sourceStorageKey !== undefined,
            width: asset.width,
            height: asset.height,
            gallery: galleryPosition.has(asset._id),
            featured: asset._id === featuredAssetId,
            profileImage: asset._id === profileImageAssetId,
            primaryLogo: asset._id === primaryLogoAssetId,
            imageUrl: `/api/account/media-kit/${encodeURIComponent(profile._id)}/assets/${encodeURIComponent(asset._id)}/file`,
            downloadUrl: `/api/account/media-kit/${encodeURIComponent(profile._id)}/assets/${encodeURIComponent(asset._id)}/file?download=1`,
          })),
      });
    }

    return results.sort((first, second) => first.displayName.localeCompare(second.displayName));
  },
});

async function requireOwnedAsset(ctx: MutationCtx, requestedProfileId: Id<"profiles">, requestedAssetId: Id<"profileAssets">) {
  const profile = await requireOwnedAppearanceProfile(ctx, requestedProfileId);
  const asset = await ctx.db.get(requestedAssetId);

  if (asset === null || asset.profileId !== profile._id) {
    throw new Error("Profile media item was not found.");
  }

  return { profile, asset };
}

function hasOwn(object: object, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function replaceOwnedPlacementOrder(
  db: DatabaseWriter,
  profileId: Id<"profiles">,
  placement: "gallery" | "additional_logo",
  assetIds: Id<"profileAssets">[],
  now: number,
) {
  const uniqueIds = [...new Set(assetIds)];

  if (uniqueIds.length !== assetIds.length || uniqueIds.length > PROFILE_ASSET_MAX_ACTIVE_COUNT) {
    rejectMcpMediaMutation("Profile media order is invalid.");
  }

  const requestedAssets = await Promise.all(uniqueIds.map((assetId) => db.get(assetId)));

  if (
    requestedAssets.some(
      (asset) =>
        asset === null ||
        asset.profileId !== profileId ||
        asset.state !== "active" ||
        asset.retiredAt !== undefined ||
        asset.moderatorSuppressedAt !== undefined,
    )
  ) {
    rejectMcpMediaMutation("Profile media order includes an unavailable item.");
  }

  if (
    placement === "gallery" &&
    requestedAssets.some(
      (asset) => asset === null || sanitizeProfileAssetLabel(asset.label) === undefined,
    )
  ) {
    rejectMcpMediaMutation("Gallery images require a title.");
  }

  const existing = await db
    .query("profileAssetPlacements")
    .withIndex("by_profileId_placement_state_position", (query) =>
      query.eq("profileId", profileId).eq("placement", placement).eq("state", "active"),
    )
    .collect();
  const existingAssets = await Promise.all(existing.map((item) => db.get(item.assetId)));
  const activeExistingIds = new Set(
    existing
      .filter((_, index) => existingAssets[index]?.state === "active")
      .map((item) => item.assetId),
  );

  if (
    activeExistingIds.size !== uniqueIds.length ||
    uniqueIds.some((assetId) => !activeExistingIds.has(assetId))
  ) {
    throw new ConvexError({ code: "MCP_MEDIA_VERSION_CONFLICT" });
  }

  await Promise.all(
    existing.map((item) => db.patch(item._id, { state: "deleted", updatedAt: now })),
  );
  await Promise.all(
    uniqueIds.map((assetId, position) =>
      db.insert("profileAssetPlacements", {
        profileId,
        assetId,
        placement,
        position,
        state: "active",
        updatedAt: now,
      }),
    ),
  );
}

async function replaceOwnedAssetPlacements(
  db: DatabaseWriter,
  profileId: Id<"profiles">,
  asset: Doc<"profileAssets">,
  placements: ProfileAssetPlacement[],
  now: number,
) {
  const uniquePlacements = [...new Set(placements)];

  if (uniquePlacements.length !== placements.length) {
    rejectMcpMediaMutation("Profile media placements must be unique.");
  }
  if (uniquePlacements.includes("featured") && !uniquePlacements.includes("gallery")) {
    rejectMcpMediaMutation("Featured media must also be a gallery item.");
  }
  if (
    uniquePlacements.includes("gallery") &&
    sanitizeProfileAssetLabel(asset.label) === undefined
  ) {
    rejectMcpMediaMutation("Gallery images require a title.");
  }

  const current = await db
    .query("profileAssetPlacements")
    .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
    .filter((query) => query.eq(query.field("state"), "active"))
    .collect();
  const desired = new Set(uniquePlacements);

  await Promise.all(
    current
      .filter((item) => !desired.has(item.placement))
      .map((item) => db.patch(item._id, { state: "deleted", updatedAt: now })),
  );

  for (const placement of uniquePlacements) {
    if (current.some((item) => item.placement === placement)) {
      continue;
    }

    const ordered = placement === "gallery" || placement === "additional_logo";

    if (!ordered) {
      const replaced = await db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", profileId).eq("placement", placement).eq("state", "active"),
        )
        .collect();
      await Promise.all(
        replaced.map((item) => db.patch(item._id, { state: "deleted", updatedAt: now })),
      );
      for (const replacedAssetId of new Set(replaced.map((item) => item.assetId))) {
        const remainingPlacement = await db
          .query("profileAssetPlacements")
          .withIndex("by_assetId", (query) => query.eq("assetId", replacedAssetId))
          .filter((query) => query.eq(query.field("state"), "active"))
          .first();
        if (remainingPlacement === null) {
          const displacedAsset = await db.get(replacedAssetId);
          if (displacedAsset !== null && displacedAsset.retiredAt === undefined) {
            await db.patch(replacedAssetId, {
              state: "deleted",
              deletedAt: displacedAsset.deletedAt ?? now,
              retiredAt: now,
              updatedAt: now,
            });
          }
        }
      }
    }

    let position = 0;
    if (ordered) {
      const existing = await db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", profileId).eq("placement", placement).eq("state", "active"),
        )
        .collect();
      position = existing.reduce((next, item) => Math.max(next, item.position + 1), 0);
    }

    await db.insert("profileAssetPlacements", {
      profileId,
      assetId: asset._id,
      placement,
      position,
      state: "active",
      updatedAt: now,
    });
  }
}

export const manageOwnedMediaForMcpActor = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    requestId: v.string(),
    slug: v.string(),
    expectedMediaVersion: v.string(),
    asset: v.optional(v.object({
      assetId: v.id("profileAssets"),
      metadata: v.optional(mcpProfileAssetMetadataPatch),
      placements: v.optional(v.array(profileAssetPlacement)),
      state: v.optional(v.union(v.literal("active"), v.literal("deleted"))),
    })),
    galleryOrder: v.optional(v.array(v.id("profileAssets"))),
    additionalLogoOrder: v.optional(v.array(v.id("profileAssets"))),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const profile = await requireMcpOwnedClaimedProfileBySlug(ctx, args.slug, args.ownerUserId);
    await assertProfileMediaVersion(ctx.db, profile._id, args.expectedMediaVersion);

    if (
      args.asset === undefined &&
      args.galleryOrder === undefined &&
      args.additionalLogoOrder === undefined
    ) {
      rejectMcpMediaMutation("Profile media updates must include at least one change.");
    }

    const now = Date.now();
    if (args.asset !== undefined) {
      const asset = await ctx.db.get(args.asset.assetId);

      if (
        asset === null ||
        asset.profileId !== profile._id ||
        asset.visibility !== "public" ||
        asset.retiredAt !== undefined ||
        asset.moderatorSuppressedAt !== undefined
      ) {
        rejectMcpMediaMutation("Profile media item was not found.");
      }
      if (args.asset.state === "deleted" && args.asset.placements !== undefined) {
        rejectMcpMediaMutation("Delete media and change placements in separate updates.");
      }

      const metadata = args.asset.metadata;
      if (metadata !== undefined) {
        const patch: Partial<Pick<
          Doc<"profileAssets">,
          "label" | "caption" | "altText" | "credit" | "creditUrl"
        >> & { updatedAt: number } = { updatedAt: now };

        if (hasOwn(metadata, "label")) {
          patch.label = sanitizeProfileAssetLabel(metadata.label ?? undefined);
        }
        if (hasOwn(metadata, "caption")) {
          patch.caption = sanitizeProfileAssetCaption(metadata.caption ?? undefined);
        }
        if (hasOwn(metadata, "altText")) {
          patch.altText = sanitizeProfileAssetAltText(metadata.altText ?? undefined);
        }
        if (hasOwn(metadata, "credit")) {
          patch.credit = sanitizeProfileAssetCredit(metadata.credit ?? undefined);
        }
        if (hasOwn(metadata, "creditUrl")) {
          patch.creditUrl = sanitizeProfileAssetCreditUrl(metadata.creditUrl ?? undefined);
        }
        await ctx.db.patch(asset._id, patch);
      }

      let currentAsset = (await ctx.db.get(asset._id))!;
      if (args.asset.state !== undefined && args.asset.state !== currentAsset.state) {
        if (args.asset.state === "active") {
          await assertMcpProfileAssetIntentCapacity(ctx.db, profile._id, now);
          const placements = await ctx.db
            .query("profileAssetPlacements")
            .withIndex("by_assetId", (query) => query.eq("assetId", currentAsset._id))
            .collect();
          const wasGalleryAsset = placements.some(
            (placement) => placement.placement === "gallery",
          );
          if (
            wasGalleryAsset &&
            sanitizeProfileAssetLabel(currentAsset.label) === undefined
          ) {
            rejectMcpMediaMutation("Gallery images require a title.");
          }
          await ctx.db.patch(currentAsset._id, {
            state: "active",
            deletedAt: undefined,
            updatedAt: now,
          });
          const hasActiveGalleryPlacement = placements.some(
            (placement) =>
              placement.placement === "gallery" && placement.state === "active",
          );
          if (wasGalleryAsset && !hasActiveGalleryPlacement) {
            const activeGallery = await ctx.db
              .query("profileAssetPlacements")
              .withIndex("by_profileId_placement_state_position", (query) =>
                query
                  .eq("profileId", profile._id)
                  .eq("placement", "gallery")
                  .eq("state", "active"),
              )
              .collect();
            const nextPosition = activeGallery.reduce(
              (position, placement) => Math.max(position, placement.position + 1),
              0,
            );
            await ctx.db.insert("profileAssetPlacements", {
              profileId: profile._id,
              assetId: currentAsset._id,
              placement: "gallery",
              position: nextPosition,
              state: "active",
              updatedAt: now,
            });
          }
        } else {
          await ctx.db.patch(currentAsset._id, {
            state: "deleted",
            deletedAt: now,
            updatedAt: now,
          });
        }
        currentAsset = (await ctx.db.get(currentAsset._id))!;
      }

      if (args.asset.placements !== undefined) {
        if (currentAsset.state !== "active") {
          rejectMcpMediaMutation("Only active profile media can receive placements.");
        }
        await replaceOwnedAssetPlacements(
          ctx.db,
          profile._id,
          currentAsset,
          args.asset.placements,
          now,
        );
      }

      const finalPlacements = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", currentAsset._id))
        .filter((query) => query.eq(query.field("state"), "active"))
        .collect();
      if (
        currentAsset.state === "active" &&
        finalPlacements.some((placement) => placement.placement === "gallery") &&
        sanitizeProfileAssetLabel(currentAsset.label) === undefined
      ) {
        rejectMcpMediaMutation("Gallery images require a title.");
      }
    }

    if (args.galleryOrder !== undefined) {
      await replaceOwnedPlacementOrder(
        ctx.db,
        profile._id,
        "gallery",
        args.galleryOrder,
        now,
      );
    }
    if (args.additionalLogoOrder !== undefined) {
      await replaceOwnedPlacementOrder(
        ctx.db,
        profile._id,
        "additional_logo",
        args.additionalLogoOrder,
        now,
      );
    }

    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_asset_managed",
      actor: apiOwnerAuthSubject(args.ownerUserId),
      sourceType: "owner",
      note: "Owner managed profile media through hosted MCP.",
      createdAt: now,
    });
    await recordApiWriteAuditEvent(ctx.db, {
      action: "profile_asset_managed",
      actorKind: "user_delegated_oauth",
      ownerUserId: args.ownerUserId,
      oauthClientId: args.oauthClientId,
      oauthTokenId: args.oauthTokenId,
      requestId: args.requestId,
      mcpToolName: "vrdex_profile_media_manage",
      resourceType: "profile_asset",
      routeClass: "authenticated_mcp_write",
      targetProfileId: profile._id,
      ...(args.asset === undefined ? {} : { assetIds: [args.asset.assetId] }),
      now,
    });

    return await buildOwnedMediaInventory(ctx.db, profile);
  },
});

export const updateOwnedAssetMetadata = mutation({
  args: {
    profileId,
    assetId: v.id("profileAssets"),
    label: v.optional(v.string()),
    caption: v.optional(v.string()),
    altText: v.optional(v.string()),
    credit: v.optional(v.string()),
    creditUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const { profile, asset } = await requireOwnedAsset(ctx, args.profileId, args.assetId);
    const { user } = await requireUser(ctx);
    const now = Date.now();
    const label = sanitizeProfileAssetLabel(args.label);
    const altText = sanitizeProfileAssetAltText(args.altText);
    const placements = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
      .collect();
    if (
      asset.state === "active" &&
      placements.some((placement) => placement.state === "active" && placement.placement === "gallery") &&
      label === undefined
    ) {
      throw new Error("Gallery images require a title.");
    }
    await ctx.db.patch(asset._id, {
      label,
      caption: sanitizeProfileAssetCaption(args.caption),
      altText,
      credit: sanitizeProfileAssetCredit(args.credit),
      creditUrl: sanitizeProfileAssetCreditUrl(args.creditUrl),
      updatedAt: now,
    });
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_asset_metadata_updated",
      actor: apiOwnerAuthSubject(user._id),
      sourceType: "owner",
      note: "Owner updated profile media metadata.",
      createdAt: now,
    });
    return { ok: true };
  },
});

export const reorderOwnedGallery = mutation({
  args: {
    profileId,
    assetIds: v.array(v.id("profileAssets")),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const { user } = await requireUser(ctx);
    const uniqueIds = [...new Set(args.assetIds)];
    if (uniqueIds.length !== args.assetIds.length || uniqueIds.length > PROFILE_ASSET_MAX_ACTIVE_COUNT) {
      throw new Error("Gallery order is invalid.");
    }

    const assets = await Promise.all(uniqueIds.map((assetId) => ctx.db.get(assetId)));
    if (assets.some((asset) => asset === null || asset.profileId !== profile._id || asset.state !== "active")) {
      throw new Error("Gallery order includes unavailable media.");
    }
    if (
      assets.some(
        (asset) =>
          asset === null ||
          sanitizeProfileAssetLabel(asset.label) === undefined,
      )
    ) {
      throw new Error("Gallery images require a title.");
    }

    const existing = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (query) =>
        query.eq("profileId", profile._id).eq("placement", "gallery").eq("state", "active"),
      )
      .collect();
    const existingAssets = await Promise.all(existing.map((placement) => ctx.db.get(placement.assetId)));
    const existingAssetIds = new Set(
      existing
        .filter((_, index) => existingAssets[index]?.state === "active")
        .map((placement) => placement.assetId),
    );
    if (
      existingAssetIds.size !== uniqueIds.length ||
      uniqueIds.some((assetId) => !existingAssetIds.has(assetId))
    ) {
      throw new Error("Gallery changed. Reload and try again.");
    }
    const now = Date.now();
    await Promise.all(existing.map((placement) => ctx.db.patch(placement._id, { state: "deleted", updatedAt: now })));
    await Promise.all(uniqueIds.map((assetId, position) =>
      ctx.db.insert("profileAssetPlacements", {
        profileId: profile._id,
        assetId,
        placement: "gallery",
        position,
        state: "active",
        updatedAt: now,
      }),
    ));
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_asset_gallery_reordered",
      actor: apiOwnerAuthSubject(user._id),
      sourceType: "owner",
      note: "Owner reordered the public media gallery.",
      createdAt: now,
    });
    return { ok: true };
  },
});

export const setOwnedFeaturedAsset = mutation({
  args: {
    profileId,
    assetId: v.union(v.id("profileAssets"), v.null()),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const { user } = await requireUser(ctx);
    if (args.assetId !== null) {
      const asset = await ctx.db.get(args.assetId);
      if (asset === null || asset.profileId !== profile._id || asset.state !== "active") {
        throw new Error("Featured media must be an active item from this profile.");
      }
      const placements = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
        .collect();
      if (
        !placements.some((placement) => placement.state === "active" && placement.placement === "gallery") ||
        sanitizeProfileAssetLabel(asset.label) === undefined
      ) {
        throw new Error("Featured media must be a titled public gallery item.");
      }
    }

    const existing = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_placement_state_position", (query) =>
        query.eq("profileId", profile._id).eq("placement", "featured").eq("state", "active"),
      )
      .collect();
    const now = Date.now();
    await Promise.all(existing.map((placement) => ctx.db.patch(placement._id, { state: "deleted", updatedAt: now })));
    if (args.assetId !== null) {
      await ctx.db.insert("profileAssetPlacements", {
        profileId: profile._id,
        assetId: args.assetId,
        placement: "featured",
        position: 0,
        state: "active",
        updatedAt: now,
      });
    }
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: "profile_asset_featured_updated",
      actor: apiOwnerAuthSubject(user._id),
      sourceType: "owner",
      note: args.assetId === null ? "Owner cleared featured profile media." : "Owner selected featured profile media.",
      createdAt: now,
    });
    return { ok: true };
  },
});

export const setOwnedAssetDeleted = mutation({
  args: {
    profileId,
    assetId: v.id("profileAssets"),
    deleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const { profile, asset } = await requireOwnedAsset(ctx, args.profileId, args.assetId);
    const { user } = await requireUser(ctx);
    const now = Date.now();
    const assetPlacements = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
      .collect();
    const wasGalleryAsset = assetPlacements.some((placement) => placement.placement === "gallery");
    if (!args.deleted && asset.state !== "active") {
      if (asset.retiredAt !== undefined) {
        throw new Error("Profile media item was not found.");
      }
      if (asset.moderatorSuppressedAt !== undefined) {
        throw new Error("Moderator-suppressed media cannot be restored by a profile owner.");
      }
      if (
        wasGalleryAsset &&
        sanitizeProfileAssetLabel(asset.label) === undefined
      ) {
        throw new Error("Gallery images require a title.");
      }
      await assertProfileAssetIntentCapacity(ctx.db, profile._id, now);
    }
    await ctx.db.patch(asset._id, {
      state: args.deleted ? "deleted" : "active",
      ...(args.deleted ? { deletedAt: now } : { deletedAt: undefined }),
      updatedAt: now,
    });
    if (!args.deleted) {
      const hasActiveGalleryPlacement = assetPlacements.some(
        (placement) => placement.placement === "gallery" && placement.state === "active",
      );
      if (wasGalleryAsset && !hasActiveGalleryPlacement) {
        const activeGallery = await ctx.db
          .query("profileAssetPlacements")
          .withIndex("by_profileId_placement_state_position", (query) =>
            query.eq("profileId", profile._id).eq("placement", "gallery").eq("state", "active"),
          )
          .collect();
        const nextPosition = activeGallery.reduce(
          (position, placement) => Math.max(position, placement.position + 1),
          0,
        );
        await ctx.db.insert("profileAssetPlacements", {
          profileId: profile._id,
          assetId: asset._id,
          placement: "gallery",
          position: nextPosition,
          state: "active",
          updatedAt: now,
        });
      }
    }
    await ctx.db.insert("profileAuditEvents", {
      profileId: profile._id,
      action: args.deleted ? "profile_asset_deleted" : "profile_asset_restored",
      actor: apiOwnerAuthSubject(user._id),
      sourceType: "owner",
      note: args.deleted ? "Owner removed public profile media." : "Owner restored public profile media.",
      createdAt: now,
    });
    return { ok: true };
  },
});

export const listOwnedAppearanceProfiles = query({
  args: {},
  handler: async (ctx) => {
    const activeSession = await activeBrowserSessionOrNull(ctx);

    if (activeSession === null) {
      return null;
    }
    const { user } = activeSession;

    const owners = await ctx.db
      .query("profileOwners")
      .withIndex("by_userId_state", (query) => query.eq("userId", user._id).eq("state", "active"))
      .collect();
    const profiles = await Promise.all(owners.map((owner) => ctx.db.get(owner.profileId)));
    const results = [];

    for (const profile of profiles) {
      if (profile === null) {
        continue;
      }

      const preference = await getProfileAssetDisplayPreference(ctx.db, profile._id);
      const mediaKit = await getPublicProfileMediaKit(ctx.db, profile, { preference });
      const appearance = toPublicProfileAppearance(preference);
      results.push({
        hasPublicProfile: canReadProfile("public", profile),
        profileId: profile._id,
        profileType: profile.profileType,
        slug: profile.slug,
        displayName: profile.displayName,
        headline: profile.headline,
        avatarImageUrl: profile.profileType === "community"
          ? mediaKit.primaryLogo?.imageUrl ?? mediaKit.profileImage?.imageUrl ?? profile.avatarImageUrl
          : mediaKit.profileImage?.imageUrl ?? profile.avatarImageUrl,
        compactDisplay: mediaKit.compactDisplay,
        avatarAppearance: mediaKit.avatarAppearance,
        sectionOrder: appearance.sectionOrder,
      });
    }

    return results.sort((first, second) => first.displayName.localeCompare(second.displayName));
  },
});

export const updateAppearance = mutation({
  args: {
    profileId,
    borderEnabled: v.boolean(),
    borderColor: v.string(),
    borderWidthPx: v.number(),
    borderSoftnessPx: v.number(),
    radiusPercent: v.number(),
    sectionOrder: v.array(profilePublicSection),
  },
  handler: async (ctx, args) => {
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const avatarAppearance = normalizeProfileAvatarAppearance(args);
    const sectionOrder = normalizeProfilePublicSectionOrder(args.sectionOrder);

    await patchProfileDisplayPreference(ctx, profile._id, {
      avatarAppearance,
      sectionOrder,
    });

    return {
      profileId: profile._id,
      avatarAppearance,
      sectionOrder,
    };
  },
});

export const updateAvatarAppearance = mutation({
  args: {
    profileId,
    borderEnabled: v.boolean(),
    borderColor: v.string(),
    borderWidthPx: v.number(),
    borderSoftnessPx: v.number(),
    radiusPercent: v.number(),
  },
  handler: async (ctx, args) => {
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const avatarAppearance = normalizeProfileAvatarAppearance(args);

    await patchProfileDisplayPreference(ctx, profile._id, { avatarAppearance });

    return {
      profileId: profile._id,
      avatarAppearance,
    };
  },
});

export const updatePublicSectionOrder = mutation({
  args: {
    profileId,
    sectionOrder: v.array(profilePublicSection),
  },
  handler: async (ctx, args) => {
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);
    const sectionOrder = normalizeProfilePublicSectionOrder(args.sectionOrder);

    await patchProfileDisplayPreference(ctx, profile._id, { sectionOrder });

    return {
      profileId: profile._id,
      sectionOrder,
    };
  },
});

export const listPublicBySlug = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.slug);

    if (!validation.ok) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null || !canReadProfile("public", profile)) {
      return null;
    }

    return {
      profileType: profile.profileType,
      slug: profile.slug,
      displayName: profile.displayName,
      mediaKit: await getPublicProfileMediaKit(ctx.db, profile),
    };
  },
});

export const getPublicAssetForStorage = query({
  args: {
    slug: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    const validation = validateProfileSlug(args.slug);
    const assetId = ctx.db.normalizeId("profileAssets", args.assetId);

    if (!validation.ok || assetId === null) {
      return null;
    }

    const profile = await getProfileBySlug(ctx.db, validation.slug);

    if (profile === null || !canReadProfile("public", profile)) {
      return null;
    }

    const asset = await ctx.db.get(assetId);

    if (
      asset === null ||
      asset.profileId !== profile._id ||
      asset.state !== "active" ||
      asset.visibility !== "public"
    ) {
      return null;
    }

    const placements = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
      .collect();
    const activePlacements = placements.filter((placement) => placement.state === "active");
    const visibleOnProfile =
      activePlacements.length === 0
        ? isProfileFieldVisible(profile, "mediaKit", "profile_page")
        : activePlacements.some((placement) => {
            if (placement.placement === "profile_image") {
              return isProfileFieldVisible(profile, "avatarImageUrl", "profile_page");
            }
            if (placement.placement === "banner") {
              return isProfileFieldVisible(profile, "bannerImageUrl", "profile_page");
            }
            return isProfileFieldVisible(profile, "mediaKit", "profile_page");
          });

    if (!visibleOnProfile) {
      return null;
    }

    return {
      profileType: profile.profileType,
      slug: profile.slug,
      displayName: profile.displayName,
      assetId: asset._id,
      label: asset.label,
      creditUrl: asset.creditUrl,
      storageKey: asset.storageKey,
      downloadStorageKey: asset.downloadStorageKey,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      downloadMimeType: asset.downloadMimeType,
      downloadByteSize: asset.downloadByteSize,
    };
  },
});

export const getOwnedAssetForStorage = query({
  args: {
    profileId: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const activeSession = await activeBrowserSessionOrNull(ctx);
    const profileId = ctx.db.normalizeId("profiles", args.profileId);
    const assetId = ctx.db.normalizeId("profileAssets", args.assetId);

    if (
      activeSession === null ||
      profileId === null ||
      assetId === null ||
      !(await userOwnsProfile(ctx.db, profileId, activeSession.userId))
    ) {
      return null;
    }

    const [profile, asset] = await Promise.all([
      ctx.db.get(profileId),
      ctx.db.get(assetId),
    ]);

    if (profile === null || asset === null || asset.profileId !== profile._id) {
      return null;
    }

    return {
      displayName: profile.displayName,
      label: asset.label,
      storageKey: asset.storageKey,
      downloadStorageKey: asset.downloadStorageKey,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      downloadMimeType: asset.downloadMimeType,
      downloadByteSize: asset.downloadByteSize,
    };
  },
});
