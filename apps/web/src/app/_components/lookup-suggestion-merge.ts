import type {
  PrivateSeedLookupResult,
  ProfileLookupDisplayResult,
  PublicProfileLookupResult,
} from "./profile-lookup-page";

const CASE_INSENSITIVE_PATH_HOSTS = new Set(["twitch.tv"]);
/**
 * Link types whose URL names one account, whatever path it carries.
 *
 * A VRCDN stream id, a Twitch channel, and a VRChat user id each belong to one
 * person, so two rows sharing one are that person twice. Held to an allowlist
 * rather than a list of exclusions because everything else can be posted by
 * more than one person: a venue's Discord invite, a crew's site, the literal
 * `https://discord.com/` every Discord handle stores as its URL, and media
 * links -- a YouTube video, a Spotify track, a SoundCloud set -- which are
 * validated by host and can be a recording two DJs both link rather than
 * either one's account. Those still need the display name to match.
 */
const ACCOUNT_LINK_TYPES = new Set(["vrcdn", "twitch", "vrchat_profile"]);

type LookupUrlSets = { all: Set<string>; identity: Set<string> };

function normalizeIdentityText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLookupUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    const hostname = url.hostname.toLowerCase();
    url.hostname = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    if (CASE_INSENSITIVE_PATH_HOSTS.has(url.hostname)) {
      url.pathname = url.pathname.toLowerCase();
    }
    return url.toString();
  } catch {
    return null;
  }
}

function collectLookupUrls(links: Array<{ type?: unknown; url: string }>): LookupUrlSets {
  const all = new Set<string>();
  const identity = new Set<string>();

  for (const link of links) {
    const normalized = normalizeLookupUrl(link.url);

    if (!normalized) {
      continue;
    }

    all.add(normalized);

    // A link with no type recorded stays out of the identity set. An untyped
    // link is the weaker claim, and over-merging removes a person outright.
    if (typeof link.type === "string" && ACCOUNT_LINK_TYPES.has(link.type)) {
      identity.add(normalized);
    }
  }

  return { all, identity };
}

function privateSeedOutboundUrls(profile: PrivateSeedLookupResult): LookupUrlSets {
  return collectLookupUrls(
    profile.fields.flatMap((field) => {
      if (field.fieldKey !== "outboundLinks" || !Array.isArray(field.value)) {
        return [];
      }

      return field.value.flatMap((link) => (
        typeof link === "object" && link !== null && "url" in link && typeof link.url === "string"
          ? [{ type: "type" in link ? link.type : undefined, url: link.url }]
          : []
      ));
    }),
  );
}

export function mergeLookupSuggestions(
  publicResults: PublicProfileLookupResult[],
  privateResults: PrivateSeedLookupResult[],
): ProfileLookupDisplayResult[] {
  const publicSlugs = new Set(publicResults.map((profile) => normalizeIdentityText(profile.slug)));
  const publicIdentities = publicResults.map((profile) => ({
    names: new Set([profile.displayName, ...profile.aliases].map(normalizeIdentityText)),
    urls: collectLookupUrls(profile.outboundLinks),
  }));
  const uniquePrivateResults = privateResults.filter((profile) => {
    // The slug a candidate published to, or failing that the one it proposed,
    // names the row beside it outright.
    //
    // A published candidate is *expected* to have a public row: it made one.
    // Exempting published candidates from deduplication entirely was the fix for
    // dropping them, which had hidden 405 published people from this lookup --
    // but a person is only hidden while nothing else lists them. When the profile
    // a candidate published to is right there, removing the candidate leaves the
    // person on screen and stops listing them twice: once with the profile's
    // avatar, once as the candidate's bare name. That pair, for every published
    // seed, is what the lookup was reported as duplicating. A published candidate
    // whose profile is *not* among the results still gets its own row.
    //
    // Only one slug, not both: publishing to a matched profile leaves the
    // proposal stale, and a stale proposal can name a *different* profile that
    // publishing allowed to keep the slug. Reading it for a published candidate
    // would drop that candidate against a row belonging to somebody else.
    const linkedSlug = profile.publishedProfileSlug ?? profile.proposedSlug;

    if (linkedSlug && publicSlugs.has(normalizeIdentityText(linkedSlug))) {
      return false;
    }

    const displayName = normalizeIdentityText(profile.displayName);
    const privateUrls = privateSeedOutboundUrls(profile);

    return !publicIdentities.some((publicProfile) => (
      // An account somebody holds is identity enough on its own. Seed lists spell
      // the same DJ "A Roomba" and "A_Roomba", and requiring the name to match
      // too split one person across two rows over an underscore.
      [...privateUrls.identity].some((url) => publicProfile.urls.identity.has(url)) ||
      (
        publicProfile.names.has(displayName) &&
        [...privateUrls.all].some((url) => publicProfile.urls.all.has(url))
      )
    ));
  });

  return [...publicResults, ...uniquePrivateResults];
}
