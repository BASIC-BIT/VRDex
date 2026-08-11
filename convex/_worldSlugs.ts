import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  findSlugOwner,
  getWorldBySlug,
  isReservedSlug,
  normalizeSlugInput,
  validateSlugFormat,
  type SlugFormatReason,
} from "./_globalSlugs";

export { getWorldBySlug };

export const WORLD_SLUG_MIN_LENGTH = SLUG_MIN_LENGTH;
export const WORLD_SLUG_MAX_LENGTH = SLUG_MAX_LENGTH;
export const WORLD_SLUG_PATTERN = SLUG_PATTERN;
export const WORLD_SLUG_FALLBACK_BASE = "world-page";

export type WorldSlugValidationReason = SlugFormatReason;

export type WorldSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: WorldSlugValidationReason };

export type WorldSlugAvailabilityResult =
  | { available: true; slug: string }
  | { available: false; slug: string; reason: "invalid" | "reserved" | "taken" };

export function normalizeWorldSlugInput(input: string): string {
  return normalizeSlugInput(input);
}

export function validateWorldSlug(slug: string): WorldSlugValidationResult {
  return validateSlugFormat(slug);
}

export function toWorldSlug(input: string): WorldSlugValidationResult {
  return validateWorldSlug(normalizeWorldSlugInput(input));
}

export function createWorldSlugBase(input: string): string {
  let slug = normalizeWorldSlugInput(input) || WORLD_SLUG_FALLBACK_BASE;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (slug.length < WORLD_SLUG_MIN_LENGTH || isReservedSlug(slug)) {
      slug = `${slug}-world`;
    }

    if (slug.length > WORLD_SLUG_MAX_LENGTH) {
      slug = slug.slice(0, WORLD_SLUG_MAX_LENGTH).replace(/-+$/g, "");
    }

    const validated = validateWorldSlug(slug);
    if (validated.ok && !isReservedSlug(validated.slug)) {
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

export async function checkWorldSlugAvailability(
  db: DatabaseReader,
  slug: string,
  excludingWorldId?: Id<"worlds">,
): Promise<WorldSlugAvailabilityResult> {
  const validation = validateWorldSlug(slug);

  if (!validation.ok) {
    return { available: false, slug, reason: "invalid" };
  }

  if (isReservedSlug(validation.slug)) {
    return { available: false, slug: validation.slug, reason: "reserved" };
  }

  const owner = await findSlugOwner(db, validation.slug, excludingWorldId);

  if (owner !== null) {
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
