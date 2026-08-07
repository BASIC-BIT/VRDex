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
export function readProfileSlugFromInput(raw: string, siteUrl?: string): string {
  return readProfileReferenceFromInput(raw, siteUrl).slug;
}

export type ProfileReference = {
  slug: string;
  /** Read off the route, so `null` means the input never named one. */
  profileType: "person" | "community" | null;
};

/**
 * The slug *and* the kind of profile the input names.
 *
 * The route carries the type and the slug alone throws it away. That mattered
 * more than it looks: a pre-claim safety request for a community that does not
 * exist yet has no stored profile to correct a wrong guess, and the form's
 * selector defaults to `person`. An accepted suppression recorded that way is
 * skipped by `hasAcceptedSuppression`'s type check, so the very listing someone
 * asked to be kept down could still be published.
 */
/** A host that names this machine rather than a deployment. */
function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * The hosted VRDex origins, which are two spellings of one deployment.
 *
 * Named rather than derived. Deriving `www.` for whatever host was configured
 * trusted a sibling nobody said was ours: a self-hoster at
 * `https://tenant.example.com` had `https://www.tenant.example.com` accepted
 * too, and if that belongs to someone else its links resolved against this
 * instance. VRDex production genuinely binds both -- Vercel project domains and
 * Route 53 records for the apex and the www name, in
 * `infra/terraform/web-domains` -- so that pair is a fact about this
 * deployment and is written down as one.
 */
const HOSTED_ORIGIN_ALIASES: ReadonlyArray<readonly string[]> = [
  ["https://vrdex.net", "https://www.vrdex.net"],
];

/**
 * Every origin whose `/p/` and `/c/` paths are this deployment's.
 *
 * Whole origins, not hostnames pulled out of them. Comparing only the hostname
 * discarded the port, so a self-hosted deployment at `https://example.test:8443`
 * accepted a link from `https://example.test:9999` -- a different service on the
 * same machine -- and resolved its path here.
 *
 * The `www` sibling is included because production binds both: the apex and the
 * www domain each have Vercel project-domain bindings and Route 53 records, so
 * a visitor reading their profile at either one pastes what their address bar
 * shows.
 */
function allowedOrigins(siteUrl: string): Set<string> {
  try {
    const origin = new URL(siteUrl).origin.toLowerCase();
    const aliases = HOSTED_ORIGIN_ALIASES.find((group) => group.includes(origin));

    return new Set(aliases ?? [origin]);
  } catch {
    return new Set();
  }
}

/**
 * Whether a pasted link's origin is one of this deployment's.
 *
 * `host` carries the port when the URL had one, and is compared as part of the
 * origin rather than stripped down to a name.
 *
 * Loopback is accepted only where the deployment is itself loopback, or where
 * no origin is configured at all. Accepting it unconditionally meant a hosted
 * deployment resolved `http://localhost/p/x` against its own data, so a pasted
 * development URL named a production profile.
 */
function isDeploymentHost(
  host: string,
  scheme: string | undefined,
  siteUrl: string | undefined,
): boolean {
  if (siteUrl === undefined) {
    return isLoopbackHost(host);
  }

  const allowed = allowedOrigins(siteUrl);

  if (allowed.size === 0) {
    return false;
  }

  // A scheme-less paste carries no origin, so it is matched on host and port
  // against the origins that are allowed.
  if (scheme === undefined) {
    const hosts = new Set([...allowed].map((origin) => new URL(origin).host.toLowerCase()));

    return hosts.has(host.toLowerCase());
  }

  return allowed.has(`${scheme.toLowerCase()}//${host.toLowerCase()}`);
}

