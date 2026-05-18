import type { Doc } from "./_generated/dataModel";
import { getProfileTrustLabel } from "./_profileStates";

function optionalField<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

export function toPublicProfile(profile: Doc<"profiles">) {
  const shared = {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    aliases: profile.aliases,
    tags: profile.tags,
    creationSource: profile.creationSource,
    trustLabel: getProfileTrustLabel(profile.claimState, profile.creationSource),
    ...optionalField("headline", profile.headline),
    ...optionalField("bio", profile.bio),
    ...optionalField("about", profile.about),
    ...optionalField("avatarImageUrl", profile.avatarImageUrl),
    ...optionalField("bannerImageUrl", profile.bannerImageUrl),
    ...optionalField("region", profile.region),
    ...optionalField("timezone", profile.timezone),
  };

  if (profile.profileType === "person") {
    return {
      ...shared,
      profileType: "person" as const,
      person: {
        ...optionalField("pronouns", profile.person.pronouns),
        roleTags: profile.person.roleTags,
      },
    };
  }

  return {
    ...shared,
    profileType: "community" as const,
    community: {
      ...optionalField("subtype", profile.community.subtype),
      categoryTags: profile.community.categoryTags,
    },
  };
}
