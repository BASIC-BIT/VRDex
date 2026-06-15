import type { Doc } from "./_generated/dataModel";
import { visibleProfileField, visibleProfileList } from "./_profileFieldVisibility";
import { optionalField, safeHttpsUrl } from "./_publicFields";
import { getProfileTrustLabel } from "./_profileStates";

function visibleHttpsProfileImage(
  profile: Doc<"profiles">,
  key: "avatarImageUrl" | "bannerImageUrl",
): string | undefined {
  return safeHttpsUrl(visibleProfileField(profile, key, profile[key], "profile_page"));
}

function publicProfileGenres(profile: Doc<"profiles">) {
  return visibleProfileList(profile, "genres", profile.genres ?? [], "profile_page").map((genre) => ({
    slug: genre.slug,
    displayName: genre.displayName,
    ...optionalField("displayLabel", genre.displayLabel),
    ...optionalField("featured", genre.featured === true ? true : undefined),
  }));
}

export function toPublicProfile(profile: Doc<"profiles">) {
  const source = profile.sourceAttribution
    ? {
        sourceType: "community" as const,
        label: "Community submitted",
        submittedAt: profile.sourceAttribution.submittedAt,
      }
    : undefined;
  const shared = {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    aliases: visibleProfileList(profile, "aliases", profile.aliases, "profile_page"),
    tags: visibleProfileList(profile, "tags", profile.tags, "profile_page"),
    genres: publicProfileGenres(profile),
    trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
    ...optionalField("source", source),
    outboundLinks: visibleProfileList(
      profile,
      "outboundLinks",
      profile.outboundLinks ?? [],
      "profile_page",
    ).flatMap((link) => {
      const linkUrl = safeHttpsUrl(link.url);

      if (linkUrl === undefined) {
        return [];
      }

      return [{ ...link, url: linkUrl }];
    }),
    ...optionalField(
      "headline",
      visibleProfileField(profile, "headline", profile.headline, "profile_page"),
    ),
    ...optionalField("bio", visibleProfileField(profile, "bio", profile.bio, "profile_page")),
    ...optionalField("about", visibleProfileField(profile, "about", profile.about, "profile_page")),
    ...optionalField("avatarImageUrl", visibleHttpsProfileImage(profile, "avatarImageUrl")),
    ...optionalField("bannerImageUrl", visibleHttpsProfileImage(profile, "bannerImageUrl")),
    ...optionalField("region", visibleProfileField(profile, "region", profile.region, "profile_page")),
    ...optionalField("timezone", visibleProfileField(profile, "timezone", profile.timezone, "profile_page")),
  };

  if (profile.profileType === "person") {
    return {
      ...shared,
      profileType: "person" as const,
      person: {
        ...optionalField(
          "pronouns",
          visibleProfileField(profile, "personPronouns", profile.person.pronouns, "profile_page"),
        ),
        roleTags: visibleProfileList(profile, "personRoleTags", profile.person.roleTags, "profile_page"),
      },
    };
  }

  return {
    ...shared,
    profileType: "community" as const,
    community: {
      ...optionalField(
        "subtype",
        visibleProfileField(profile, "communitySubtype", profile.community.subtype, "profile_page"),
      ),
      categoryTags: visibleProfileList(
        profile,
        "communityCategoryTags",
        profile.community.categoryTags,
        "profile_page",
      ),
    },
  };
}
