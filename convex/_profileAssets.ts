import type { GenericId } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";

export const PROFILE_ASSET_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
export const PROFILE_ASSET_UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;
export const PROFILE_ASSET_LABEL_MAX_LENGTH = 80;
export const PROFILE_ASSET_CAPTION_MAX_LENGTH = 240;

export const DEFAULT_PROFILE_AVATAR_APPEARANCE = {
  borderEnabled: true,
  borderColor: "#ffffff",
  borderWidthPx: 3,
  borderSoftnessPx: 0,
  radiusPercent: 18,
} as const;

export const PROFILE_ASSET_MIME_TYPES = [
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
] as const;

export type ProfileAssetMimeType = (typeof PROFILE_ASSET_MIME_TYPES)[number];
export type ProfileAssetPlacement = Doc<"profileAssetPlacements">["placement"];
export type PublicProfileAsset = {
  assetId: Id<"profileAssets">;
  label?: string;
  caption?: string;
  mimeType: string;
  byteSize: number;
  imageUrl: string;
  downloadUrl: string;
};

export type PublicProfileAvatarAppearance = {
  borderEnabled: boolean;
  borderColor: string;
  borderWidthPx: number;
  borderSoftnessPx: number;
  radiusPercent: number;
};

export type PublicProfileMediaKit = {
  profileImage?: PublicProfileAsset;
  banner?: PublicProfileAsset;
  primaryLogo?: PublicProfileAsset;
  additionalLogos: PublicProfileAsset[];
  logos: PublicProfileAsset[];
  assets: PublicProfileAsset[];
  logoZipUrl?: string;
  compactDisplay: "profile_image" | "logo";
  avatarAppearance: PublicProfileAvatarAppearance;
};

export type ProfileAssetDisplayPreference = Doc<"profileAssetDisplayPreferences">;

export type ProfileAssetUploadInput = {
  intentId: Id<"profileAssetUploadIntents">;
  uploadToken: string;
  label?: string;
  caption?: string;
  placements: ProfileAssetPlacement[];
  position?: number;
};

export type ProfileAssetAuthSubject = Doc<"profileAssetUploadIntents">["requestedBy"];

export type ProfileAssetUploadIntentCreateInput = {
  requestedBy: ProfileAssetAuthSubject;
  originalFileName?: string;
  sourceUrl?: string;
  mimeType: string;
  byteSize?: number;
  targetProfileId?: Id<"profiles">;
  label?: string;
  caption?: string;
  placements?: ProfileAssetPlacement[];
  position?: number;
  source?: Doc<"profileAssets">["source"];
  now: number;
};

function normalizeInlineText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized ? normalized : undefined;
}

export function normalizeProfileAssetFileName(value: string | undefined): string | undefined {
  const normalized = normalizeInlineText(value);

  return normalized ? normalized.slice(0, 180) : undefined;
}

export function sanitizeProfileAssetLabel(value: string | undefined): string | undefined {
  const label = normalizeInlineText(value);

  if (label === undefined) {
    return undefined;
  }

  if (label.length > PROFILE_ASSET_LABEL_MAX_LENGTH) {
    throw new Error(`Asset labels must be ${PROFILE_ASSET_LABEL_MAX_LENGTH} characters or fewer.`);
  }

  return label;
}

export function sanitizeProfileAssetCaption(value: string | undefined): string | undefined {
  const caption = normalizeInlineText(value);

  if (caption === undefined) {
    return undefined;
  }

  if (caption.length > PROFILE_ASSET_CAPTION_MAX_LENGTH) {
    throw new Error(`Asset captions must be ${PROFILE_ASSET_CAPTION_MAX_LENGTH} characters or fewer.`);
  }

  return caption;
}

function normalizeHexColor(value: string): string {
  const color = value.trim();

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error("Profile avatar border color must be a six-digit hex color.");
  }

  return color.toLowerCase();
}

export function normalizeProfileAvatarAppearance(input: {
  borderEnabled: boolean;
  borderColor: string;
  borderWidthPx?: number;
  borderSoftnessPx?: number;
  radiusPercent: number;
}): PublicProfileAvatarAppearance {
  if (!Number.isFinite(input.radiusPercent)) {
    throw new Error("Profile avatar roundedness must be a number.");
  }

  const borderWidthPx = input.borderWidthPx ?? DEFAULT_PROFILE_AVATAR_APPEARANCE.borderWidthPx;
  const borderSoftnessPx = input.borderSoftnessPx ?? DEFAULT_PROFILE_AVATAR_APPEARANCE.borderSoftnessPx;

  if (!Number.isFinite(borderWidthPx)) {
    throw new Error("Profile avatar border thickness must be a number.");
  }

  if (!Number.isFinite(borderSoftnessPx)) {
    throw new Error("Profile avatar border softness must be a number.");
  }

  return {
    borderEnabled: input.borderEnabled,
    borderColor: normalizeHexColor(input.borderColor),
    borderWidthPx: Math.min(10, Math.max(1, Math.round(borderWidthPx))),
    borderSoftnessPx: Math.min(24, Math.max(0, Math.round(borderSoftnessPx))),
    radiusPercent: Math.min(50, Math.max(0, Math.round(input.radiusPercent))),
  };
}

