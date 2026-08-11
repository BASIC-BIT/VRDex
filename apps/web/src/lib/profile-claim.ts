export type ClaimEntrySource = "account" | "profile" | "search";
/** Outcome reported back by the Discord guild-verification callback route. */
export type DiscordVerifyStatus = "verified" | "declined" | "failed" | "unavailable" | null;
type ProfileRouteTarget = {
  hasPublicProfile: boolean;
  slug: string;
};

const claimEntrySources = new Set<ClaimEntrySource>(["account", "profile", "search"]);

export function profileClaimSlugFromInput(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  let path = trimmed;

  try {
    path = new URL(trimmed).pathname;
  } catch {
    // Bare slugs and relative profile paths are valid legacy inputs.
  }

  // Query and fragment are dropped before splitting rather than treated as path
  // separators. Once profiles moved to the site root the slug became the *first*
  // segment, so `/afterglow?ref=account` would otherwise parse as `ref=account`.
  const segments = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);

  // `/p/<slug>` and `/c/<slug>` are retired, but somebody can still paste an old
  // link or bookmark, and reading the slug out of one costs two lines.
  if ((segments[0] === "p" || segments[0] === "c") && segments[1]) {
    return segments[1];
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
