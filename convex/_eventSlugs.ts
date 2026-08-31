import type { DatabaseReader } from "./_generated/server";
import { validateSlugFormat, type SlugFormatReason } from "./_globalSlugs";

export type EventSlugValidationReason = SlugFormatReason;

export type EventSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; reason: EventSlugValidationReason };

export function validateEventSlug(slug: string): EventSlugValidationResult {
  return validateSlugFormat(slug);
}

export async function getEventBySlug(db: DatabaseReader, slug: string) {
  return await db.query("events").withIndex("by_slug", (query) => query.eq("slug", slug)).unique();
}
