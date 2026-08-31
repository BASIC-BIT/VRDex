import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, mutation, type MutationCtx } from "./_generated/server";
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
  assertProfileAssetIntentCapacity,
  createProfileAssetUploadIntentRecord,
  finalizeProfileAssetUploadIntentUpload,
  getProfileAssetDisplayPreference,
  getPublicProfileMediaKit,
  normalizeProfileAvatarAppearance,
  publicProfileAssetImageUrl,
  sanitizeProfileAssetAltText,
  sanitizeProfileAssetCaption,
  sanitizeProfileAssetCredit,
  sanitizeProfileAssetCreditUrl,
  sanitizeProfileAssetLabel,
} from "./_profileAssets";
import {
  apiWriteAuditActorKindValidator,
  recordApiWriteAuditEvent,
} from "./_apiWriteAuditEvents";

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

export const claimUploadIntentForStorage = internalMutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    processingToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    const now = Date.now();

    if (intent === null || intent.uploadToken !== args.uploadToken) {
      return { status: "not_found" as const };
    }

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
      processingToken: args.processingToken,
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
