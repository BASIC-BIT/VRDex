import type { PublicProfile } from "@/app/_components/profile-public-page";
import type { PublicActiveWorld } from "@/app/_components/home-active-worlds";
import type {
  PublicDiscoveryData,
  PublicSearchResult,
} from "@/app/_components/discovery-public-page";
import type { PublicEvent } from "@/app/_components/event-public-page";
import type { PublicWorld } from "@/app/_components/world-public-page";

const personSlug = "playwright-dj-aurora";
const communitySlug = "playwright-afterglow-social";
const worldSlug = "playwright-neon-harbor";
const eventSlug = "playwright-afterglow-harbor-sessions";
const eventWatchSlug = "playwright-afterglow-watch-room";
const eventTimezone = "America/New_York";
const eventDoorsOpenAt = Date.UTC(2026, 5, 15, 1, 30, 0);
const eventStartAt = Date.UTC(2026, 5, 15, 2, 0, 0);
const eventEndAt = Date.UTC(2026, 5, 15, 5, 0, 0);
const firstSlotEndAt = Date.UTC(2026, 5, 15, 2, 45, 0);
const secondSlotStartAt = Date.UTC(2026, 5, 15, 2, 45, 0);
const secondSlotEndAt = Date.UTC(2026, 5, 15, 3, 30, 0);
const watchEventDoorsOpenAt = Date.UTC(2025, 0, 1, 11, 30, 0);
const watchEventStartAt = Date.UTC(2025, 0, 1, 12, 0, 0);
const watchEventEndAt = Date.UTC(2025, 0, 1, 15, 0, 0);
const watchFirstSlotEndAt = Date.UTC(2025, 0, 1, 12, 45, 0);
const watchSecondSlotStartAt = Date.UTC(2025, 0, 1, 12, 45, 0);
const watchSecondSlotEndAt = Date.UTC(2025, 0, 1, 13, 30, 0);

const eventPreview = {
  slug: eventSlug,
  title: "Afterglow Harbor Sessions",
  startAt: eventStartAt,
  doorsOpenAt: eventDoorsOpenAt,
  endAt: eventEndAt,
  timezone: eventTimezone,
  communityName: "Afterglow Social",
  communitySlug,
  summary: "Late-night harbor club session with house, trance, and warm social energy.",
  posterImageUrl: "https://example.invalid/events/afterglow-harbor-poster.png",
  source: {
    sourceType: "manual" as const,
    label: "Afterglow event listing",
    url: "https://example.invalid/events/afterglow-harbor-sessions",
  },
  worlds: [
    {
      slug: worldSlug,
      displayName: "Neon Harbor",
    },
  ],
  participantCount: 1,
  slotCount: 2,
};

const personProfile: PublicProfile = {
  profileType: "person",
  slug: personSlug,
  displayName: "DJ Aurora",
  aliases: ["Aurora", "Auralight"],
  tags: ["DJ", "Melodic House", "EU"],
  headline: "Melodic house sets for late-night VRChat floors.",
  bio: "Melodic house DJ playing warm, vocal-led sets across VRChat club nights.",
  about: "Known for sunrise handoffs, soft-focus visuals, and long blends that keep the room moving.",
  region: "EU",
  timezone: "UTC+1",
  trustLabel: "community_submitted",
  source: {
    sourceType: "community",
    label: "Community submitted",
    submittedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
  },
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
      summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
      sourceLabel: "Community credit",
    },
  ],
  upcomingEvents: [eventPreview],
  hostedEvents: [],
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
  bio: "Music-first VRChat club night with warm rooms, late sets, and community-hosted weekends.",
  about: "Afterglow keeps the focus on friendly floors, clear event listings, and DJs who like a slower build.",
  region: "Global",
  timezone: "UTC",
  trustLabel: "community_submitted",
  source: {
    sourceType: "community",
    label: "Community submitted",
    submittedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
  },
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
      summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
      sourceLabel: "Community credit",
    },
  ],
  upcomingEvents: [],
  hostedEvents: [eventPreview],
  community: {
    subtype: "Club night",
    categoryTags: ["Music", "Dancing", "Social"],
  },
};

