import type { Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import {
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  SLUG_PATTERN,
  checkSlugAvailability,
  getEventBySlug,
  isReservedSlug,
  normalizeSlugInput,
  validateSlugFormat,
  type SlugFormatReason,
} from "./_globalSlugs";

export { getEventBySlug };

export const EVENT_SLUG_MIN_LENGTH = SLUG_MIN_LENGTH;
export const EVENT_SLUG_MAX_LENGTH = SLUG_MAX_LENGTH;
export const EVENT_SLUG_PATTERN = SLUG_PATTERN;
export const EVENT_SLUG_FALLBACK_BASE = "event-page";

export type EventSlugValidationReason = SlugFormatReason;

export type EventSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: EventSlugValidationReason };

export type EventSlugAvailabilityResult =
  | { available: true; slug: string }
  | { available: false; slug: string; reason: "invalid" | "reserved" | "taken" };

export function normalizeEventSlugInput(input: string): string {
  return normalizeSlugInput(input);
}

export function validateEventSlug(slug: string): EventSlugValidationResult {
  return validateSlugFormat(slug);
}

export function toEventSlug(input: string): EventSlugValidationResult {
  return validateEventSlug(normalizeEventSlugInput(input));
}

function eventDateSlugPart(startAt: number): string {
  const date = new Date(startAt);

  if (Number.isNaN(date.getTime())) {
    return "date";
  }

  return date.toISOString().slice(0, 10);
}

export function createEventSlugBase(title: string, startAt?: number): string {
  const titlePart = normalizeEventSlugInput(title) || EVENT_SLUG_FALLBACK_BASE;
  const datedTitle = startAt === undefined ? titlePart : `${titlePart}-${eventDateSlugPart(startAt)}`;
  let slug = datedTitle;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (slug.length < EVENT_SLUG_MIN_LENGTH || isReservedSlug(slug)) {
      slug = `${slug}-event`;
    }

    if (slug.length > EVENT_SLUG_MAX_LENGTH) {
      slug = slug.slice(0, EVENT_SLUG_MAX_LENGTH).replace(/-+$/g, "");
    }

    const validated = validateEventSlug(slug);
    if (validated.ok && !isReservedSlug(validated.slug)) {
      return validated.slug;
    }
  }

  return EVENT_SLUG_FALLBACK_BASE;
}

export function createEventSlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) {
    return base;
  }

  const suffix = `-${attempt}`;
  const maxBaseLength = EVENT_SLUG_MAX_LENGTH - suffix.length;
  return `${base.slice(0, maxBaseLength).replace(/-+$/g, "")}${suffix}`;
}

export async function checkEventSlugAvailability(
  db: DatabaseReader,
  slug: string,
  excludingEventId?: Id<"events">,
): Promise<EventSlugAvailabilityResult> {
  return await checkSlugAvailability(db, slug, excludingEventId);
}

export async function findAvailableEventSlug(
  db: DatabaseReader,
  input: { title: string; startAt?: number; preferredSlug?: string },
  options: { excludingEventId?: Id<"events">; maxAttempts?: number } = {},
): Promise<string> {
  const preferred = input.preferredSlug ? toEventSlug(input.preferredSlug) : null;
  if (preferred !== null && !preferred.ok) {
    throw new Error("Event slug must be lowercase letters, numbers, and single hyphens.");
  }

  // Refused rather than worked around. `toEventSlug` is shape-only so that lookups
  // still resolve a granted reserved name, which leaves this gate to catch one
  // being *asked for*: without it the reserved first candidate simply fails the
  // availability check and the loop hands back `support-2`, quietly moving a live
  // URL.
  //
  // Unless the event already holds it. `updateCommunityEventRecord` passes the
  // event's own slug as the preferred value on every edit, so an unconditional
  // refusal locked an event that owns a granted premium name out of *all* editing,
  // summary changes included. Reserved means "not handed out", not "cannot be
  // kept": creates and real slug changes are still refused.
  if (preferred !== null && preferred.ok && isReservedSlug(preferred.slug)) {
    const holder = await getEventBySlug(db, preferred.slug);
    const alreadyOwnsIt =
      options.excludingEventId !== undefined && holder?._id === options.excludingEventId;

    if (!alreadyOwnsIt) {
      throw new Error(`Event slug "${preferred.slug}" is reserved.`);
    }

  }

  const base = preferred?.ok ? preferred.slug : createEventSlugBase(input.title, input.startAt);
  const maxAttempts = options.maxAttempts ?? 50;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = createEventSlugCandidate(base, attempt);
    const availability = await checkEventSlugAvailability(db, candidate, options.excludingEventId);

    if (availability.available) {
      return availability.slug;
    }

    // Suffixing is for slugs we derived from a title. A slug the caller named is
    // a public address they chose, so a collision is an error rather than an
    // invitation to pick a different one.
    //
    // This also catches a legacy cross-entity collision on an unrelated update:
    // `events.ts` passes the event's own slug as the preferred value, which
    // `excludingEventId` clears, so the only way to reach here is a *profile* or
    // *world* holding the name. Silently moving the event to `<slug>-2` would
    // change a live URL during an edit that never asked to.
    if (preferred?.ok && attempt === 1) {
      throw new Error(
        `Event slug "${candidate}" is already taken. Choose another, or resolve the collision first.`,
      );
    }
  }

  throw new Error(`Unable to find an available event slug for "${base}".`);
}
