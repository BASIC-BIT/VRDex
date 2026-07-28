import type { GenericId } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { recordApiWriteAuditEvent } from "./_apiWriteAuditEvents";
import { userOwnsProfile } from "./_profileOwnership";

export const PROFILE_ASSET_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
export const PROFILE_ASSET_UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;
export const PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS = 10 * 60 * 1000;
export const PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS = 3;
export const PROFILE_ASSET_LABEL_MAX_LENGTH = 80;
export const PROFILE_ASSET_CAPTION_MAX_LENGTH = 240;
export const PROFILE_ASSET_ALT_TEXT_MAX_LENGTH = 180;
export const PROFILE_ASSET_CREDIT_MAX_LENGTH = 120;
export const PROFILE_ASSET_CREDIT_URL_MAX_LENGTH = 2_048;
export const PROFILE_ASSET_MAX_ACTIVE_COUNT = 12;

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
  altText?: string;
  credit?: string;
  creditUrl?: string;
  mimeType: string;
  byteSize: number;
  downloadMimeType?: string;
  downloadByteSize?: number;
  sourcePreserved: boolean;
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
  featuredAsset?: PublicProfileAsset;
  primaryLogo?: PublicProfileAsset;
  additionalLogos: PublicProfileAsset[];
  logos: PublicProfileAsset[];
  assets: PublicProfileAsset[];
  galleryAssets: PublicProfileAsset[];
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
  altText?: string;
  credit?: string;
  creditUrl?: string;
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
  altText?: string;
  credit?: string;
  creditUrl?: string;
  placements?: ProfileAssetPlacement[];
  position?: number;
  source?: Doc<"profileAssets">["source"];
  now: number;
};

function validateProfileAssetGalleryPlacements(
  placements: ProfileAssetPlacement[] | undefined,
  label: string | undefined,
) {
  if (placements?.includes("featured") && !placements.includes("gallery")) {
    throw new Error("Featured media must also be a gallery item.");
  }
  if (
    placements?.some((placement) => placement === "gallery" || placement === "featured") &&
    label === undefined
  ) {
    throw new Error("Gallery images require a title.");
  }
}

function validateProfileAssetPosition(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Profile media position must be a nonnegative integer.");
  }
  return value;
}

export async function assertProfileAssetCapacity(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  additionalCount = 1,
) {
  const activeAssets = await db
    .query("profileAssets")
    .withIndex("by_profileId_state_visibility", (query) =>
      query.eq("profileId", profileId).eq("state", "active").eq("visibility", "public"),
    )
    .collect();

  if (activeAssets.length + additionalCount > PROFILE_ASSET_MAX_ACTIVE_COUNT) {
    throw new Error(`Profiles can have up to ${PROFILE_ASSET_MAX_ACTIVE_COUNT} active media items.`);
  }
}

export async function assertProfileAssetIntentCapacity(
  db: DatabaseReader,
  profileId: Id<"profiles">,
  now: number,
) {
  const openIntents = await db
    .query("profileAssetUploadIntents")
    .withIndex("by_targetProfileId_state_expiresAt", (query) =>
      query.eq("targetProfileId", profileId).eq("state", "pending").gt("expiresAt", now),
    )
    .collect();
  await assertProfileAssetCapacity(db, profileId, openIntents.length + 1);
}

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

export function sanitizeProfileAssetAltText(value: string | undefined): string | undefined {
  const altText = normalizeInlineText(value);

  if (altText === undefined) {
    return undefined;
  }

  if (altText.length > PROFILE_ASSET_ALT_TEXT_MAX_LENGTH) {
    throw new Error(`Accessibility descriptions must be ${PROFILE_ASSET_ALT_TEXT_MAX_LENGTH} characters or fewer.`);
  }

  return altText;
}

export function sanitizeProfileAssetCredit(value: string | undefined): string | undefined {
  const credit = normalizeInlineText(value);

  if (credit === undefined) {
    return undefined;
  }

  if (credit.length > PROFILE_ASSET_CREDIT_MAX_LENGTH) {
    throw new Error(`Asset credits must be ${PROFILE_ASSET_CREDIT_MAX_LENGTH} characters or fewer.`);
  }

  return credit;
}