const worldProfile: PublicWorld = {
  slug: worldSlug,
  displayName: "Neon Harbor",
  tags: ["Club world", "Cyberpunk", "Dance floor"],
  summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
  description:
    "Neon Harbor mixes warm booth lighting, open-water skyline views, and a compact floor built for smaller music nights.",
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
      sourceLabel: "Community credit",
    },
    {
      role: "media_credit",
      displayName: "DJ Aurora",
      profileSlug: personSlug,
      profileType: "person",
      sourceLabel: "Community credit",
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
    label: "Neon Harbor creator notes",
    confirmedAt: Date.UTC(2025, 0, 1, 12, 0, 0),
  },
  eventContext: {
    upcoming: [
      {
        slug: eventSlug,
        title: "Afterglow Harbor Sessions",
        startAt: eventStartAt,
        doorsOpenAt: eventDoorsOpenAt,
        endAt: eventEndAt,
        timezone: eventTimezone,
        communityName: "Afterglow Social",
        summary: "Late-night harbor club session with house, trance, and warm social energy.",
        posterImageUrl: "https://example.invalid/events/afterglow-harbor-poster.png",
        mediaLinks: [
          {
            type: "watch",
            label: "Afterglow watch link",
            url: "https://example.invalid/events/afterglow-watch",
            presentation: "open",
          },
        ],
        source: {
          sourceType: "manual",
          label: "Afterglow event listing",
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
        summary: "Opening night set with early arrivals, world tours, and a compact DJ lineup.",
        mediaLinks: [],
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
    summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
    upcomingEventCount: 2,
    activityLabel: "Hosting upcoming events",
    nextEvent: {
      slug: eventSlug,
      title: "Afterglow Harbor Sessions",
      startAt: eventStartAt,
      doorsOpenAt: eventDoorsOpenAt,
      timezone: eventTimezone,
      communityName: "Afterglow Social",
      source: {
        sourceType: "manual",
        label: "Afterglow event listing",
        url: "https://example.invalid/events/afterglow-harbor-sessions",
      },
    },
  },
];

const publicEvent: PublicEvent = {
  ...eventPreview,
  slug: eventSlug,
  notes: "Doors open before the first set. Follow host announcements for instance details.",
  mediaLinks: [
    {
      type: "watch",
      label: "Afterglow watch link",
      url: "https://example.invalid/events/afterglow-watch",
      presentation: "open",
    },
    {
      type: "vrcdn",
      label: "VRCDN copy link",
      url: "https://example.invalid/events/afterglow-vrcdn",
      presentation: "copy",
    },
  ],
  worlds: [
    {
      slug: worldSlug,
      displayName: "Neon Harbor",
      tags: ["Club world", "Cyberpunk", "Dance floor"],
      summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
      association: {
        sourceType: "manual",
        confirmationState: "confirmed",
        confirmedAt: Date.UTC(2026, 4, 1, 12, 0, 0),
      },
    },
  ],
  participants: [
    {
      slug: personSlug,
      displayName: "DJ Aurora",
      roleLabel: "Performer",
      trustLabel: "community_submitted",
      source: {
        sourceType: "community",
        label: "Afterglow lineup",
      },
    },
  ],
  slots: [
    {
      position: 0,
      startAt: eventStartAt,
      endAt: firstSlotEndAt,
      displayLabel: "DJ Aurora",
      roleLabel: "House",
      discord: {
        shortTime: "<t:1781488800:t>",
        longTime: "<t:1781488800:T>",
        shortDate: "<t:1781488800:d>",
        longDate: "<t:1781488800:D>",
        shortDateTime: "<t:1781488800:f>",
        longDateTime: "<t:1781488800:F>",
        relative: "<t:1781488800:R>",
      },
      performer: {
        slug: personSlug,
        displayName: "DJ Aurora",
        trustLabel: "community_submitted",
      },
      source: {
        sourceType: "community",
        label: "Afterglow lineup",
      },
    },
    {
      position: 1,
      startAt: secondSlotStartAt,
      endAt: secondSlotEndAt,
      displayLabel: "DJ Lumen",
      roleLabel: "Trance",
      discord: {
        shortTime: "<t:1781491500:t>",
        longTime: "<t:1781491500:T>",
        shortDate: "<t:1781491500:d>",
        longDate: "<t:1781491500:D>",
        shortDateTime: "<t:1781491500:f>",
        longDateTime: "<t:1781491500:F>",
        relative: "<t:1781491500:R>",
      },
      source: {
        sourceType: "community",
        label: "Afterglow lineup",
      },
    },
  ],
};

const publicWatchEvent: PublicEvent = {
  ...publicEvent,
  slug: eventWatchSlug,
  title: "Afterglow Watch Room",
  startAt: watchEventStartAt,
  doorsOpenAt: watchEventDoorsOpenAt,
  endAt: watchEventEndAt,
  summary: "Live room for the Afterglow set stream.",
  notes: "Use the player during the event, or open the source link in a new tab.",
  mediaLinks: [
    {
      type: "watch",
      label: "Event stream",
      url: "https://vrcdn.live/playwright-afterglow-watch-room",
      presentation: "open",
    },
    {
      type: "watch",
      label: "YouTube archive link",
      url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      presentation: "open",
    },
    {
      type: "stream",
      label: "Twitch channel link",
      url: "https://www.twitch.tv/twitchdev",
      presentation: "open",
    },
  ],
  slots: [
    {
      ...publicEvent.slots[0]!,
      startAt: watchEventStartAt,
      endAt: watchFirstSlotEndAt,
    },
    {
      ...publicEvent.slots[1]!,
      startAt: watchSecondSlotStartAt,
      endAt: watchSecondSlotEndAt,
    },
  ],
};

const discoveryResults: PublicSearchResult[] = [
  {
    entityType: "event",
    slug: eventSlug,
    routePath: `/e/${eventSlug}`,
    title: "Afterglow Harbor Sessions",
    subtitle: "Afterglow Social",
    summary: "Late-night harbor club session with house, trance, and warm social energy.",
    imageUrl: "https://example.invalid/events/afterglow-harbor-poster.png",
    startsAt: eventStartAt,
    source: {
      sourceType: "manual",
      label: "Afterglow event listing",
    },
    score: 280,
  },
  {
    entityType: "profile",
    profileType: "person",
    slug: personSlug,
    routePath: `/p/${personSlug}`,
    title: "DJ Aurora",
    subtitle: "Person profile",
    summary: "Melodic house sets for late-night VRChat floors.",
    source: {
      sourceType: "community",
      label: "Community submitted",
    },
    score: 170,
  },
  {
    entityType: "profile",
    profileType: "community",
    slug: communitySlug,
    routePath: `/c/${communitySlug}`,
    title: "Afterglow Social",
    subtitle: "Community profile",
    summary: "A warm VRChat club night for music-first communities.",
    source: {
      sourceType: "community",
      label: "Community submitted",
    },
    score: 160,
  },
  {
    entityType: "world",
    slug: worldSlug,
    routePath: `/w/${worldSlug}`,
    title: "Neon Harbor",
    subtitle: "World",
    summary: "Cyberpunk harbor club world with layered dance floors and quiet balcony corners.",
    source: {
      sourceType: "owner",
      label: "Neon Harbor creator notes",
    },
    score: 150,
  },
];

const discoveryData: PublicDiscoveryData = {
  featured: [discoveryResults[0]!, discoveryResults[3]!],
  upcomingEvents: [discoveryResults[0]!],
  people: [discoveryResults[1]!],
  communities: [discoveryResults[2]!],
  worlds: [discoveryResults[3]!],
  terms: [
    { scope: "profile_tag", key: "melodic_house", label: "Melodic House", usageCount: 2 },
    { scope: "event_tag", key: "tonight", label: "Tonight", usageCount: 1 },
    { scope: "world_tag", key: "club_world", label: "Club world", usageCount: 1 },
    { scope: "community_subtype", key: "club", label: "Club", usageCount: 1 },
  ],
};

type PlaywrightDiscoverySearchFixture =
  | { kind: "disabled" }
  | { kind: "fallthrough" }
  | { kind: "handled"; results: PublicSearchResult[] };

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

export function getPlaywrightDiscoveryFixture(): PublicDiscoveryData | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return null;
  }

  return discoveryData;
}

export function searchPlaywrightDiscoveryFixture(query: string): PlaywrightDiscoverySearchFixture {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return { kind: "disabled" };
  }

  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { kind: "handled", results: [] };
  }

  const matches = discoveryResults.filter((result) =>
    [result.title, result.subtitle, result.summary, result.source?.label]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );

  if (matches.length > 0) {
    return { kind: "handled", results: matches };
  }

  if (process.env.VRDEX_ALLOW_PLAYWRIGHT_FIXTURE_SEARCH_FALLTHROUGH === "true") {
    return { kind: "fallthrough" };
  }

  return { kind: "handled", results: [] };
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

export function getPlaywrightPublicEventFixture(slug: string): PublicEvent | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VRDEX_ENABLE_PLAYWRIGHT_FIXTURES !== "true"
  ) {
    return null;
  }

  if (slug === eventSlug) {
    return publicEvent;
  }

  if (slug === eventWatchSlug) {
    return publicWatchEvent;
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
  eventPath: `/e/${eventSlug}`,
  eventWatchPath: `/e/${eventWatchSlug}`,
};
