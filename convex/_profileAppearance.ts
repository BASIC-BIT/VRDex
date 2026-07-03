import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export const PROFILE_PUBLIC_SECTION_KEYS = [
  "about",
  "events",
  "links",
  "media_kit",
  "worlds",
  "details",
] as const;

export type ProfilePublicSectionKey = (typeof PROFILE_PUBLIC_SECTION_KEYS)[number];

export const DEFAULT_PROFILE_PUBLIC_SECTION_ORDER: ProfilePublicSectionKey[] = [
  "about",
  "events",
  "links",
  "media_kit",
  "worlds",
  "details",
];

export type PublicProfileAppearance = {
  sectionOrder: ProfilePublicSectionKey[];
};

export function isProfilePublicSectionKey(value: unknown): value is ProfilePublicSectionKey {
  return typeof value === "string" && (PROFILE_PUBLIC_SECTION_KEYS as readonly string[]).includes(value);
}

export function normalizeProfilePublicSectionOrder(
  input: readonly unknown[] | undefined,
): ProfilePublicSectionKey[] {
  const seen = new Set<ProfilePublicSectionKey>();
  const normalized: ProfilePublicSectionKey[] = [];

  for (const value of input ?? []) {
    if (!isProfilePublicSectionKey(value) || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  for (const section of DEFAULT_PROFILE_PUBLIC_SECTION_ORDER) {
    if (!seen.has(section)) {
      normalized.push(section);
    }
  }

  return normalized;
}

export function toPublicProfileAppearance(
  preference: Pick<Doc<"profileAssetDisplayPreferences">, "sectionOrder"> | null | undefined,
): PublicProfileAppearance {
  return {
    sectionOrder: normalizeProfilePublicSectionOrder(preference?.sectionOrder),
  };
}

export async function getPublicProfileAppearance(
  db: DatabaseReader,
  profileId: Id<"profiles">,
): Promise<PublicProfileAppearance> {
  const preference = await db
    .query("profileAssetDisplayPreferences")
    .withIndex("by_profileId", (query) => query.eq("profileId", profileId))
    .unique();

  return toPublicProfileAppearance(preference);
}
