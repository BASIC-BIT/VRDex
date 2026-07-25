export type ClaimEntrySource = "account" | "profile" | "search";

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

  const segments = path.split(/[/?#]/).filter(Boolean);

  if ((segments[0] === "p" || segments[0] === "c") && segments[1]) {
    return segments[1];
  }

  return segments.at(-1) ?? "";
}

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