export function sanitizeProfileAssetCreditUrl(value: string | undefined): string | undefined {
  const creditUrl = normalizeInlineText(value);

  if (creditUrl === undefined) {
    return undefined;
  }
  if (creditUrl.length > PROFILE_ASSET_CREDIT_URL_MAX_LENGTH) {
    throw new Error(`Credit links must be ${PROFILE_ASSET_CREDIT_URL_MAX_LENGTH} characters or fewer.`);
  }

  try {
    const url = new URL(creditUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("Credit links must use HTTP or HTTPS without embedded credentials.");
    }
    return url.href;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Credit links")) {
      throw error;
    }
    throw new Error("Credit links must be valid HTTP or HTTPS URLs.");
  }
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

  return `profile-assets/${new Date(input.now).toISOString().slice(0, 10)}/${input.token.slice(0, 24)}/${name}/display.${input.mimeType === "image/svg+xml" ? "svg" : "webp"}`;
}

export function createProfileAssetVariantStorageKeys(input: {
  token: string;
  originalFileName?: string;
  mimeType: string;
  now: number;
}) {
  const extension = input.mimeType === "image/svg+xml" ? "svg" : input.mimeType.split("/")[1] ?? "bin";
  const name = safeStorageName(input.originalFileName).replace(/\.[a-z0-9]+$/i, "").replace(/-+$/g, "");
  const date = new Date(input.now).toISOString().slice(0, 10);
  const prefix = `profile-assets/${date}/${input.token.slice(0, 24)}/${name}`;

  return {
    storageKey: `${prefix}/display.${input.mimeType === "image/svg+xml" ? "svg" : "webp"}`,
    quarantineStorageKey: `profile-assets/quarantine/${date}/${input.token.slice(0, 24)}/source.${extension}`,
    sourceStorageKey: `${prefix}/source.${extension}`,
    downloadStorageKey: `${prefix}/download.${extension}`,
  };
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
  const storageKeys = createProfileAssetVariantStorageKeys({
    token: uploadToken,
    originalFileName,
    mimeType,
    now: input.now,
  });
  const label = sanitizeProfileAssetLabel(input.label);
  const caption = sanitizeProfileAssetCaption(input.caption);
  const altText = sanitizeProfileAssetAltText(input.altText);
  const credit = sanitizeProfileAssetCredit(input.credit);
  const creditUrl = sanitizeProfileAssetCreditUrl(input.creditUrl);
  const position = validateProfileAssetPosition(input.position);
  validateProfileAssetGalleryPlacements(input.placements, label);
  const expiresAt = input.now + PROFILE_ASSET_UPLOAD_INTENT_TTL_MS;
  const intentId = await db.insert("profileAssetUploadIntents", {
    uploadToken,
    requestedBy: input.requestedBy,
    ...(input.targetProfileId !== undefined ? { targetProfileId: input.targetProfileId } : {}),
    ...(originalFileName !== undefined ? { originalFileName } : {}),
    ...(sourceUrl !== undefined ? { sourceUrl } : {}),
    mimeType,
    byteSize,
    ...storageKeys,
    ...(label !== undefined ? { label } : {}),
    ...(caption !== undefined ? { caption } : {}),
    ...(altText !== undefined ? { altText } : {}),
    ...(credit !== undefined ? { credit } : {}),
    ...(creditUrl !== undefined ? { creditUrl } : {}),
    ...(input.placements !== undefined ? { placements: input.placements } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    state: "pending",
    processingAttempts: 0,
    createdAt: input.now,
    expiresAt,
    updatedAt: input.now,
  });

  return {
    intentId,
    uploadToken,
    ...storageKeys,
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
    ...(asset.altText !== undefined ? { altText: asset.altText } : {}),
    ...(asset.credit !== undefined ? { credit: asset.credit } : {}),
    ...(asset.creditUrl !== undefined ? { creditUrl: asset.creditUrl } : {}),
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    ...(asset.downloadMimeType !== undefined ? { downloadMimeType: asset.downloadMimeType } : {}),
    ...(asset.downloadByteSize !== undefined ? { downloadByteSize: asset.downloadByteSize } : {}),
    sourcePreserved: asset.sourceStorageKey !== undefined,
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
  const galleryAssets = placedAssets(assetsById, sortedPlacements, "gallery").filter(
    (asset) => sanitizeProfileAssetLabel(asset.label) !== undefined,
  );
  const featuredCandidate = firstPlacedAsset(assetsById, sortedPlacements, "featured");
  const featuredAsset = galleryAssets.find((asset) => asset._id === featuredCandidate?._id);
  const orderedAssets = [
    ...galleryAssets,
    ...assets.filter((asset) => !galleryAssets.some((galleryAsset) => galleryAsset._id === asset._id)),
  ];
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
    ...(featuredAsset ? { featuredAsset: toPublicAsset(profile, featuredAsset) } : {}),
    ...(primaryLogo ? { primaryLogo } : {}),
    additionalLogos,
    logos,
    assets: orderedAssets.map((asset) => toPublicAsset(profile, asset)),
    galleryAssets: galleryAssets.map((asset) => toPublicAsset(profile, asset)),
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
  await assertProfileAssetCapacity(db, input.profileId, input.uploads.length);
  const assetIds: Id<"profileAssets">[] = [];
  const seenPlacementKeys = new Set<string>();

  for (const upload of input.uploads) {
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
    const altText = sanitizeProfileAssetAltText(upload.altText);
    const credit = sanitizeProfileAssetCredit(upload.credit);
    const creditUrl = sanitizeProfileAssetCreditUrl(upload.creditUrl);
    validateProfileAssetGalleryPlacements(upload.placements, label);
    const assetId = await db.insert("profileAssets", {
      profileId: input.profileId,
      storageKey: intent.storageKey,
      ...(intent.sourceStorageKey !== undefined && intent.sourceContentSha256 !== undefined
        ? { sourceStorageKey: intent.sourceStorageKey }
        : {}),
      ...(intent.downloadStorageKey !== undefined && intent.downloadContentSha256 !== undefined
        ? { downloadStorageKey: intent.downloadStorageKey }
        : {}),
      ...(intent.originalFileName !== undefined ? { originalFileName: intent.originalFileName } : {}),
      ...(intent.sourceUrl !== undefined ? { sourceUrl: intent.sourceUrl } : {}),
      mimeType: intent.mimeType,
      byteSize: intent.byteSize,
      ...(intent.sourceMimeType !== undefined ? { sourceMimeType: intent.sourceMimeType } : {}),
      ...(intent.sourceByteSize !== undefined ? { sourceByteSize: intent.sourceByteSize } : {}),
      ...(intent.sourceContentSha256 !== undefined ? { sourceContentSha256: intent.sourceContentSha256 } : {}),
      ...(intent.downloadMimeType !== undefined ? { downloadMimeType: intent.downloadMimeType } : {}),
      ...(intent.downloadByteSize !== undefined ? { downloadByteSize: intent.downloadByteSize } : {}),
      ...(intent.downloadContentSha256 !== undefined ? { downloadContentSha256: intent.downloadContentSha256 } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(caption !== undefined ? { caption } : {}),
      ...(altText !== undefined ? { altText } : {}),
      ...(credit !== undefined ? { credit } : {}),
      ...(creditUrl !== undefined ? { creditUrl } : {}),
      ...(intent.contentSha256 !== undefined ? { contentSha256: intent.contentSha256 } : {}),
      ...(intent.width !== undefined ? { width: intent.width } : {}),
      ...(intent.height !== undefined ? { height: intent.height } : {}),
      visibility: "public",
      source: input.source,
      uploadedBy: input.requestedBy,
      uploadedAt: intent.uploadedAt ?? input.now,
      state: "active",
      updatedAt: input.now,
    });

    for (const placement of upload.placements) {
      const orderedMultiPlacement = placement === "additional_logo" || placement === "gallery";
      const key = orderedMultiPlacement ? `${placement}:${assetId}` : placement;
      if (seenPlacementKeys.has(key)) {
        continue;
      }

      seenPlacementKeys.add(key);
      if (!orderedMultiPlacement) {
        const existing = await db
          .query("profileAssetPlacements")
          .withIndex("by_profileId_placement_state_position", (query) =>
            query.eq("profileId", input.profileId).eq("placement", placement).eq("state", "active"),
          )
          .collect();
        await Promise.all(
          existing.map((current) =>
            db.patch(current._id, { state: "deleted", updatedAt: input.now }),
          ),
        );
      }
      let position = 0;
      if (orderedMultiPlacement) {
        const existingOrderedPlacements = await db
          .query("profileAssetPlacements")
          .withIndex("by_profileId_placement_state_position", (query) =>
            query
              .eq("profileId", input.profileId)
              .eq("placement", placement)
              .eq("state", "active"),
          )
          .collect();
        if (upload.position !== undefined) {
          const requestedPosition = validateProfileAssetPosition(upload.position)!;
          const ordered = existingOrderedPlacements.sort(
            (first, second) =>
              first.position - second.position ||
              String(first._id).localeCompare(String(second._id)),
          );
          position = Math.min(requestedPosition, ordered.length);
          await Promise.all(
            ordered.map((current, index) => {
              const nextPosition = index >= position ? index + 1 : index;
              return current.position === nextPosition
                ? Promise.resolve()
                : db.patch(current._id, { position: nextPosition, updatedAt: input.now });
            }),
          );
        } else {
          position = existingOrderedPlacements.reduce(
            (next, current) => Math.max(next, current.position + 1),
            0,
          );
        }
      }
      await db.insert("profileAssetPlacements", {
        profileId: input.profileId,
        assetId,
        placement,
        position,
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
    processingToken: string;
    mimeType: string;
    byteSize: number;
    sourceMimeType?: string;
    sourceByteSize?: number;
    sourceContentSha256?: string;
    downloadMimeType?: string;
    downloadByteSize?: number;
    downloadContentSha256?: string;
    contentSha256?: string;
    width?: number;
    height?: number;
    now: number;
  },
) {
  const intent = await db.get(input.intentId);

  if (
    intent === null ||
    intent.uploadToken !== input.uploadToken ||
    intent.processingToken !== input.processingToken
  ) {
    throw new Error("Profile media upload intent was not found.");
  }

  if (intent.state !== "pending" || intent.expiresAt < input.now) {
    throw new Error("Profile media upload intent is no longer pending.");
  }

  if (
    intent.targetProfileId !== undefined &&
    (intent.requestedBy.issuer !== "vrdex:api" ||
      !(await userOwnsProfile(
        db,
        intent.targetProfileId,
        intent.requestedBy.subject as Id<"users">,
      )))
  ) {
    throw new Error("You do not have permission to update this profile.");
  }

  if (intent.targetProfileId !== undefined && input.contentSha256 !== undefined) {
    const existingAssets = await db
      .query("profileAssets")
      .withIndex("by_profileId", (query) => query.eq("profileId", intent.targetProfileId!))
      .collect();
    if (existingAssets.some((asset) => asset.contentSha256 === input.contentSha256)) {
      throw new Error("This image already exists in the profile media kit.");
    }
  }

  await db.patch(intent._id, {
    mimeType: normalizeProfileAssetMimeType(input.mimeType),
    byteSize: validateProfileAssetByteSize(input.byteSize),
    ...(input.sourceMimeType !== undefined ? { sourceMimeType: normalizeProfileAssetMimeType(input.sourceMimeType) } : {}),
    ...(input.sourceByteSize !== undefined ? { sourceByteSize: validateProfileAssetByteSize(input.sourceByteSize) } : {}),
    ...(input.sourceContentSha256 !== undefined ? { sourceContentSha256: input.sourceContentSha256 } : {}),
    ...(input.downloadMimeType !== undefined ? { downloadMimeType: normalizeProfileAssetMimeType(input.downloadMimeType) } : {}),
    ...(input.downloadByteSize !== undefined ? { downloadByteSize: validateProfileAssetByteSize(input.downloadByteSize) } : {}),
    ...(input.downloadContentSha256 !== undefined ? { downloadContentSha256: input.downloadContentSha256 } : {}),
    ...(input.contentSha256 !== undefined ? { contentSha256: input.contentSha256 } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    state: "uploaded",
    processingToken: undefined,
    processingStartedAt: undefined,
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
        ...(intent.altText !== undefined ? { altText: intent.altText } : {}),
        ...(intent.credit !== undefined ? { credit: intent.credit } : {}),
        ...(intent.creditUrl !== undefined ? { creditUrl: intent.creditUrl } : {}),
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

    if (intent.requestedBy.issuer === "vrdex:api") {
      await recordApiWriteAuditEvent(db, {
        action: "profile_asset_upload_completed",
        actorKind: "upload_token",
        resourceType: "profile_asset",
        routeClass: "asset_upload_intent",
        targetProfileId: intent.targetProfileId,
        targetIntentId: intent._id,
        assetIds,
        now: input.now,
      });
    }
  }

  return { ok: true as const, assetIds };
}
