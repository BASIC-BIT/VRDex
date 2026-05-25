import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
  PROFILE_SLUG_MAX_LENGTH,
  PROFILE_SLUG_MIN_LENGTH,
  PROFILE_SLUG_PATTERN,
  normalizeProfileSlugInput,
} from "./_profileSlugs";

export const WORLD_SLUG_MIN_LENGTH = PROFILE_SLUG_MIN_LENGTH;
export const WORLD_SLUG_MAX_LENGTH = PROFILE_SLUG_MAX_LENGTH;
export const WORLD_SLUG_PATTERN = PROFILE_SLUG_PATTERN;
export const WORLD_SLUG_FALLBACK_BASE = "world-page";

export const RESERVED_WORLD_SLUGS = [
  "about",
  "account",
  "admin",
  "api",
  "auth",
  "billing",
  "blog",
  "c",
  "cards",
  "communities",
  "community",
  "contact",
  "dashboard",
  "docs",
  "e",
  "events",
  "help",
  "login",
  "logout",
  "me",
  "moderation",
  "p",
  "people",
  "person",
  "pricing",
  "privacy",
  "profile",
  "profiles",
  "search",
  "settings",
  "signup",
  "support",
  "terms",
  "vrdex",
  "w",
  "world",
  "worlds",
] as const;

export type WorldSlugValidationReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "reserved";

export type WorldSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: WorldSlugValidationReason };

export type WorldSlugAvailabilityResult =
  | { available: true; slug: string }
  | { available: false; slug: string; reason: "invalid" | "reserved" | "taken" };

const RESERVED_WORLD_SLUG_SET = new Set<string>(RESERVED_WORLD_SLUGS);

export function normalizeWorldSlugInput(input: string): string {
  return normalizeProfileSlugInput(input);
}

export function validateWorldSlug(slug: string): WorldSlugValidationResult {
  if (slug.length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (slug.length < WORLD_SLUG_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  if (slug.length > WORLD_SLUG_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!WORLD_SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "invalid_format" };
  }

  if (RESERVED_WORLD_SLUG_SET.has(slug)) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, slug };
}

export function toWorldSlug(input: string): WorldSlugValidationResult {
  return validateWorldSlug(normalizeWorldSlugInput(input));
}

export function createWorldSlugBase(input: string): string {
  let slug = normalizeWorldSlugInput(input) || WORLD_SLUG_FALLBACK_BASE;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (slug.length < WORLD_SLUG_MIN_LENGTH || RESERVED_WORLD_SLUG_SET.has(slug)) {
      slug = `${slug}-world`;
    }

    if (slug.length > WORLD_SLUG_MAX_LENGTH) {
      slug = slug.slice(0, WORLD_SLUG_MAX_LENGTH).replace(/-+$/g, "");
    }

    const validated = validateWorldSlug(slug);
    if (validated.ok) {
      return validated.slug;
    }
  }

  return WORLD_SLUG_FALLBACK_BASE;
}

export function createWorldSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }

  const suffix = `-${attempt}`;
  const maxBaseLength = WORLD_SLUG_MAX_LENGTH - suffix.length;
  return `${base.slice(0, maxBaseLength).replace(/-+$/g, "")}${suffix}`;
}

export async function getWorldBySlug(db: DatabaseReader, slug: string) {
  return await db.query("worlds").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
}

export async function checkWorldSlugAvailability(
  db: DatabaseReader,
  slug: string,
  excludingWorldId?: Id<"worlds">,
): Promise<WorldSlugAvailabilityResult> {
  const validation = validateWorldSlug(slug);

  if (!validation.ok) {
    return {
      available: false,
      slug,
      reason: validation.reason === "reserved" ? "reserved" : "invalid",
    };
  }

  const existingWorld = await getWorldBySlug(db, validation.slug);

  if (existingWorld !== null && existingWorld._id !== excludingWorldId) {
    return { available: false, slug: validation.slug, reason: "taken" };
  }

  return { available: true, slug: validation.slug };
}

export async function findAvailableWorldSlug(
  db: DatabaseReader,
  input: string,
  options: { excludingWorldId?: Id<"worlds">; maxAttempts?: number } = {},
): Promise<string> {
  const base = createWorldSlugBase(input);
  const maxAttempts = options.maxAttempts ?? 50;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = createWorldSlugCandidate(base, attempt);
    const availability = await checkWorldSlugAvailability(db, candidate, options.excludingWorldId);

    if (availability.available) {
      return availability.slug;
    }
  }

  throw new Error(`Unable to find an available world slug for "${base}".`);
}