export function normalizeProfileAssetMimeType(value: string): ProfileAssetMimeType {
  const mimeType = value.trim().toLowerCase();

  if (!(PROFILE_ASSET_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Profile media assets must be PNG, SVG, JPEG, or WebP images.");
  }

  return mimeType as ProfileAssetMimeType;
}

export function validateProfileAssetByteSize(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Profile media assets must include a positive byte size.");
  }

  if (value > PROFILE_ASSET_UPLOAD_MAX_BYTES) {
    throw new Error("Profile media assets must be 12 MB or smaller.");
  }

  return value;
}

export function normalizeProfileAssetSourceUrl(value: string | undefined): string | undefined {
  const sourceUrl = normalizeInlineText(value);

  if (sourceUrl === undefined) {
    return undefined;
  }

  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:") {
      throw new Error("Profile media asset imports must use HTTPS URLs.");
    }

    if (url.username || url.password) {
      throw new Error("Profile media asset imports must not include URL credentials.");
    }

    return url.href;
  } catch (error) {
    if (error instanceof Error && (error.message.includes("HTTPS") || error.message.includes("credentials"))) {
      throw error;
    }

    throw new Error("Profile media asset imports must use valid HTTPS URLs.");
  }
}

export function createUploadToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeStorageName(value: string | undefined): string {
  const normalized = normalizeInlineText(value)?.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");

  return normalized?.replace(/^-+|-+$/g, "").slice(0, 80) || "asset";
}

export function createProfileAssetStorageKey(input: {
  token: string;
  originalFileName?: string;
  mimeType: string;
  now: number;
}): string {
  const extension = input.mimeType === "image/svg+xml" ? "svg" : input.mimeType.split("/")[1] ?? "bin";
  const name = safeStorageName(input.originalFileName).replace(/\.[a-z0-9]+$/i, "").replace(/-+$/g, "");

  return `profile-assets/${new Date(input.now).toISOString().slice(0, 10)}/${input.token.slice(0, 24)}/${name}.${extension}`;
}

