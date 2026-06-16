import { v } from "convex/values";

import { getCurrentUser, requireCurrentUser } from "./accounts";
import { query, mutation } from "./_generated/server";
import { getProfileBySlug, validateProfileSlug } from "./_profileSlugs";
import { userOwnsProfile } from "./_profileOwnership";
import { canReadProfile } from "./_profilePermissions";
import {
  createProfileAssetStorageKey,
  createUploadToken,
  getPublicProfileMediaKit,
  normalizeProfileAvatarAppearance,
  normalizeProfileAssetMimeType,
  normalizeProfileAssetSourceUrl,
  PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
  validateProfileAssetByteSize,
} from "./_profileAssets";

const profileAssetUploadIntentId = v.id("profileAssetUploadIntents");
const profileAssetId = v.id("profileAssets");
const profileId = v.id("profiles");

function optionalIdentityDisplayName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, 120);
}

function normalizeOptionalFileName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized ? normalized.slice(0, 180) : undefined;
}

export const createUploadIntent = mutation({
  args: {
    originalFileName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    mimeType: v.string(),
    byteSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    if (identity === null) {
      throw new Error("Profile media uploads require a signed-in user.");
    }

    const originalFileName = normalizeOptionalFileName(args.originalFileName);
    const sourceUrl = normalizeProfileAssetSourceUrl(args.sourceUrl);

    if (originalFileName === undefined && sourceUrl === undefined) {
      throw new Error("Profile media uploads require a file name or HTTPS source URL.");
    }

    const mimeType = normalizeProfileAssetMimeType(args.mimeType);
    const byteSize = validateProfileAssetByteSize(args.byteSize ?? 1);
    const now = Date.now();
    const uploadToken = createUploadToken();
    const storageKey = createProfileAssetStorageKey({
      token: uploadToken,
      originalFileName: originalFileName ?? sourceUrl,
      mimeType,
      now,
    });
    const displayName = optionalIdentityDisplayName(identity.name);
    const requestedBy = {
      tokenIdentifier: identity.tokenIdentifier,
      issuer: identity.issuer,
      subject: identity.subject,
      ...(displayName !== undefined ? { displayName } : {}),
    };
    const intentId = await ctx.db.insert("profileAssetUploadIntents", {
      uploadToken,
      requestedBy,
      ...(originalFileName !== undefined ? { originalFileName } : {}),
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      mimeType,
      byteSize,
      storageKey,
      state: "pending",
      createdAt: now,
      expiresAt: now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
      updatedAt: now,
    });

    return {
      intentId,
      uploadToken,
      storageKey,
      expiresAt: now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS,
    };
  },
});

export const validateUploadIntentForStorage = query({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    const now = Date.now();

    if (intent === null || intent.uploadToken !== args.uploadToken) {
      return null;
    }

    if (intent.state !== "pending" || intent.expiresAt < now) {
      return null;
    }

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

export const markUploadIntentUploaded = mutation({
  args: {
    intentId: profileAssetUploadIntentId,
    uploadToken: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    const now = Date.now();

    if (intent === null || intent.uploadToken !== args.uploadToken) {
      throw new Error("Profile media upload intent was not found.");
    }

    if (intent.state !== "pending" || intent.expiresAt < now) {
      throw new Error("Profile media upload intent is no longer pending.");
    }

    await ctx.db.patch(intent._id, {
      mimeType: normalizeProfileAssetMimeType(args.mimeType),
      byteSize: validateProfileAssetByteSize(args.byteSize),
      state: "uploaded",
      uploadedAt: now,
      updatedAt: now,
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

      const mediaKit = await getPublicProfileMediaKit(ctx.db, profile);
      results.push({
        profileId: profile._id,
        profileType: profile.profileType,
        slug: profile.slug,
        displayName: profile.displayName,
        headline: profile.headline,
        avatarImageUrl: mediaKit.profileImage?.imageUrl ?? profile.avatarImageUrl,
        compactDisplay: mediaKit.compactDisplay,
        avatarAppearance: mediaKit.avatarAppearance,
      });
    }

    return results.sort((first, second) => first.displayName.localeCompare(second.displayName));
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
    const user = await requireCurrentUser(ctx);
    const profile = await ctx.db.get(args.profileId);

    if (profile === null) {
      throw new Error("Profile not found.");
    }

    if (!(await userOwnsProfile(ctx.db, profile._id, user._id))) {
      throw new Error("Only the profile owner can update profile appearance.");
    }

    const avatarAppearance = normalizeProfileAvatarAppearance(args);
    const existing = await ctx.db
      .query("profileAssetDisplayPreferences")
      .withIndex("by_profileId", (query) => query.eq("profileId", profile._id))
      .unique();
    const now = Date.now();

    if (existing === null) {
      await ctx.db.insert("profileAssetDisplayPreferences", {
        profileId: profile._id,
        compactDisplay: "auto",
        avatarAppearance,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(existing._id, {
        avatarAppearance,
        updatedAt: now,
      });
    }

    return {
      profileId: profile._id,
      avatarAppearance,
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
    assetId: profileAssetId,
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

    const asset = await ctx.db.get(args.assetId);

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
