import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";

// Profiles, worlds, and events all render from the site root now -- vrdex.net/basicbit
// rather than vrdex.net/p/basicbit -- so the three tables share one namespace. Every
// slug rule lives here so the three entity modules cannot drift apart again.
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 64;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Segments a route actually serves today.
 *
 * These are the only names that *shadow* a slug: Next matches the static segment
 * first, so a profile slugged `lookup` could never be reached. Kept separate from
 * the merely-held names below because read paths need this narrower question --
 * "is this URL some other page?" -- while assignment needs the broader one.
 *
 * `tests/web/reserved-route-slugs.test.ts` walks the app directory and the
 * configured rewrites, and fails when a new one lands without being added here.
 */
export const LIVE_ROUTE_SLUGS = [
  "account",
  "claim",
  "discover",
  "discovery",
  "lookup",
  "mcp",
  "search",
  "sign-in",
  "sign-up",
  "submit",
  "support",
  "time",
  // Not a directory under `app`: `next.config.ts` installs a `beforeFiles` rewrite
  // proxying `/ingest/:path*` to PostHog, which runs ahead of the filesystem.
  "ingest",
] as const;

/**
 * Names that are unassignable but do not shadow `/<name>`.
 *
 * Two kinds live here. Directory prefixes -- `developers`, `events`, `handoff` --
 * have routes beneath them but no page of their own, so Next falls through to
 * `[slug]` and `/events` would happily serve a profile named `events`. They stay
 * unassignable anyway, because that profile's `/events/edit` would land in
 * `app/events/[slug]/edit` instead of its own editor.
 *
 * The rest are names for pages we may add.
 *
 * Unassignable, but nothing shadows them today, so a link to one is still a link
 * to whatever holds it. That distinction is the point of the split: `basicbit` is
 * a real profile, and treating it as a route made the support intake reject its
 * own canonical URL.
 */
/**
 * Directories that own everything *under* a name without serving the name itself.
 *
 * `/events` falls through to `[slug]` and renders a profile called `events` quite
 * happily. `/events/edit` does not: `app/events/[slug]/edit` matches it first, so
 * that profile's owner reaches the event editor for an event slugged `edit`. Same
 * for `/handoff/calendar.ics` and the rest.
 *
 * Unassignable for that reason, and reported by `slugAudit` separately from live
 * routes, because the failure is different: the public page still works and only
 * the owner-facing subpaths are gone.
 */
export const ROUTE_PREFIX_SLUGS = [
  "api",
  "developers",
  "events",
  "handoff",
  "l",
  "oauth",
  "playwright",
  "privacy",
] as const;

export const HELD_ROUTE_SLUGS = [
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
  "deployment",
  "developer",
  "dmca",
  "docs",
  "download",
  "downloads",
  "embed",
  "event",
  "explore",
  "faq",
  "favicon",
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
  "manifest",
  "map",
  "media",
  "moderation",
  "new",
  "news",
  "notifications",
  "onboarding",
  "opensearch",
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
  "robots",
  "rss",
  "security",
  "settings",
  "signin",
  "signout",
  "signup",
  "sitemap",
  "sponsors",
  "static",
  "stats",
  "status",
  "store",
  "team",
  "terms",
  "tos",
  "trending",
  "upgrade",
  "upload",
  "verify",
  "well-known",
  "widget",
  "world",
  "worlds",
] as const;

/**
 * Short, generic, obviously-desirable names held back so they can be granted or
 * sold later rather than going to whoever registers first, plus the ones that are
 * simply ours.
 *
 * Withheld from self-serve, not from existence: an operator writing the slug
 * directly is how one gets claimed today, and a self-serve grant path can come
 * with the paid feature. Once granted, the name behaves like any other slug --
 * it resolves, and it parses out of a pasted link.
 *
 * Slugs under SLUG_MIN_LENGTH are already unassignable, which reserves the whole
 * one- and two-character space for the same purpose without listing it.
 */
export const RESERVED_PREMIUM_SLUGS = [
  "art",
  "artist",
  "bar",
  "basic",
  "basicbit",
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
  "vrdex",
] as const;

const LIVE_ROUTE_SLUG_SET = new Set<string>(LIVE_ROUTE_SLUGS);
const ROUTE_PREFIX_SLUG_SET = new Set<string>(ROUTE_PREFIX_SLUGS);
const RESERVED_SLUG_SET = new Set<string>([
  ...LIVE_ROUTE_SLUGS,
  ...ROUTE_PREFIX_SLUGS,
  ...HELD_ROUTE_SLUGS,
  ...RESERVED_PREMIUM_SLUGS,
]);

/** Not assignable by self-serve. Broader than what actually shadows a slug. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug);
}

/**
 * A real page answers to this, so no profile can.
 *
 * The check for read paths. A held name is not a route -- `basicbit` is a profile
 * and `pricing` is a page we have not built -- so refusing those when *reading* a
 * URL threw away identifiers for profiles that exist.
 */
/** Owns `/<slug>/...` without owning `/<slug>`, so the nested routes collide. */
export function isRoutePrefixSlug(slug: string): boolean {
  return ROUTE_PREFIX_SLUG_SET.has(slug);
}

export function isLiveRouteSlug(slug: string): boolean {
  return LIVE_ROUTE_SLUG_SET.has(slug);
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
