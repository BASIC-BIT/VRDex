import type { PublicProfile } from "@/app/_components/profile-public-page";
import type { PublicProfileLookupResult } from "@/app/_components/profile-lookup-page";
import type { PublicActiveWorld } from "@/app/_components/home-active-worlds";
import type {
  PublicDiscoveryData,
  PublicSearchResult,
} from "@/app/_components/discovery-public-page";
import type { PublicEvent } from "@/app/_components/event-public-page";
import type { PublicWorld } from "@/app/_components/world-public-page";

const personSlug = "playwright-dj-aurora";
const basicBitSlug = "basicbit";
const longNameSlug = "playwright-princess-starlight-interstellar-bassline";
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

type FixturePersonProfile = Extract<PublicProfile, { profileType: "person" }> & {
  accentColor?: string;
  secondaryColor?: string;
  searchAliases?: string[];
};

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

const personProfile: FixturePersonProfile = {
  profileType: "person",
  slug: personSlug,
  displayName: "DJ Aurora",
  aliases: ["Aurora", "Auralight"],
  tags: ["DJ", "Melodic House", "EU"],
  genres: [
    {
      slug: "melodic-house",
      displayName: "Melodic House",
    },
  ],
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
      type: "vrchat_profile",
      label: "VRChat profile",
      url: "https://vrchat.com/home/user/usr_00000000-0000-4000-8000-000000000001",
      source: "reviewed",
    },
    {
      type: "discord",
      label: "Discord: djaurora",
      url: "https://discord.com/users/100000000000000001",
      source: "owner_authored",
    },
    {
      type: "soundcloud",
      label: "DJ Aurora SoundCloud",
      url: "https://soundcloud.com/dj-aurora-example",
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

const basicBitProfile: FixturePersonProfile = {
  profileType: "person",
  slug: basicBitSlug,
  displayName: "BASICBIT",
  aliases: ["BASIC"],
  searchAliases: ["basic_bit", "basicbit", "lineup"],
  accentColor: "#67e8f9",
  secondaryColor: "#c084fc",
  tags: ["Software Dev", "3D Designer", "VRDJ"],
  genres: [
    {
      slug: "drum-and-bass",
      displayName: "Drum and Bass",
      displayLabel: "DnB",
      featured: true,
    },
    {
      slug: "house",
      displayName: "House",
    },
    {
      slug: "techno",
      displayName: "Techno",
    },
    {
      slug: "bass-music",
      displayName: "Bass",
    },
    {
      slug: "140",
      displayName: "140",
    },
    {
      slug: "trap",
      displayName: "Trap",
    },
    {
      slug: "space-bass",
      displayName: "Space Bass",
    },
    {
      slug: "midtempo",
      displayName: "Midtempo",
    },
    {
      slug: "uk-garage",
      displayName: "UK Garage",
      displayLabel: "UKG",
    },
    {
      slug: "dancefloor-drum-and-bass",
      displayName: "Dancefloor Drum and Bass",
      displayLabel: "Dancefloor",
    },
    {
      slug: "neurofunk",
      displayName: "Neurofunk",
    },
  ],
  headline: "Software Dev | 3D Designer | VRDJ",
  bio: "Multigenre DJ but I really love DnB <3",
  about: "Public lookup seed for validating operator workflows around creator links, event streams, and identity references.",
  avatarImageUrl: "/seed/basicbit-avatar.png",
  trustLabel: "claimed_verified",
  outboundLinks: [
    {
      type: "vrchat_profile",
      label: "VRChat: BASICBIT",
      url: "https://vrchat.com/home/user/usr_de6af2ae-8bdf-4aa9-89ae-8af79e2aa405",
      source: "owner_authored",
    },
    {
      type: "discord",
      label: "Discord",
      handle: "basic_bit",
      url: "https://discord.com",
      source: "owner_authored",
    },
    {
      type: "website",
      label: "Website",
      url: "https://basicbit.net/",
      source: "owner_authored",
    },
    {
      type: "vrcdn",
      label: "VRCDN stream",
      url: "https://stream.vrcdn.live/live/basicbit.live.ts",
      source: "owner_authored",
    },
    {
      type: "twitch",
      label: "Twitch",
      url: "https://www.twitch.tv/basic_bit",
      source: "owner_authored",
    },
  ],
  worldCredits: [],
  upcomingEvents: [],
  hostedEvents: [],
  person: {
    roleTags: ["Software Dev", "3D Designer", "VRDJ"],
  },
};

const longNameProfile: FixturePersonProfile = {
  profileType: "person",
  slug: longNameSlug,
  displayName: "Princess Starlight Interstellar Bassline Orchestra",
  aliases: ["Starlight Bassline", "PSIBO"],
  searchAliases: ["princess starlight", "interstellar bassline", "psibo", "lineup"],
  accentColor: "#f0abfc",
  secondaryColor: "#93c5fd",
  tags: ["DJ", "Long-name test", "VRDJ"],
  genres: [
    {
      slug: "drum-and-bass",
      displayName: "Drum and Bass",
      displayLabel: "DnB",
      featured: true,
    },
    {
      slug: "liquid-drum-and-bass",
      displayName: "Liquid Drum and Bass",
      displayLabel: "Liquid DnB",
    },
    {
      slug: "jungle",
      displayName: "Jungle",
    },
  ],
  headline: "Long-form display name fixture for lookup layout checks.",
  bio: "Fixture profile used to make sure dense lookup rows survive surprisingly long DJ names.",
  trustLabel: "claimed_unverified",
  outboundLinks: [
    {
      type: "vrchat_profile",
      label: "VRChat profile",
      url: "https://vrchat.com/home/user/usr_00000000-0000-4000-8000-000000000099",
      source: "reviewed",
    },
    {
      type: "discord",
      label: "Discord",
      handle: "starlight_bassline",
      url: "https://discord.com/users/100000000000000099",
      source: "owner_authored",
    },
    {
      type: "website",
      label: "Website",
      url: "https://example.invalid/starlight-bassline",
      source: "owner_authored",
    },
  ],
  worldCredits: [],
  upcomingEvents: [],
  hostedEvents: [],
  person: {
    roleTags: ["DJ", "VRDJ"],
  },
};

type GeneratedGenreSeed = {
  slug: string;
  displayName: string;
  displayLabel?: string;
  featured?: boolean;
};

type GeneratedLinkKind =
  | "bandcamp"
  | "commissions"
  | "discord"
  | "instagram"
  | "mixcloud"
  | "soundcloud"
  | "spotify"
  | "twitch"
  | "vrchat_profile"
  | "vrcdn"
  | "website"
  | "youtube";

type GeneratedPersonSeed = {
  displayName: string;
  aliases: string[];
  avatarImageUrl?: string;
  accentColor: string;
  secondaryColor: string;
  region?: string;
  timezone?: string;
  trustLabel: FixturePersonProfile["trustLabel"];
  genres: GeneratedGenreSeed[];
  linkKinds: GeneratedLinkKind[];
  twitchPresentation?: "icon" | "copy";
};

const generatedGenreSets = {
  bass: [
    { slug: "bass-music", displayName: "Bass", featured: true },
    { slug: "dubstep", displayName: "Dubstep" },
    { slug: "space-bass", displayName: "Space Bass" },
  ],
  dnb: [
    { slug: "drum-and-bass", displayName: "Drum and Bass", displayLabel: "DnB", featured: true },
    { slug: "liquid-drum-and-bass", displayName: "Liquid Drum and Bass", displayLabel: "Liquid DnB" },
    { slug: "jungle", displayName: "Jungle" },
  ],
  house: [
    { slug: "house", displayName: "House", featured: true },
    { slug: "bass-house", displayName: "Bass House" },
    { slug: "garage-house", displayName: "Garage House" },
  ],
  techno: [
    { slug: "techno", displayName: "Techno", featured: true },
    { slug: "hardgroove", displayName: "Hardgroove" },
    { slug: "electro", displayName: "Electro" },
  ],
  trance: [
    { slug: "trance", displayName: "Trance", featured: true },
    { slug: "progressive-trance", displayName: "Progressive Trance" },
    { slug: "breaks", displayName: "Breaks" },
  ],
} satisfies Record<string, GeneratedGenreSeed[]>;

const generatedPersonSeeds: GeneratedPersonSeed[] = [
  {
    displayName: "Moth",
    aliases: ["m0th"],
    accentColor: "#d9f99d",
    secondaryColor: "#67e8f9",
    trustLabel: "community_submitted",
    genres: generatedGenreSets.techno,
    linkKinds: ["vrchat_profile", "discord", "twitch"],
    twitchPresentation: "copy",
  },
  {
    displayName: "Velvet Circuit",
    aliases: ["VCircuit", "Velvet"],
    avatarImageUrl: "/seed/fixture-avatar-velvet-circuit.svg",
    accentColor: "#c084fc",
    secondaryColor: "#67e8f9",
    region: "NA",
    timezone: "UTC-5",
    trustLabel: "claimed_verified",
    genres: generatedGenreSets.dnb,
    linkKinds: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "twitch"],
    twitchPresentation: "copy",
  },
  {
    displayName: "DJ Night Market",
    aliases: ["Night Market"],
    accentColor: "#f9a8d4",
    secondaryColor: "#fde68a",
    region: "APAC",
    timezone: "UTC+9",
    trustLabel: "claimed_unverified",
    genres: generatedGenreSets.house,
    linkKinds: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "mixcloud", "instagram", "commissions"],
  },
  {
    displayName: "The Lavender Subwoofer Disaster",
    aliases: ["Lavender Subwoofer", "LSDJ"],
    accentColor: "#a78bfa",
    secondaryColor: "#f0abfc",
    trustLabel: "community_submitted",
    genres: generatedGenreSets.bass,
    linkKinds: ["discord", "website"],
  },
  {
    displayName: "0xLuma",
    aliases: ["Luma"],
    avatarImageUrl: "/seed/fixture-avatar-luma.svg",
    accentColor: "#22d3ee",
    secondaryColor: "#4ade80",
    region: "EU",
    timezone: "UTC+1",
    trustLabel: "claimed_verified",
    genres: generatedGenreSets.trance,
    linkKinds: ["vrchat_profile", "website", "vrcdn", "youtube"],
  },
  {
    displayName: "Courier of the Low End",
    aliases: ["Low End Courier"],
    accentColor: "#fb7185",
    secondaryColor: "#60a5fa",
    trustLabel: "claimed_unverified",
    genres: generatedGenreSets.bass,
    linkKinds: ["vrchat_profile", "discord", "vrcdn", "bandcamp", "spotify"],
  },
  {
    displayName: "Solaris and the Breakbeat Weather System",
    aliases: ["Solaris Weather", "Breakbeat Weather"],
    avatarImageUrl: "/seed/fixture-avatar-solaris.svg",
    accentColor: "#fde047",
    secondaryColor: "#38bdf8",
    region: "Global",
    timezone: "UTC",
    trustLabel: "community_submitted",
    genres: generatedGenreSets.dnb,
    linkKinds: ["vrchat_profile", "discord", "website", "twitch", "mixcloud", "youtube", "instagram"],
  },
  {
    displayName: "Nia Nova",
    aliases: ["Nova"],
    accentColor: "#5eead4",
    secondaryColor: "#f0abfc",
    trustLabel: "claimed_unverified",
    genres: generatedGenreSets.house,
    linkKinds: ["discord", "soundcloud", "twitch"],
  },
];