export function readProfileReferenceFromInput(
  raw: string,
  siteUrl?: string,
): ProfileReference {
  const trimmed = raw.trim();
  const none: ProfileReference = { slug: "", profileType: null };

  if (trimmed === "") {
    return none;
  }

  // Read by path, not by hostname. Requiring a dotted host rejected the profile
  // URL of every localhost and loopback deployment, so a self-hosted instance
  // could not paste the link its own form asks for.
  const path = profileUrlPath(trimmed, siteUrl);

  if (path !== null) {
    // Only the two routes that actually name a profile. Any host used to
    // qualify, so a requester pasting the evidence for their dispute -- a
    // VRChat page, a Discord invite, a post -- had its last path segment
    // normalized into a slug-shaped string that passes validation and points at
    // some other profile, or none. The digest then aimed an operator at the
    // wrong record while the URL they actually meant was discarded.
    // Anchored past the slug. Unanchored, `/p/dj-aurora/somewhere-else`
    // matched and reported `dj-aurora`, so a URL that does not resolve to the
    // profile page silently named a real profile anyway -- the same substitution
    // the segment validation above exists to stop, one path segment further
    // along. A trailing slash, query, or fragment still belongs to the route.
    // Case-sensitive, unlike the scheme and host above it. Only `/p` and `/c`
    // are routes, so `/P/dj-aurora` is a 404 and names no profile -- accepting
    // it resolved the real lowercase-route listing from a link that does not
    // work, which is the same rescue the segment case check already refuses.
    const profilePath = /^\/(p|c)\/([^/?#]+)\/?(?:[?#].*)?$/.exec(path);

    if (profilePath === null) {
      return none;
    }

    // Validated as written, not normalized into shape. Slug generation maps
    // `dj_aurora` onto `dj-aurora`, so a pasted URL naming one thing quietly
    // resolved to a different real listing, and the digest then showed the
    // substitute while discarding the URL actually given. A link is a precise
    // identifier or it is nothing.
    //
    // Percent-encoding is the one exception, because a browser may hand back an
    // encoded path for the same address.
    //
    // Case is not. `/p/DJ-Aurora` is a 404 on the site, since the public route
    // validates the segment as written, so lowercasing it here resolved a real
    // profile from a link that does not work -- and on a suppression stored that
    // profile's id, showing the operator a valid target the requester never
    // reached.
    const segment = decodeUrlSegment(profilePath[2]);

    return PROFILE_SLUG_PATTERN.test(segment)
      ? {
          slug: segment,
          profileType: profilePath[1] === "c" ? "community" : "person",
        }
      : none;
  }

  // A bare word, typed rather than pasted. Slashes here would mean a path
  // fragment with no host, which names no profile either. No type: a slug on
  // its own says nothing about which route it belongs to.
  return trimmed.includes("/")
    ? none
    : { slug: normalizeProfileSlugInput(trimmed), profileType: null };
}

/** A path segment as typed, or unchanged when it is not valid encoding. */
function decodeUrlSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The path of `input` when it is a URL, or `null` when it is not one. */
function profileUrlPath(input: string, siteUrl: string | undefined): string | null {
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);

      return isDeploymentHost(url.host, url.protocol, siteUrl)
        ? `${url.pathname}${url.search}`
        : null;
    } catch {
      return null;
    }
  }

  // Scheme-less, which is how most people paste a link. Only a dotted host is
  // recognizable without one: `localhost/p/x` cannot be told apart from a
  // relative path, and guessing would swallow real paths.
  const hostless = /^([^/\s]+\.[^/\s]+)(\/.*)?$/i.exec(input);

  if (hostless === null) {
    return null;
  }

  return isDeploymentHost(hostless[1], undefined, siteUrl) ? (hostless[2] ?? "") : null;
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
export function resolveRequestedProfile(
  raw: string | undefined,
  siteUrl?: string,
): ProfileReference | undefined {
  const trimmed = (raw ?? "").trim();
  const reference = readProfileReferenceFromInput(trimmed, siteUrl);

  if (reference.slug === "") {
    if (trimmed !== "") {
      throw supportInputError(INVALID_PROFILE_INPUT_MESSAGE);
    }

    return undefined;
  }

  const validation = validateProfileSlug(reference.slug);

  if (!validation.ok) {
    throw supportInputError(INVALID_PROFILE_INPUT_MESSAGE);
  }

  return { slug: validation.slug, profileType: reference.profileType };
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

/**
 * The profile a request named, or `null` when the slug finds a different kind.
 *
 * Slugs are unique across both entity types, so `/c/foo` resolves the person
 * holding `foo` just as happily as a community would. Storing that profile's id
 * meant an accepted opt-out for a community retracted a person instead, since
 * the acceptance resolver trusts a stored id unconditionally. A pasted route is
 * an assertion about which kind was meant, and one that disagrees with the
 * record resolves to nothing rather than to the wrong thing.
 */
export async function getRequestedProfile(
  db: DatabaseReader,
  requested: ProfileReference | undefined,
) {
  if (requested === undefined) {
    return null;
  }

  const profile = await getProfileBySlug(db, requested.slug);

  if (profile === null) {
    return null;
  }

  return requested.profileType === null || requested.profileType === profile.profileType
    ? profile
    : null;
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
