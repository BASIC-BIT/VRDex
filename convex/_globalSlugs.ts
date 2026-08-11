import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

// Profiles, worlds, and events all render from the site root now -- vrdex.net/basicbit
// rather than vrdex.net/p/basicbit -- so the three tables share one namespace. Every
// slug rule lives here so the three entity modules cannot drift apart again.
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 64;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Every top-level path the site serves, plus room for pages it does not serve yet.
// A slug that collides with one of these would be shadowed by the real route and
// resolve to the wrong page, so they are never assignable.
// `tests/web/reserved-route-slugs.test.ts` walks the app directory and fails when a
// new top-level route lands without being added here.
export const RESERVED_ROUTE_SLUGS = [
  // Live routes.
  "account",
  "api",
  "claim",
  "deployment",
  "developers",
  "discover",
  "discovery",
  "events",
  "handoff",
  "l",
  "lookup",
  "mcp",
  "oauth",
  "playwright",
  "privacy",
  "search",
  "sign-in",
  "sign-up",
  "submit",
  "time",
  // Framework and well-known paths that never reach a page component.
  "favicon",
  "manifest",
  "opensearch",
  "robots",
  "rss",
  "sitemap",
  "well-known",
  // Retired prefixes. Nothing serves these now, but old links and muscle memory
  // point at them, so they stay unassignable rather than resolving to a person.
  "c",
  "e",
  "p",
  "w",
  // Pages we will plausibly want, held so a squatter cannot take the obvious name.
  "about",
  "admin",
  "ads",
  "analytics",
  "app",
  "apps",
  "auth",
  "billing",
  "blog",
  "brand",
  "calendar",
  "cards",
  "careers",
  "changelog",
  "communities",
  "community",
  "contact",
  "cookies",
  "dashboard",
  "developer",
  "dmca",
  "docs",
  "download",
  "downloads",
  "embed",
  "event",
  "explore",
  "faq",
  "feed",
  "feedback",
  "files",
  "followers",
  "following",
  "forgot-password",
  "guidelines",
  "health",
  "help",
  "home",
  "images",
  "import",
  "integrations",
  "invite",
  "jobs",
  "legal",
  "library",
  "login",
  "logout",
  "map",
  "media",
  "moderation",
  "new",
  "news",
  "notifications",
  "onboarding",
  "org",
  "partners",
  "people",
  "person",
  "plans",
  "press",
  "pricing",
  "profile",
  "profiles",
  "public",
  "qr",
  "register",
  "reset-password",
  "roadmap",
  "security",
  "settings",
  "signin",
  "signout",
  "signup",
  "sponsors",
  "static",
  "stats",
  "status",
  "store",
  "support",
  "team",
  "terms",
  "tos",
  "trending",
  "upgrade",
  "upload",
  "verify",
  "widget",
  "world",
  "worlds",
  // Ours regardless of who asks.
  "basicbit",
  "vrdex",
] as const;

// Short, generic, obviously-desirable names held back so they can be granted or sold
// later rather than going to whoever registers first. Unlike the route list these are
// safe to hand out -- an operator writing the slug directly is how one gets claimed
// today; a self-serve grant path can come with the paid feature.
// Slugs under SLUG_MIN_LENGTH are already unassignable, which reserves the whole
// one- and two-character space for the same purpose without listing it.
export const RESERVED_PREMIUM_SLUGS = [
  "art",
  "artist",
  "bar",
  "basic",
  "beat",
  "beats",
  "chat",
  "club",
  "crew",
  "dance",
  "dj",
  "djs",
  "drum",
  "edm",
  "fam",
  "friends",
  "fun",
  "game",
  "games",
  "gig",
  "gigs",
  "host",
  "hosts",
  "lab",
  "live",
  "lounge",
  "mix",
  "music",
  "night",
  "party",
  "performer",
  "producer",
  "rave",
  "room",
  "set",
  "sets",
  "show",
  "shows",
  "sound",
  "stage",
  "stream",
  "studio",
  "vip",
  "vj",
  "vr",
  "vrc",
  "vrchat",
] as const;

const RESERVED_ROUTE_SLUG_SET = new Set<string>(RESERVED_ROUTE_SLUGS);
const RESERVED_SLUG_SET = new Set<string>([
  ...RESERVED_ROUTE_SLUGS,
  ...RESERVED_PREMIUM_SLUGS,
]);

/** Not assignable to anyone, by either self-serve or an operator. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug);
}

/**
 * Names a real page, so no profile can ever answer to it.
 *
 * Narrower than `isReservedSlug` on purpose, and the distinction matters wherever
 * a slug is *read* rather than assigned. A premium name is held back from
 * self-serve but an operator can still grant it, so once `basic` belongs to
 * somebody, `vrdex.net/basic` is a real profile link and has to be readable as
 * one. Only a route name can never be a profile.
 */
export function isReservedRouteSlug(slug: string): boolean {
  return RESERVED_ROUTE_SLUG_SET.has(slug);
}

export function normalizeSlugInput(input: string): string {
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

export type SlugFormatReason = "empty" | "too_short" | "too_long" | "invalid_format";

export type SlugFormatResult =
  | { ok: true; slug: string }
  | { ok: false; reason: SlugFormatReason };

// Shape only -- deliberately no reserved check. Lookups run through this, and a
// reserved name that an operator has already granted must still resolve to its owner.
// The reserved check belongs on the assignment path, in check*SlugAvailability.
export function validateSlugFormat(slug: string): SlugFormatResult {
  if (slug.length === 0) {
    return { ok: false, reason: "empty" };
  }

  if (slug.length < SLUG_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  if (slug.length > SLUG_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: "invalid_format" };
  }

  return { ok: true, slug };
}

export async function getProfileBySlug(db: DatabaseReader, slug: string) {
  return await db.query("profiles").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
}

export async function getWorldBySlug(db: DatabaseReader, slug: string) {
  return await db.query("worlds").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
}

export async function getEventBySlug(db: DatabaseReader, slug: string) {
  return await db.query("events").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
}

export type SlugOwner =
  | { kind: "person" | "community"; profile: Doc<"profiles"> }
  | { kind: "world"; world: Doc<"worlds"> }
  | { kind: "event"; event: Doc<"events"> };

export type SlugOwnerId = Id<"profiles"> | Id<"worlds"> | Id<"events">;

// Whoever holds this slug across all three tables, ignoring visibility: an unpublished
// world still owns its name, so uniqueness has to see it. Callers that serve a page
// apply their own public-visibility filter on top.
//
// Convex mutations are transactional across tables, so a write path that calls this
// and then inserts cannot race another writer onto the same slug.
export async function findSlugOwner(
  db: DatabaseReader,
  slug: string,
  excluding?: SlugOwnerId,
): Promise<SlugOwner | null> {
  const profile = await getProfileBySlug(db, slug);
  if (profile !== null && profile._id !== excluding) {
    return { kind: profile.profileType, profile };
  }

  const world = await getWorldBySlug(db, slug);
  if (world !== null && world._id !== excluding) {
    return { kind: "world", world };
  }

  const event = await getEventBySlug(db, slug);
  if (event !== null && event._id !== excluding) {
    return { kind: "event", event };
  }

  return null;
}