function slugifyFixtureName(name: string): string {
  return `playwright-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function generatedFixtureLink(seed: GeneratedPersonSeed, index: number, kind: GeneratedLinkKind): FixturePersonProfile["outboundLinks"][number] {
  const slug = slugifyFixtureName(seed.displayName).replace(/^playwright-/, "");
  const encodedId = String(index + 20).padStart(12, "0");

  if (kind === "vrchat_profile") {
    return {
      type: "vrchat_profile",
      label: "VRChat profile",
      url: `https://vrchat.com/home/user/usr_00000000-0000-4000-8000-${encodedId}`,
      source: "reviewed",
    };
  }

  if (kind === "discord") {
    return {
      type: "discord",
      label: "Discord",
      handle: slug.replaceAll("-", "_"),
      url: `https://discord.com/users/200000000000${encodedId}`,
      source: "owner_authored",
    };
  }

  if (kind === "vrcdn") {
    return {
      type: "vrcdn",
      label: "VRCDN stream",
      url: `https://stream.vrcdn.live/live/${slug}.live.ts`,
      source: "owner_authored",
    };
  }

  if (kind === "twitch") {
    return {
      type: "twitch",
      label: "Twitch",
      ...(seed.twitchPresentation === undefined ? {} : { presentation: seed.twitchPresentation }),
      url: `https://www.twitch.tv/${slug.replaceAll("-", "_")}`,
      source: "owner_authored",
    };
  }

  const labelByKind: Record<Exclude<GeneratedLinkKind, "discord" | "twitch" | "vrchat_profile" | "vrcdn">, string> = {
    bandcamp: "Bandcamp",
    commissions: "Bookings",
    instagram: "Instagram",
    mixcloud: "Mixcloud",
    soundcloud: "SoundCloud",
    spotify: "Spotify",
    website: "Website",
    youtube: "YouTube",
  };

  return {
    type: kind,
    label: labelByKind[kind],
    url: `https://example.invalid/${slug}/${kind}`,
    source: "owner_authored",
  };
}

