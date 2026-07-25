export type ClaimEntrySource = "account" | "profile" | "search";

const claimEntrySources = new Set<ClaimEntrySource>(["account", "profile", "search"]);

export function profileClaimPath(
  slug: string,
  source?: ClaimEntrySource,
): string {
  const path = `/claim/${encodeURIComponent(slug)}`;

  return source === undefined ? path : `${path}?source=${source}`;
}

export function parseClaimEntrySource(value: string | string[] | undefined): ClaimEntrySource {
  const candidate = Array.isArray(value) ? value[0] : value;

  return candidate && claimEntrySources.has(candidate as ClaimEntrySource)
    ? (candidate as ClaimEntrySource)
    : "profile";
}
