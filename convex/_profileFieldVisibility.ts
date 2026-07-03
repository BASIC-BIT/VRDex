import type { Doc } from "./_generated/dataModel";

export const PROFILE_FIELD_VISIBILITY_KEYS = [
  "aliases",
  "tags",
  "genres",
  "headline",
  "bio",
  "about",
  "avatarImageUrl",
  "bannerImageUrl",
  "outboundLinks",
  "region",
  "timezone",
  "personPronouns",
  "personRoleTags",
  "communitySubtype",
  "communityCategoryTags",
] as const;

export const PROFILE_FIELD_VISIBILITY_STATES = [
  "public",
  "unlisted",
  "private",
] as const;

export type ProfileFieldVisibilityKey = (typeof PROFILE_FIELD_VISIBILITY_KEYS)[number];

export type ProfileVisibilitySurface = "profile_page" | "discovery";
export type ProfileFieldVisibilityState = (typeof PROFILE_FIELD_VISIBILITY_STATES)[number];

type ProfileVisibilitySource = Pick<Doc<"profiles">, "fieldVisibility">;
export type ProfileFieldVisibilityMap = NonNullable<Doc<"profiles">["fieldVisibility"]>;
export type MaterializedProfileFieldVisibility = Record<
  ProfileFieldVisibilityKey,
  ProfileFieldVisibilityState
>;

const PROFILE_FIELD_VISIBILITY_KEY_SET = new Set<string>(PROFILE_FIELD_VISIBILITY_KEYS);
const PROFILE_FIELD_VISIBILITY_STATE_SET = new Set<unknown>(PROFILE_FIELD_VISIBILITY_STATES);

export function isProfileFieldVisibilityKey(value: string): value is ProfileFieldVisibilityKey {
  return PROFILE_FIELD_VISIBILITY_KEY_SET.has(value);
}

export function isProfileFieldVisibilityState(
  value: unknown,
): value is ProfileFieldVisibilityState {
  return PROFILE_FIELD_VISIBILITY_STATE_SET.has(value);
}

export function materializeProfileFieldVisibility(
  fieldVisibility: ProfileFieldVisibilityMap | undefined,
): MaterializedProfileFieldVisibility {
  const result = {} as MaterializedProfileFieldVisibility;

  for (const key of PROFILE_FIELD_VISIBILITY_KEYS) {
    result[key] = fieldVisibility?.[key] ?? "public";
  }

  return result;
}

export function normalizeProfileFieldVisibility(
  input: Record<string, unknown>,
): ProfileFieldVisibilityMap | undefined {
  const normalized: ProfileFieldVisibilityMap = {};

  for (const [key, value] of Object.entries(input)) {
    if (!isProfileFieldVisibilityKey(key)) {
      throw new Error(`Unsupported profile field visibility key "${key}".`);
    }

    if (!isProfileFieldVisibilityState(value)) {
      throw new Error(`Unsupported profile field visibility state for "${key}".`);
    }

    if (value !== "public") {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

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
