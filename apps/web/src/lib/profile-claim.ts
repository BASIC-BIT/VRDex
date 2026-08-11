export type ClaimEntrySource = "account" | "profile" | "search";
/** Outcome reported back by the Discord guild-verification callback route. */
export type DiscordVerifyStatus = "verified" | "declined" | "failed" | "unavailable" | null;
type ProfileRouteTarget = {
  hasPublicProfile: boolean;
  slug: string;
};

const claimEntrySources = new Set<ClaimEntrySource>(["account", "profile", "search"]);

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function profileClaimSlugFromInput(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  // `new URL` is trusted only for a real web scheme. It does not throw on
  // `localhost:3000/afterglow`: it reads `localhost:` as the scheme and hands back
  // the pathname `3000/afterglow`, so a scheme-less development URL claimed the
  // profile `3000`. Anything else is treated as scheme-less text below.
  const absolute = /^https?:\/\//i.test(trimmed) ? tryParseUrl(trimmed) : null;
  const path = absolute === null ? trimmed : `${absolute.pathname}${absolute.search}`;

  // Query and fragment are dropped before splitting rather than treated as path
  // separators. Once profiles moved to the site root the slug became the *first*
  // segment, so `/afterglow?ref=account` would otherwise parse as `ref=account`.
  const segments = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);

  // `/p/<slug>` and `/c/<slug>` are retired, but somebody can still paste an old
  // link or bookmark, and reading the slug out of one costs two lines.
  const isLegacyPair = (parts: string[]) =>
    (parts[0] === "p" || parts[0] === "c") && parts[1] !== undefined;

  // A scheme-less paste still leads with its host, and the host is not a path
  // segment. The old last-segment read happened to skip past it; reading the first
  // segment does not, so `vrdex.net/afterglow` resolved the profile `vrdex.net`.
  //
  // Recognised by length rather than by hostname. A profile path is one segment at
  // the root, or `p`/`c` plus one, so anything longer is carrying a host -- which
  // covers `vrdex.net`, `localhost:3000`, a portless `localhost`, and a single-label
  // `devbox` with one rule. Testing the host's *shape* instead missed every name
  // without a dot or colon in it.
  if (absolute === null && segments.length > (isLegacyPair(segments) ? 2 : 1)) {
    segments.shift();
  }

  if (isLegacyPair(segments)) {
    return segments[1] as string;
  }

  return segments[0] ?? "";
}

export function profileClaimPath(
  slug: string,
  source?: ClaimEntrySource,
): string {
  const path = `/claim/${encodeURIComponent(slug)}`;

  return source === undefined ? path : `${path}?source=${source}`;
}

export function ownerProfileDestinationPath(
  profile: ProfileRouteTarget,
  privateDestination: string,
): string {
  if (!profile.hasPublicProfile) {
    return privateDestination;
  }

  return `/${encodeURIComponent(profile.slug)}`;
}

const discordVerifyStatuses = new Set(["verified", "declined", "failed", "unavailable"]);

export function parseDiscordVerifyStatus(
  value: string | string[] | undefined,
): DiscordVerifyStatus {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate && discordVerifyStatuses.has(candidate)
    ? (candidate as NonNullable<DiscordVerifyStatus>)
    : null;
}

export function parseClaimEntrySource(value: string | string[] | undefined): ClaimEntrySource {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate && claimEntrySources.has(candidate as ClaimEntrySource)
    ? (candidate as ClaimEntrySource)
    : "profile";
}
