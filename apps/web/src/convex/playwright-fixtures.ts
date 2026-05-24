import type { PublicProfile } from "@/app/_components/profile-public-page";

const personSlug = "playwright-dj-aurora";
const communitySlug = "playwright-afterglow-social";

const personProfile: PublicProfile = {
  profileType: "person",
  slug: personSlug,
  displayName: "DJ Aurora",
  aliases: ["Aurora", "Auralight"],
  tags: ["DJ", "Melodic House", "EU"],
  headline: "Melodic house sets for late-night VRChat floors.",
  bio: "DJ Aurora is a fixture profile for VRDex visual review. It gives the public person page stable content, trust-state copy, tags, aliases, and owner-authored text to render.",
  about: "This profile is returned only when Playwright fixture mode is explicitly enabled for the Next.js server.",
  region: "EU",
  timezone: "UTC+1",
  trustLabel: "community_submitted",
  person: {
    pronouns: "she/they",
    roleTags: ["DJ", "Producer", "Host"],
  },
};

const communityProfile: PublicProfile = {
  profileType: "community",
  slug: communitySlug,
  displayName: "Afterglow Social",
  aliases: ["Afterglow", "AGS"],
  tags: ["Club", "Weekend", "Friends"],
  headline: "A warm VRChat club night for music-first communities.",
  bio: "Afterglow Social is a deterministic fixture community used by Playwright to keep the public community profile route visible in PR screenshot artifacts.",
  about: "The seeded page exercises community subtype, category tags, aliases, and the community-submitted trust label without depending on production data.",
  region: "Global",
  timezone: "UTC",
  trustLabel: "community_submitted",
  community: {
    subtype: "Club night",
    categoryTags: ["Music", "Dancing", "Social"],
  },
};

export function getPlaywrightPublicProfileFixture(
  slug: string,
  profileType: "person" | "community",
): PublicProfile | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return null;
  }

  if (profileType === "person" && slug === personSlug) {
    return personProfile;
  }

  if (profileType === "community" && slug === communitySlug) {
    return communityProfile;
  }

  return null;
}

export const playwrightPublicProfilePaths = {
  personPath: `/p/${personSlug}`,
  communityPath: `/c/${communitySlug}`,
};
