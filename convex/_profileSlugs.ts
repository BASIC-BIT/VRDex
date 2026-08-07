import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { supportInputError } from "./_supportIntake";

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

  // Read by path, not by hostname. Requiring a dotted host rejected the profile
  // URL of every localhost and loopback deployment, so a self-hosted instance
  // could not paste the link its own form asks for.
  const path = profileUrlPath(trimmed);

  if (path !== null) {
    // Only the two routes that actually name a profile. Any host used to
    // qualify, so a requester pasting the evidence for their dispute -- a
    // VRChat page, a Discord invite, a post -- had its last path segment
    // normalized into a slug-shaped string that passes validation and points at
    // some other profile, or none. The digest then aimed an operator at the
    // wrong record while the URL they actually meant was discarded.
    const profilePath = /^\/(?:p|c)\/([^/?#]+)/i.exec(path);

    return profilePath === null ? "" : normalizeProfileSlugInput(profilePath[1]);
  }

  // A bare word, typed rather than pasted. Slashes here would mean a path
  // fragment with no host, which names no profile either.
  return trimmed.includes("/") ? "" : normalizeProfileSlugInput(trimmed);
}

/** The path of `input` when it is a URL, or `null` when it is not one. */
function profileUrlPath(input: string): string | null {
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);

      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }

  // Scheme-less, which is how most people paste a link. Only a dotted host is
  // recognizable without one: `localhost/p/x` cannot be told apart from a
  // relative path, and guessing would swallow real paths.
  const hostless = /^[^/\s]+\.[^/\s]+(\/.*)?$/i.exec(input);

  return hostless === null ? null : (hostless[1] ?? "");
}

/** Shared by both intake mutations behind `/support`. */
export const INVALID_PROFILE_INPUT_MESSAGE =
  "That does not look like a profile. Paste the profile link, or the last part of it, like dj-aurora.";

/**
 * The slug a request names, `undefined` for a blank field, or a refusal.
 *
 * Lives here rather than in either caller because one form feeds both
 * `supportRequests` and `suppressions`, and its profile field says "paste the
 * profile link" whichever topic is chosen. Parsing it in one mutation only
 * meant a pasted link resolved for a dispute and was rejected for an opt-out.
 *
 * Throws rather than returning `undefined` for unusable text: dropping the only
 * identifier on a request, without telling the person who typed it, is how a
 * dispute arrives that nobody can act on.
 */
export function resolveRequestedProfileSlug(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim();
  const slug = readProfileSlugFromInput(trimmed);

  if (slug === "") {
    if (trimmed !== "") {
      throw supportInputError(INVALID_PROFILE_INPUT_MESSAGE);
    }

    return undefined;
  }

  const validation = validateProfileSlug(slug);

  if (!validation.ok) {
    throw supportInputError(INVALID_PROFILE_INPUT_MESSAGE);
  }

  return validation.slug;
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
