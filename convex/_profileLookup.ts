import type { Doc } from "./_generated/dataModel";
import { toPublicProfile } from "./_profilePublic";

type PublicProfile = ReturnType<typeof toPublicProfile>;
type PublicProfileLink = PublicProfile["outboundLinks"][number];

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

function profileLookupLinkRank(link: PublicProfileLink): number {
  const index = PROFILE_LOOKUP_LINK_PRIORITY.indexOf(link.type as (typeof PROFILE_LOOKUP_LINK_PRIORITY)[number]);

  return index === -1 ? PROFILE_LOOKUP_LINK_PRIORITY.length : index;
}

export function sortProfileLookupLinks(links: PublicProfileLink[]): PublicProfileLink[] {
  return [...links].sort((first, second) => {
    const rankDelta = profileLookupLinkRank(first) - profileLookupLinkRank(second);

    return rankDelta || first.label.localeCompare(second.label) || first.url.localeCompare(second.url);
  });
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function toProfileLookupResult(profile: Doc<"profiles">) {
  const publicProfile = toPublicProfile(profile);

  if (publicProfile.profileType !== "person") {
    return null;
  }

  const headline = optionalStringField("headline" in publicProfile ? publicProfile.headline : undefined);
  const bio = optionalStringField("bio" in publicProfile ? publicProfile.bio : undefined);
  const avatarImageUrl = optionalStringField("avatarImageUrl" in publicProfile ? publicProfile.avatarImageUrl : undefined);
  const region = optionalStringField("region" in publicProfile ? publicProfile.region : undefined);
  const timezone = optionalStringField("timezone" in publicProfile ? publicProfile.timezone : undefined);

  return {
    slug: publicProfile.slug,
    displayName: publicProfile.displayName,
    profilePath: `/p/${publicProfile.slug}`,
    aliases: publicProfile.aliases,
    tags: publicProfile.tags,
    genres: publicProfile.genres,
    roleTags: publicProfile.person.roleTags,
    trustLabel: publicProfile.trustLabel,
    ...(headline === undefined ? {} : { headline }),
    ...(bio === undefined ? {} : { bio }),
    ...(avatarImageUrl === undefined ? {} : { avatarImageUrl }),
    ...(region === undefined ? {} : { region }),
    ...(timezone === undefined ? {} : { timezone }),
    outboundLinks: sortProfileLookupLinks(publicProfile.outboundLinks),
  };
}
