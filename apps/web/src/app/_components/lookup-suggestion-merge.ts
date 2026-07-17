import type {
  PrivateSeedLookupResult,
  ProfileLookupDisplayResult,
  PublicProfileLookupResult,
} from "./profile-lookup-page";

function normalizeIdentityText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLookupUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function privateSeedOutboundUrls(profile: PrivateSeedLookupResult): Set<string> {
  const urls = new Set<string>();

  for (const field of profile.fields) {
    if (field.fieldKey !== "outboundLinks" || !Array.isArray(field.value)) {
      continue;
    }

    for (const link of field.value) {
      if (typeof link !== "object" || link === null || !("url" in link) || typeof link.url !== "string") {
        continue;
      }

      const normalized = normalizeLookupUrl(link.url);
      if (normalized) {
        urls.add(normalized);
      }
    }
  }

  return urls;
}

export function mergeLookupSuggestions(
  publicResults: PublicProfileLookupResult[],
  privateResults: PrivateSeedLookupResult[],
): ProfileLookupDisplayResult[] {
  const publicSlugs = new Set(publicResults.map((profile) => normalizeIdentityText(profile.slug)));
  const publicIdentities = publicResults.map((profile) => ({
    names: new Set([profile.displayName, ...profile.aliases].map(normalizeIdentityText)),
    urls: new Set(
      profile.outboundLinks
        .map((link) => normalizeLookupUrl(link.url))
        .filter((url): url is string => url !== null),
    ),
  }));
  const uniquePrivateResults = privateResults.filter((profile) => {
    if (profile.proposedSlug && publicSlugs.has(normalizeIdentityText(profile.proposedSlug))) {
      return false;
    }

    const displayName = normalizeIdentityText(profile.displayName);
    const privateUrls = privateSeedOutboundUrls(profile);

    return !publicIdentities.some((publicProfile) => (
      publicProfile.names.has(displayName) &&
      [...privateUrls].some((url) => publicProfile.urls.has(url))
    ));
  });

  return [...publicResults, ...uniquePrivateResults];
}