export async function createProfileAssetUploadIntentRecord(
  db: DatabaseWriter,
  input: ProfileAssetUploadIntentCreateInput,
) {
  const originalFileName = normalizeProfileAssetFileName(input.originalFileName);
  const sourceUrl = normalizeProfileAssetSourceUrl(input.sourceUrl);

  if (originalFileName === undefined && sourceUrl === undefined) {
    throw new Error("Profile media uploads require a file name or HTTPS source URL.");
  }

  const mimeType = normalizeProfileAssetMimeType(input.mimeType);
  const byteSize = validateProfileAssetByteSize(input.byteSize ?? 1);
  const uploadToken = createUploadToken();
  const storageKey = createProfileAssetStorageKey({
    token: uploadToken,
    originalFileName,
    mimeType,
    now: input.now,
  });
  const label = sanitizeProfileAssetLabel(input.label);
  const caption = sanitizeProfileAssetCaption(input.caption);
  const expiresAt = input.now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS;
  const intentId = await db.insert("profileAssetUploadIntents", {
    uploadToken,
    requestedBy: input.requestedBy,
    ...(input.targetProfileId !== undefined ? { targetProfileId: input.targetProfileId } : {}),
    ...(originalFileName !== undefined ? { originalFileName } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    mimeType,
    byteSize,
    storageKey,
    ...(label !== undefined ? { label } : {}),
    ...(caption !== undefined ? { caption } : {}),
    ...(input.placements !== undefined ? { placements: input.placements } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    state: "pending",
    createdAt: input.now,
    expiresAt,
    updatedAt: input.now,
  });

  return {
    intentId,
    uploadToken,
    storageKey,
    expiresAt,
  };
}

export function publicProfileAssetImageUrl(slug: string, assetId: GenericId<"profileAssets">): string {
  return `/api/v0/profiles/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/file`;
}

export function publicProfileAssetDownloadUrl(slug: string, assetId: GenericId<"profileAssets">): string {
  return `/api/v0/profiles/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/file?download=1`;
}

export function publicProfileLogoZipUrl(slug: string): string {
  return `/api/v0/profiles/${encodeURIComponent(slug)}/logos.zip`;
}

export async function getProfileAssetDisplayPreference(
  db: DatabaseReader,
  profileId: Id<"profiles">,
): Promise<ProfileAssetDisplayPreference | null> {
  return await db
    .query("profileAssetDisplayPreferences")
    .withIndex("by_profileId", (query) => query.eq("profileId", profileId))
    .unique();
}

function toPublicAsset(profile: Doc<"profiles">, asset: Doc<"profileAssets">): PublicProfileAsset {
  return {
    assetId: asset._id,
    ...(asset.label !== undefined ? { label: asset.label } : {}),
    ...(asset.caption !== undefined ? { caption: asset.caption } : {}),
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    imageUrl: publicProfileAssetImageUrl(profile.slug, asset._id),
    downloadUrl: publicProfileAssetDownloadUrl(profile.slug, asset._id),
  };
}

function firstPlacedAsset(
  assetsById: Map<Id<"profileAssets">, Doc<"profileAssets">>,
  placements: Doc<"profileAssetPlacements">[],
  placement: ProfileAssetPlacement,
): Doc<"profileAssets"> | undefined {
  const record = placements.find((item) => item.placement === placement);

  return record ? assetsById.get(record.assetId) : undefined;
}

function placedAssets(
  assetsById: Map<Id<"profileAssets">, Doc<"profileAssets">>,
  placements: Doc<"profileAssetPlacements">[],
  placement: ProfileAssetPlacement,
): Doc<"profileAssets">[] {
  return placements
    .filter((item) => item.placement === placement)
    .map((item) => assetsById.get(item.assetId))
    .filter((asset): asset is Doc<"profileAssets"> => asset !== undefined);
}

export async function getPublicProfileMediaKit(
  db: DatabaseReader,
  profile: Doc<"profiles">,
  options: { preference?: ProfileAssetDisplayPreference | null } = {},
): Promise<PublicProfileMediaKit> {
  const preferencePromise =
    "preference" in options
      ? Promise.resolve(options.preference ?? null)
      : getProfileAssetDisplayPreference(db, profile._id);
  const [assets, placements, preference] = await Promise.all([
    db
      .query("profileAssets")
      .withIndex("by_profileId_state_visibility", (query) =>
        query.eq("profileId", profile._id).eq("state", "active").eq("visibility", "public"),
      )
      .collect(),
    db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_state", (query) => query.eq("profileId", profile._id).eq("state", "active"))
      .collect(),
    preferencePromise,
  ]);
  const assetsById = new Map(assets.map((asset) => [asset._id, asset]));
  const sortedPlacements = [...placements].sort((first, second) => first.position - second.position);
  const profileImageAsset = firstPlacedAsset(assetsById, sortedPlacements, "profile_image");
  const bannerAsset = firstPlacedAsset(assetsById, sortedPlacements, "banner");
  const primaryLogoAsset = firstPlacedAsset(assetsById, sortedPlacements, "primary_logo");
  const additionalLogoAssets = placedAssets(assetsById, sortedPlacements, "additional_logo").filter(
    (asset) => asset._id !== primaryLogoAsset?._id,
  );
  const profileImage = profileImageAsset ? toPublicAsset(profile, profileImageAsset) : undefined;
  const primaryLogo = primaryLogoAsset ? toPublicAsset(profile, primaryLogoAsset) : undefined;
  const additionalLogos = additionalLogoAssets.map((asset) => toPublicAsset(profile, asset));
  const logos = primaryLogo ? [primaryLogo, ...additionalLogos] : additionalLogos;
  const compactDisplay =
    preference?.compactDisplay === "logo" || (!profileImage && primaryLogo)
      ? "logo"
      : "profile_image";
  const avatarAppearance = preference?.avatarAppearance === undefined
    ? DEFAULT_PROFILE_AVATAR_APPEARANCE
    : normalizeProfileAvatarAppearance(preference.avatarAppearance);

  return {
    ...(profileImage ? { profileImage } : {}),
    ...(bannerAsset ? { banner: toPublicAsset(profile, bannerAsset) } : {}),
    ...(primaryLogo ? { primaryLogo } : {}),
    additionalLogos,
    logos,
    assets: assets.map((asset) => toPublicAsset(profile, asset)),
    ...(logos.length > 0 ? { logoZipUrl: publicProfileLogoZipUrl(profile.slug) } : {}),
    compactDisplay,
    avatarAppearance,
  };
}

function authSubjectsMatch(first: ProfileAssetAuthSubject, second: ProfileAssetAuthSubject): boolean {
  return first.tokenIdentifier === second.tokenIdentifier;
}

export async function consumeProfileAssetUploads(
  db: DatabaseWriter,
  input: {
    profileId: Id<"profiles">;
    requestedBy: ProfileAssetAuthSubject;
    uploads: ProfileAssetUploadInput[];
    source: Doc<"profileAssets">["source"];
    now: number;
  },
): Promise<Id<"profileAssets">[]> {
  const assetIds: Id<"profileAssets">[] = [];
  const seenPlacementKeys = new Set<string>();

  for (const [uploadIndex, upload] of input.uploads.entries()) {
    const intent = await db.get(upload.intentId);

    if (intent === null || intent.uploadToken !== upload.uploadToken) {
      throw new Error("Profile media upload intent was not found.");
    }

    if (!authSubjectsMatch(intent.requestedBy, input.requestedBy)) {
      throw new Error("Profile media upload intent belongs to another user.");
    }

    if (intent.state !== "uploaded" || intent.expiresAt < input.now) {
      throw new Error("Profile media upload intent is not ready to attach.");
    }

    const label = sanitizeProfileAssetLabel(upload.label);
    const caption = sanitizeProfileAssetCaption(upload.caption);
    const assetId = await db.insert("profileAssets", {
      profileId: input.profileId,
      storageKey: intent.storageKey,
      ...(intent.originalFileName !== undefined ? { originalFileName: intent.originalFileName } : {}),
      ...(intent.sourceUrl !== undefined ? { sourceUrl: intent.sourceUrl } : {}),
      mimeType: intent.mimeType,
      byteSize: intent.byteSize,
      ...(label !== undefined ? { label } : {}),
      ...(caption !== undefined ? { caption } : {}),
      visibility: "public",
      source: input.source,
      uploadedBy: input.requestedBy,
      uploadedAt: intent.uploadedAt ?? input.now,
      state: "active",
      updatedAt: input.now,
    });

    for (const placement of upload.placements) {
      const key = placement === "additional_logo" ? `${placement}:${assetId}` : placement;
      if (seenPlacementKeys.has(key)) {
        continue;
      }

      seenPlacementKeys.add(key);
      await db.insert("profileAssetPlacements", {
        profileId: input.profileId,
        assetId,
        placement,
        position: placement === "additional_logo" ? upload.position ?? uploadIndex : 0,
        state: "active",
        updatedAt: input.now,
      });
    }

    await db.patch(intent._id, {
      state: "consumed",
      consumedAt: input.now,
      updatedAt: input.now,
    });
    assetIds.push(assetId);
  }

  return assetIds;
}

export async function finalizeProfileAssetUploadIntentUpload(
  db: DatabaseWriter,
  input: {
    intentId: Id<"profileAssetUploadIntents">;
    uploadToken: string;
    mimeType: string;
    byteSize: number;
    now: number;
  },
) {
  const intent = await db.get(input.intentId);

  if (intent === null || intent.uploadToken !== input.uploadToken) {
    throw new Error("Profile media upload intent was not found.");
  }

  if (intent.state !== "pending" || intent.expiresAt < input.now) {
    throw new Error("Profile media upload intent is no longer pending.");
  }

  await db.patch(intent._id, {
    mimeType: normalizeProfileAssetMimeType(input.mimeType),
    byteSize: validateProfileAssetByteSize(input.byteSize),
    state: "uploaded",
    uploadedAt: input.now,
    updatedAt: input.now,
  });

  if (intent.targetProfileId === undefined) {
    return { ok: true as const, assetIds: [] as Id<"profileAssets">[] };
  }

  const assetIds = await consumeProfileAssetUploads(db, {
    profileId: intent.targetProfileId,
    requestedBy: intent.requestedBy,
    uploads: [
      {
        intentId: intent._id,
        uploadToken: input.uploadToken,
        ...(intent.label !== undefined ? { label: intent.label } : {}),
        ...(intent.caption !== undefined ? { caption: intent.caption } : {}),
        placements: intent.placements ?? [],
        ...(intent.position !== undefined ? { position: intent.position } : {}),
      },
    ],
    source: intent.source ?? "owner_authored",
    now: input.now,
  });

  if (assetIds.length > 0) {
    await db.insert("profileAuditEvents", {
      profileId: intent.targetProfileId,
      action: "api_profile_asset_uploaded",
      actor: intent.requestedBy,
      sourceType: "owner",
      note: "Public API profile asset upload intent consumed.",
      createdAt: input.now,
    });
  }

  return { ok: true as const, assetIds };
}