function generatedFixtureProfile(seed: GeneratedPersonSeed, index: number): FixturePersonProfile {
  return {
    profileType: "person",
    slug: slugifyFixtureName(seed.displayName),
    displayName: seed.displayName,
    aliases: seed.aliases,
    searchAliases: ["lineup", "fixture lineup", seed.displayName, ...seed.aliases],
    tags: ["DJ", "VRDJ", "Fixture lineup"],
    genres: seed.genres,
    headline: `${seed.displayName} fixture profile for lookup density checks.`,
    bio: "Generated fixture data for testing varied lookup names, colors, avatars, and links.",
    ...(seed.avatarImageUrl === undefined ? {} : { avatarImageUrl: seed.avatarImageUrl }),
    accentColor: seed.accentColor,
    secondaryColor: seed.secondaryColor,
    ...(seed.region === undefined ? {} : { region: seed.region }),
    ...(seed.timezone === undefined ? {} : { timezone: seed.timezone }),
    trustLabel: seed.trustLabel,
    outboundLinks: seed.linkKinds.map((kind) => generatedFixtureLink(seed, index, kind)),
    worldCredits: [],
    upcomingEvents: [],
    hostedEvents: [],
    person: {
      roleTags: ["DJ", "VRDJ"],
    },
  };
}

