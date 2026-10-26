import type { PublicSearchResult } from "./public-search";

export type SearchSuggestion = Pick<PublicSearchResult,
  "entityType" | "profileType" | "routePath" | "slug" | "subtitle" | "title" |
  "imageUrl" | "profileImageUrl" | "logoImageUrl" | "avatarAppearance" | "trustLabel"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAppearance(value: unknown): SearchSuggestion["avatarAppearance"] {
  if (!isRecord(value) || typeof value.borderEnabled !== "boolean" ||
    typeof value.borderColor !== "string" ||
    typeof value.borderWidthPx !== "number" || !Number.isFinite(value.borderWidthPx) ||
    typeof value.borderSoftnessPx !== "number" || !Number.isFinite(value.borderSoftnessPx) ||
    typeof value.radiusPercent !== "number" || !Number.isFinite(value.radiusPercent)) return undefined;

  return {
    borderEnabled: value.borderEnabled,
    borderColor: value.borderColor,
    borderWidthPx: value.borderWidthPx,
    borderSoftnessPx: value.borderSoftnessPx,
    radiusPercent: value.radiusPercent,
  };
}

function parseSuggestion(value: unknown): SearchSuggestion | null {
  if (!isRecord(value)) return null;
  const { entityType, profileType, slug, routePath, title, subtitle, imageUrl, profileImageUrl, logoImageUrl, trustLabel } = value;
  if (entityType !== "profile" && entityType !== "event" && entityType !== "world") return null;
  if (entityType === "profile"
    ? profileType !== "person" && profileType !== "community"
    : profileType !== undefined) return null;
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    typeof title !== "string" || !title.trim() || typeof routePath !== "string") return null;
  // Match the public canonical route grammar, including the result's own slug.
  // No URL parsing/normalization that could turn an unsafe path into a target.
  if (entityType === "event") {
    const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(routePath);
    if (!match || match[2] !== slug) return null;
  } else if (routePath !== `/${slug}`) return null;
  if ((subtitle !== undefined && typeof subtitle !== "string") ||
    (imageUrl !== undefined && typeof imageUrl !== "string") ||
    (profileImageUrl !== undefined && typeof profileImageUrl !== "string") ||
    (logoImageUrl !== undefined && typeof logoImageUrl !== "string")) return null;
  if (trustLabel !== undefined && trustLabel !== "community_submitted" && trustLabel !== "unclaimed" &&
    trustLabel !== "claimed_unverified" && trustLabel !== "claimed_verified") return null;
  const avatarAppearance = parseAppearance(value.avatarAppearance);
  if (value.avatarAppearance !== undefined && avatarAppearance === undefined) return null;

  return {
    entityType, slug, routePath, title,
    ...(profileType === "person" || profileType === "community" ? { profileType } : {}),
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(profileImageUrl !== undefined ? { profileImageUrl } : {}),
    ...(logoImageUrl !== undefined ? { logoImageUrl } : {}),
    ...(trustLabel !== undefined ? { trustLabel } : {}),
    ...(avatarAppearance !== undefined ? { avatarAppearance } : {}),
  };
}

export function parsePublicSearchSuggestions(value: unknown): SearchSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  const results: SearchSuggestion[] = [];
  for (const row of value.results) {
    const suggestion = parseSuggestion(row);
    if (!suggestion) return [];
    results.push(suggestion);
  }
  return results;
}
