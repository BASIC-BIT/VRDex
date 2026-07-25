import type { Doc } from "./_generated/dataModel";
import { visibleProfileField, visibleProfileList } from "./_profileFieldVisibility";
import { optionalField, safeHttpsUrl } from "./_publicFields";
import { getProfileTrustLabel } from "./_profileStates";

type ProfileLookupLink = NonNullable<Doc<"profiles">["outboundLinks"]>[number] & { url: string };
type ProfileLookupGenre = NonNullable<Doc<"profiles">["genres"]>[number];

const PROFILE_LOOKUP_LINK_PRIORITY = [
  "vrchat_profile",
  "discord",
  "website",
  "vrcdn",
  "soundcloud",
  "mixcloud",
  "twitch",
  "youtube",
  "spotify",
  "bandcamp",
  "instagram",
  "linktree",
  "commissions",
  "kofi",
  "patreon",
  "gumroad",
  "jinxxy",
  "payhip",
  "woocommerce",
  "generic_store",
  "other",
] as const;

function profileLookupLinkRank(link: ProfileLookupLink): number {
  const index = PROFILE_LOOKUP_LINK_PRIORITY.indexOf(link.type as (typeof PROFILE_LOOKUP_LINK_PRIORITY)[number]);

  return index === -1 ? PROFILE_LOOKUP_LINK_PRIORITY.length : index;
}

export function sortProfileLookupLinks(links: ProfileLookupLink[]): ProfileLookupLink[] {
  return [...links].sort((first, second) => {
    const rankDelta = profileLookupLinkRank(first) - profileLookupLinkRank(second);

    return rankDelta || first.label.localeCompare(second.label) || first.url.localeCompare(second.url);
  });
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function publicLookupGenres(profile: Doc<"profiles">) {
  return visibleProfileList(profile, "genres", profile.genres ?? [], "discovery").map(
    (genre: ProfileLookupGenre) => ({
      slug: genre.slug,
      displayName: genre.displayName,
      ...optionalField("displayLabel", genre.displayLabel),
      ...optionalField("featured", genre.featured === true ? true : undefined),
    }),
  );
}

function publicLookupLinks(profile: Doc<"profiles">): ProfileLookupLink[] {
  return visibleProfileList(profile, "outboundLinks", profile.outboundLinks ?? [], "discovery").flatMap(
    (link) => {
      const linkUrl = safeHttpsUrl(link.url);

      if (linkUrl === undefined) {
        return [];
      }

      return [{ ...link, url: linkUrl }];
    },
  );
}

export function toProfileLookupResult(
  profile: Doc<"profiles">,
  options: {
    avatarImageUrl?: string;
    sourceLabel?: string;
  } = {},
) {
  if (profile.profileType !== "person") {
    return null;
  }

  const headline = optionalStringField(visibleProfileField(profile, "headline", profile.headline, "discovery"));
  const bio = optionalStringField(visibleProfileField(profile, "bio", profile.bio, "discovery"));
  const avatarImageUrl =
    safeHttpsUrl(options.avatarImageUrl) ??
    safeHttpsUrl(visibleProfileField(profile, "avatarImageUrl", profile.avatarImageUrl, "discovery"));
  const region = optionalStringField(visibleProfileField(profile, "region", profile.region, "discovery"));
  const timezone = optionalStringField(
    visibleProfileField(profile, "timezone", profile.timezone, "discovery"),
  );

  return {
    slug: profile.slug,
    displayName: profile.displayName,
    profilePath: `/p/${profile.slug}`,
    aliases: visibleProfileList(profile, "aliases", profile.aliases, "discovery"),
    tags: visibleProfileList(profile, "tags", profile.tags, "discovery"),
    genres: publicLookupGenres(profile),
    roleTags: visibleProfileList(profile, "personRoleTags", profile.person.roleTags, "discovery"),
    trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
    ...(options.sourceLabel === undefined ? {} : { sourceLabel: options.sourceLabel }),
    ...(headline === undefined ? {} : { headline }),
    ...(bio === undefined ? {} : { bio }),
    ...(avatarImageUrl === undefined ? {} : { avatarImageUrl }),
    ...(region === undefined ? {} : { region }),
    ...(timezone === undefined ? {} : { timezone }),
    outboundLinks: sortProfileLookupLinks(publicLookupLinks(profile)),
  };
}
