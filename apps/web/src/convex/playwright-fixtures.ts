import type { PublicProfile } from "@/app/_components/profile-public-page";
import type { PublicActiveWorld } from "@/app/_components/home-active-worlds";
import type { PublicWorld } from "@/app/_components/world-public-page";

const personSlug = "playwright-dj-aurora";
const communitySlug = "playwright-afterglow-social";
const worldSlug = "playwright-neon-harbor";

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
  outboundLinks: [
    {
      type: "kofi",
      label: "DJ Aurora Ko-fi",
      url: "https://example.invalid/dj-aurora-kofi",
      source: "owner_authored",
    },
    {
      type: "commissions",
      label: "Booking inquiries",
      url: "https://example.invalid/dj-aurora-bookings",
      source: "reviewed",
    },
  ],
  worldCredits: [
    {
      slug: worldSlug,
      displayName: "Neon Harbor",
      roles: ["media_credit"],
      tags: ["Club world", "Cyberpunk", "Dance floor"],
      summary: "A fixture VRChat venue page for world discovery visual review.",
      sourceLabel: "Fixture attribution",
    },
  ],
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
  outboundLinks: [
    {
      type: "website",
      label: "Afterglow event archive",
      url: "https://example.invalid/afterglow-events",
      source: "owner_authored",
    },
  ],
  worldCredits: [
    {
      slug: worldSlug,
      displayName: "Neon Harbor",
      roles: ["world_author"],
      tags: ["Club world", "Cyberpunk", "Dance floor"],
      summary: "A fixture VRChat venue page for world discovery visual review.",
      sourceLabel: "Fixture attribution",
    },
  ],
  community: {
    subtype: "Club night",
    categoryTags: ["Music", "Dancing", "Social"],
  },
};

const worldProfile: PublicWorld = {
  slug: worldSlug,
  displayName: "Neon Harbor",
  tags: ["Club world", "Cyberpunk", "Dance floor"],
  summary: "A fixture VRChat venue page for world discovery visual review.",
  description:
    "Neon Harbor is a deterministic fixture world used to exercise world metadata, creator attribution, public VRChat links, and owner-authored creator commerce links.",
  vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
  canonicalVrchatWorldUrl:
    "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
  sourceUrl: "https://vrchat.com/home/world/wrld_00000000-0000-4000-8000-000000000001",
  visibilityStatus: "public",
  platformCompatibility: ["pc", "android"],
  creatorAttributions: [
    {
      role: "world_author",
      displayName: "Afterglow Social",
      profileSlug: communitySlug,
      profileType: "community",
      sourceLabel: "Fixture attribution",
    },
    {
      role: "media_credit",
      displayName: "DJ Aurora",
      profileSlug: personSlug,
      profileType: "person",
      sourceLabel: "Fixture attribution",
    },
  ],
  media: [],
  outboundLinks: [
    {
      type: "gumroad",
      label: "Example prefab pack",
      url: "https://example.invalid/neon-harbor-prefab",
      source: "owner_authored",
    },
    {
      type: "commissions",
      label: "World commissions",
      url: "https://example.invalid/world-commissions",
      source: "reviewed",
    },
  ],
  source: {
    sourceType: "owner",
    label: "Fixture owner-authored metadata",
    confirmedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
  },
  eventContext: {
    upcoming: [
      {
        title: "Afterglow Harbor Sessions",
        startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
        endAt: Date.UTC(2026, 5, 15, 1, 0, 0),
        timezone: "UTC",
        communityName: "Afterglow Social",
        summary: "A fixture venue night that keeps world-event context visible in screenshots.",
        source: {
          sourceType: "manual",
          label: "Fixture event listing",
          url: "https://example.invalid/events/afterglow-harbor-sessions",
        },
        worldAssociation: {
          sourceType: "manual",
          confirmationState: "confirmed",
          confirmedAt: Date.UTC(2026, 4, 1, 12, 0, 0),
        },
      },
    ],
    recent: [
      {
        title: "Neon Harbor Opening Night",
        startAt: Date.UTC(2026, 3, 18, 23, 0, 0),
        timezone: "UTC",
        communityName: "Afterglow Social",
        summary: "A past fixture event used to exercise recent world activity presentation.",
        source: {
          sourceType: "community",
          label: "Community-submitted event",
        },
        worldAssociation: {
          sourceType: "community",
          confirmationState: "confirmed",
          confirmedAt: Date.UTC(2026, 3, 1, 12, 0, 0),
        },
      },
    ],
  },
};

const activeWorlds: PublicActiveWorld[] = [
  {
    slug: worldSlug,
    displayName: "Neon Harbor",
    tags: ["Club world", "Cyberpunk", "Dance floor"],
    summary: "A fixture VRChat venue page for world discovery visual review.",
    upcomingEventCount: 2,
    activityLabel: "Hosting upcoming events",
    nextEvent: {
      title: "Afterglow Harbor Sessions",
      startAt: Date.UTC(2026, 5, 14, 22, 0, 0),
      timezone: "UTC",
      communityName: "Afterglow Social",
      source: {
        sourceType: "manual",
        label: "Fixture event listing",
        url: "https://example.invalid/events/afterglow-harbor-sessions",
      },
    },
  },
];

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

export function getPlaywrightPublicWorldFixture(slug: string): PublicWorld | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return null;
  }

  if (slug === worldSlug) {
    return worldProfile;
  }

  return null;
}

export function getPlaywrightActiveWorldFixtures(): PublicActiveWorld[] | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return null;
  }

  return activeWorlds;
}

export const playwrightPublicProfilePaths = {
  personPath: `/p/${personSlug}`,
  communityPath: `/c/${communitySlug}`,
  worldPath: `/w/${worldSlug}`,
};
