import type { Doc } from "./_generated/dataModel";

export type ProfileFieldVisibilityKey =
  | "aliases"
  | "tags"
  | "genres"
  | "headline"
  | "bio"
  | "about"
  | "avatarImageUrl"
  | "bannerImageUrl"
  | "outboundLinks"
  | "region"
  | "timezone"
  | "personPronouns"
  | "personRoleTags"
  | "communitySubtype"
  | "communityCategoryTags";

export type ProfileVisibilitySurface = "profile_page" | "discovery";
export type ProfileFieldVisibilityState = "public" | "unlisted" | "private";

type ProfileVisibilitySource = Pick<Doc<"profiles">, "fieldVisibility">;

export function getProfileFieldVisibility(
  profile: ProfileVisibilitySource,
  key: ProfileFieldVisibilityKey,
): ProfileFieldVisibilityState {
  return profile.fieldVisibility?.[key] ?? "public";
}

export function isProfileFieldVisible(
  profile: ProfileVisibilitySource,
  key: ProfileFieldVisibilityKey,
  surface: ProfileVisibilitySurface,
): boolean {
  const visibility = getProfileFieldVisibility(profile, key);

  if (visibility === "private") {
    return false;
  }

  return surface === "profile_page" || visibility === "public";
}

export function visibleProfileField<T>(
  profile: ProfileVisibilitySource,
  key: ProfileFieldVisibilityKey,
  value: T | undefined,
  surface: ProfileVisibilitySurface,
): T | undefined {
  return isProfileFieldVisible(profile, key, surface) ? value : undefined;
}

export function visibleProfileList<T>(
  profile: ProfileVisibilitySource,
  key: ProfileFieldVisibilityKey,
  values: T[],
  surface: ProfileVisibilitySurface,
): T[] {
  return isProfileFieldVisible(profile, key, surface) ? values : [];
}