const generatedFixtureProfiles = generatedPersonSeeds.map(generatedFixtureProfile);
const personProfiles = [personProfile, basicBitProfile, longNameProfile, ...generatedFixtureProfiles];

const communityProfile: PublicProfile = {
  profileType: "community",
  slug: communitySlug,
  displayName: "Afterglow Social",
  aliases: ["Afterglow", "AGS"],
  tags: ["Club", "Weekend", "Friends"],
  genres: [],
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
  authoredMediaLinks: [
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
  notes: "Use the player during the event, or open the stream in a new tab.",
  authoredMediaLinks: [
    {
      type: "watch",
      label: "Event stream",
      url: "https://stream.vrcdn.live/live/playwright-afterglow-watch-room.live.ts",
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
  mediaLinks: [
    {
      type: "watch",
      label: "Event stream",
      url: "https://stream.vrcdn.live/live/playwright-afterglow-watch-room.live.ts",
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
    profileType: "person",
    slug: basicBitSlug,
    routePath: `/p/${basicBitSlug}`,
    title: "BASICBIT",
    subtitle: "Person profile",
    summary: "Software Dev | 3D Designer | VRDJ",
    imageUrl: "/seed/basicbit-avatar.png",
    source: {
      sourceType: "owner",
      label: "Owner-authored",
    },
    score: 168,
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
  featured: [discoveryResults[0]!, discoveryResults[4]!],
  upcomingEvents: [discoveryResults[0]!],
  people: [discoveryResults[1]!, discoveryResults[2]!],
  communities: [discoveryResults[3]!],
  worlds: [discoveryResults[4]!],
  terms: [
    { scope: "profile_tag", key: "melodic_house", label: "Melodic House", usageCount: 2 },
    { scope: "profile_genre", key: "drum_and_bass", label: "Drum and Bass", usageCount: 1 },
    { scope: "event_tag", key: "tonight", label: "Tonight", usageCount: 1 },
    { scope: "world_tag", key: "club_world", label: "Club world", usageCount: 1 },
    { scope: "community_subtype", key: "club", label: "Club", usageCount: 1 },
  ],
};

type PlaywrightDiscoverySearchFixture =
  | { kind: "disabled" }
  | { kind: "fallthrough" }
  | { kind: "handled"; results: PublicSearchResult[] };
type PlaywrightProfileLookupFixture =
  | { kind: "disabled" }
  | { kind: "fallthrough" }
  | { kind: "handled"; results: PublicProfileLookupResult[] };

function toProfileLookupFixture(profile: PublicProfile): PublicProfileLookupResult | null {
  if (profile.profileType !== "person") {
    return null;
  }

  const accentColor = "accentColor" in profile && typeof profile.accentColor === "string" ? profile.accentColor : undefined;
  const secondaryColor = "secondaryColor" in profile && typeof profile.secondaryColor === "string" ? profile.secondaryColor : undefined;

  return {
    slug: profile.slug,
    displayName: profile.displayName,
    profilePath: `/p/${profile.slug}`,
    aliases: profile.aliases,
    tags: profile.tags,
    genres: profile.genres,
    roleTags: profile.person.roleTags,
    trustLabel: profile.trustLabel,
    ...(profile.headline === undefined ? {} : { headline: profile.headline }),
    ...(profile.bio === undefined ? {} : { bio: profile.bio }),
    ...(profile.avatarImageUrl === undefined ? {} : { avatarImageUrl: profile.avatarImageUrl }),
    ...(accentColor === undefined ? {} : { accentColor }),
    ...(secondaryColor === undefined ? {} : { secondaryColor }),
    ...(profile.region === undefined ? {} : { region: profile.region }),
    ...(profile.timezone === undefined ? {} : { timezone: profile.timezone }),
    outboundLinks: profile.outboundLinks,
  };
}

function toPublicFixturePersonProfile(profile: FixturePersonProfile): Extract<PublicProfile, { profileType: "person" }> {
  const publicProfile = { ...profile };
  delete publicProfile.searchAliases;

  return publicProfile;
}

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

  if (profileType === "person") {
    const profile = personProfiles.find((entry) => entry.slug === slug);

    return profile ? toPublicFixturePersonProfile(profile) : null;
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

function profileGenreSearchTerms(profile: PublicProfile): string[] {
  return profile.genres.flatMap((genre) => [
    genre.displayName,
    genre.displayLabel,
    ...(genre.slug === "drum-and-bass" ? ["D&B", "dnb", "drum & bass"] : []),
  ]).filter((value): value is string => Boolean(value));
}

export function getPlaywrightProfileLookupFixture(query: string): PlaywrightProfileLookupFixture {
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

  const results = personProfiles.flatMap((profile) => {
    const searchableText = [
      profile.displayName,
      profile.slug,
      ...profile.aliases,
      ...(profile.searchAliases ?? []),
      ...profile.tags,
      ...profileGenreSearchTerms(profile),
      ...profile.person.roleTags,
      profile.headline,
      profile.bio,
      ...profile.outboundLinks.map((link) => `${link.label} ${link.handle ?? ""}`),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const result = toProfileLookupFixture(profile);

    return result !== null && searchableText.includes(normalized) ? [result] : [];
  });

  if (results.length > 0) {
    return { kind: "handled", results };
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
