import { v } from "convex/values";

import { getCurrentUser, requireCurrentUser } from "./accounts";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, mutation, type MutationCtx } from "./_generated/server";
import type { AuthSubject } from "./_communityAuthority";
import {
  normalizeProfilePublicSectionOrder,
  toPublicProfileAppearance,
} from "./_profileAppearance";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import {
  PROFILE_ASSET_MAX_ACTIVE_COUNT,
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
  placements: v.optional(v.array(profileAssetPlacement)),
  position: v.optional(v.number()),
};

function assertProfileMediaKitEnabled() {
  if (process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true") {
    throw new Error("Profile media kits are not enabled.");
  }
}

function requestsGalleryPlacement(placements: Array<"profile_image" | "banner" | "primary_logo" | "additional_logo" | "gallery" | "featured"> | undefined) {
  return placements?.some((placement) => placement === "gallery" || placement === "featured") ?? false;
}

function optionalIdentityDisplayName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 120);
}

async function requireOwnedAppearanceProfile(ctx: MutationCtx, requestedProfileId: Id<"profiles">) {
  const user = await requireCurrentUser(ctx);
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
  return profile.profileType === "person" ? `/p/${profile.slug}` : `/c/${profile.slug}`;
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
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new Error("Profile media uploads require a signed-in user.");
    }

    const now = Date.now();
    const displayName = optionalIdentityDisplayName(identity.name);
    const requestedBy = {
      tokenIdentifier: identity.tokenIdentifier,
      issuer: identity.issuer,
      subject: identity.subject,
      ...(displayName !== undefined ? { displayName } : {}),
    };

    return await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy,
      ...args,
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
      placements: args.placements,
      position: args.position,
      source: "owner_authored",
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
      uploadTokenHeader: "x-vrdex-upload-token",
      expiresAt: intent.expiresAt,
    };
  },
});

export const createUploadIntentForOwnedProfile = mutation({
  args: {
    profileId,
    ...profileAssetUploadIntentArgs,
    ...profileAssetAttachMetadataArgs,
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const profile = await requireOwnedAppearanceProfile(ctx, args.profileId);

    if (profile.claimState === "unclaimed") {
      throw new Error("Claim this profile before adding media.");
    }

    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    await assertProfileAssetIntentCapacity(ctx.db, profile._id, now);
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: apiOwnerAuthSubject(user._id),
      targetProfileId: profile._id,
      originalFileName: args.originalFileName,
      sourceUrl: args.sourceUrl,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      label: args.label,
      caption: args.caption,
      altText: args.altText,
      credit: args.credit,
      placements: args.placements ?? ["gallery"],
      position: args.position,
      source: "owner_authored",
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
    const user = await requireCurrentUser(ctx);
    const intent = await ctx.db.get(args.intentId);

    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.targetProfileId === undefined ||
      intent.state !== "pending" ||
      intent.processingToken !== undefined ||
      intent.requestedBy.issuer !== "vrdex:api" ||
      intent.requestedBy.subject !== String(user._id) ||
      !(await userOwnsProfile(ctx.db, intent.targetProfileId, user._id))
    ) {
      return false;
    }

    const now = Date.now();
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

    if (
      intent === null ||
      intent.uploadToken !== args.uploadToken ||
      intent.processingToken !== undefined
    ) {
      return null;
    }

    if (intent.state !== "pending" || intent.expiresAt < now) {
      return null;
    }

    await ctx.db.patch(intent._id, {
      processingToken: args.processingToken,
      processingStartedAt: now,
      updatedAt: now,
    });

    return {
      intentId: intent._id,
      originalFileName: intent.originalFileName,
      sourceUrl: intent.sourceUrl,
      mimeType: intent.mimeType,
      byteSize: intent.byteSize,
      storageKey: intent.storageKey,
      expiresAt: intent.expiresAt,
    };
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
    contentSha256: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (requestsGalleryPlacement(intent?.placements)) {
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
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

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
          .filter((asset) => asset.visibility === "public")
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
            label: asset.label,
            caption: asset.caption,
            altText: asset.altText,
            credit: asset.credit,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            gallery: galleryPosition.has(asset._id),
            featured: asset._id === featuredAssetId,
            imageUrl: `/api/account/media-kit/${encodeURIComponent(profile._id)}/assets/${encodeURIComponent(asset._id)}/file`,
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
  },
  handler: async (ctx, args) => {
    assertProfileMediaKitEnabled();
    const { profile, asset } = await requireOwnedAsset(ctx, args.profileId, args.assetId);
    const user = await requireCurrentUser(ctx);
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
      (label === undefined || altText === undefined)
    ) {
      throw new Error("Gallery images require a title and accessibility description.");
    }
    await ctx.db.patch(asset._id, {
      label,
      caption: sanitizeProfileAssetCaption(args.caption),
      altText,
      credit: sanitizeProfileAssetCredit(args.credit),
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
    const user = await requireCurrentUser(ctx);
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
          sanitizeProfileAssetLabel(asset.label) === undefined ||
          sanitizeProfileAssetAltText(asset.altText) === undefined,
      )
    ) {
      throw new Error("Gallery images require a title and accessibility description.");
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
    const user = await requireCurrentUser(ctx);
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
        sanitizeProfileAssetLabel(asset.label) === undefined ||
        sanitizeProfileAssetAltText(asset.altText) === undefined
      ) {
        throw new Error("Featured media must be an accessible public gallery item.");
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
    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    const assetPlacements = await ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_assetId", (query) => query.eq("assetId", asset._id))
      .collect();
    const wasGalleryAsset = assetPlacements.some((placement) => placement.placement === "gallery");
    if (!args.deleted && asset.state !== "active") {
      if (
        wasGalleryAsset &&
        (sanitizeProfileAssetLabel(asset.label) === undefined ||
          sanitizeProfileAssetAltText(asset.altText) === undefined)
      ) {
        throw new Error("Gallery images require a title and accessibility description.");
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
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

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
        avatarImageUrl: mediaKit.profileImage?.imageUrl ?? profile.avatarImageUrl,
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

    return {
      profileType: profile.profileType,
      slug: profile.slug,
      displayName: profile.displayName,
      assetId: asset._id,
      label: asset.label,
      storageKey: asset.storageKey,
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
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
    const user = await getCurrentUser(ctx);
    const profileId = ctx.db.normalizeId("profiles", args.profileId);
    const assetId = ctx.db.normalizeId("profileAssets", args.assetId);

    if (
      user === null ||
      profileId === null ||
      assetId === null ||
      !(await userOwnsProfile(ctx.db, profileId, user._id))
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
      originalFileName: asset.originalFileName,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
    };
  },
});
