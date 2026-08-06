import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

export const PROFILE_SLUG_MIN_LENGTH = 3;
export const PROFILE_SLUG_MAX_LENGTH = 64;
export const PROFILE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PROFILE_SLUG_FALLBACK_BASE = "profile-page";

export const RESERVED_PROFILE_SLUGS = [
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
] as const;

export type ProfileSlugValidationReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_format"
  | "reserved";

export type ProfileSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: ProfileSlugValidationReason };

export type ProfileSlugAvailabilityResult =
  | { available: true; slug: string }
  | { available: false; slug: string; reason: "invalid" | "reserved" | "taken" };

const RESERVED_PROFILE_SLUG_SET = new Set<string>(RESERVED_PROFILE_SLUGS);

export function normalizeProfileSlugInput(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Read a profile slug out of whatever someone actually pasted.
 *
 * Request forms ask for a profile and get the link, because the link is what the
 * person has in front of them. Running that through `normalizeProfileSlugInput`
 * alone turns `https://vrdex.net/p/dj-aurora` into one long slug-shaped string
 * that passes validation and resolves to nothing, so the path segment is taken
 * first.
 *
 * Returns an empty string when the input names no profile, which the callers
 * distinguish from an empty field: text that normalizes away to nothing still
 * meant something to whoever typed it, and dropping it silently is how a dispute
 * arrives with no identifier on it.
 */
export function readProfileSlugFromInput(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed === "") {
    return "";
  }

  const url = /^(?:https?:\/\/)?([^/\s]+\.[^/\s]+)(\/.*)?$/i.exec(trimmed);

  // A bare host names no profile. Falling through would normalize the hostname
  // itself into `vrdex-net`, which is slug-shaped and passes validation.
  if (url !== null && (url[2] === undefined || url[2] === "/")) {
    return "";
  }

  const segments = (url?.[2] ?? trimmed).split(/[?#]/)[0].split("/").filter(Boolean);

  return normalizeProfileSlugInput(segments[segments.length - 1] ?? "");
}

export function validateProfileSlug(slug: string): ProfileSlugValidationResult {
  if (slug.length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (slug.length < PROFILE_SLUG_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  if (slug.length > PROFILE_SLUG_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!PROFILE_SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "invalid_format" };
  }

  if (RESERVED_PROFILE_SLUG_SET.has(slug)) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, slug };
}

export function toProfileSlug(input: string): ProfileSlugValidationResult {
  return validateProfileSlug(normalizeProfileSlugInput(input));
}

export function createProfileSlugBase(input: string): string {
  let slug = normalizeProfileSlugInput(input) || PROFILE_SLUG_FALLBACK_BASE;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (slug.length < PROFILE_SLUG_MIN_LENGTH || RESERVED_PROFILE_SLUG_SET.has(slug)) {
      slug = `${slug}-profile`;
    }

    if (slug.length > PROFILE_SLUG_MAX_LENGTH) {
      slug = slug.slice(0, PROFILE_SLUG_MAX_LENGTH).replace(/-+$/g, "");
    }

    const validated = validateProfileSlug(slug);
    if (validated.ok) {
      return validated.slug;
    }
  }

  return PROFILE_SLUG_FALLBACK_BASE;
}

export function createProfileSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }

  const suffix = `-${attempt}`;
  const maxBaseLength = PROFILE_SLUG_MAX_LENGTH - suffix.length;
  return `${base.slice(0, maxBaseLength).replace(/-+$/g, "")}${suffix}`;
}

export async function getProfileBySlug(db: DatabaseReader, slug: string) {
  return await db
    .query("profiles")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export async function checkProfileSlugAvailability(
  db: DatabaseReader,
  slug: string,
  excludingProfileId?: Id<"profiles">,
): Promise<ProfileSlugAvailabilityResult> {
  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    return {
      available: false,
      slug,
      reason: validation.reason === "reserved" ? "reserved" : "invalid",
    };
  }

  const existingProfile = await getProfileBySlug(db, validation.slug);

  if (existingProfile !== null && existingProfile._id !== excludingProfileId) {
    return { available: false, slug: validation.slug, reason: "taken" };
  }

  return { available: true, slug: validation.slug };
}

export async function findAvailableProfileSlug(
  db: DatabaseReader,
  input: string,
  options: { excludingProfileId?: Id<"profiles">; maxAttempts?: number } = {},
): Promise<string> {
  const base = createProfileSlugBase(input);
  const maxAttempts = options.maxAttempts ?? 50;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = createProfileSlugCandidate(base, attempt);
    const availability = await checkProfileSlugAvailability(
      db,
      candidate,
      options.excludingProfileId,
    );

    if (availability.available) {
      return availability.slug;
    }
  }

  throw new Error(`Unable to find an available profile slug for "${base}".`);
}
