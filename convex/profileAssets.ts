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
  createProfileAssetUploadIntentRecord,
  finalizeProfileAssetUploadIntentUpload,
  getProfileAssetDisplayPreference,
  getPublicProfileMediaKit,
  normalizeProfileAvatarAppearance,
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
  placements: v.optional(v.array(profileAssetPlacement)),
  position: v.optional(v.number()),
};

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

export const createUploadIntent = mutation({
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
    const profile = await requireApiOwnedClaimedProfileBySlug(ctx, args.slug, args.ownerUserId);
    const now = Date.now();
    const intent = await createProfileAssetUploadIntentRecord(ctx.db, {
      requestedBy: apiOwnerAuthSubject(args.ownerUserId),
      targetProfileId: profile._id,
      originalFileName: args.originalFileName,
      sourceUrl: args.sourceUrl,
      mimeType: args.mimeType,
      byteSize: args.byteSize,
      label: args.label,
      caption: args.caption,
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
    const now = Date.now();

    return await finalizeProfileAssetUploadIntentUpload(ctx.db, { ...args, now });
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
