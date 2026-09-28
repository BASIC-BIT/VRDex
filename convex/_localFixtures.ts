// Fake dataset for a local anonymous Convex deployment. Ported from
// apps/web/src/convex/playwright-fixtures.ts; every slug starts with
// "playwright-" and every URL host ends in ".invalid" so nothing here can be
// mistaken for, or link to, a real person.

export const LOCAL_FIXTURE_MARKER = "vrdex-local-fixture";
export const LOCAL_FIXTURE_SLUG_PREFIX = "playwright-";

type Confidence = "high" | "medium" | "low";

export type LocalGenre = {
  slug: string;
  displayName: string;
  displayLabel?: string;
  featured?: boolean;
  source: "manual_review";
  confidence: Confidence;
  explicit: boolean;
};

export type LocalProfileLink = {
  type:
    | "vrchat_profile" | "vrcdn" | "discord" | "soundcloud" | "mixcloud" | "twitch"
    | "youtube" | "spotify" | "bandcamp" | "instagram" | "website" | "commissions";
  label: string;
  url: string;
  handle?: string;
  presentation?: "icon" | "copy";
  source: "reviewed";
};

type SharedFixture = {
  slug: string;
  displayName: string;
  aliases: string[];
  searchAliases?: string[];
  tags: string[];
  genres?: LocalGenre[];
  headline?: string;
  bio?: string;
  about?: string;
  region?: string;
  timezone?: string;
  outboundLinks: LocalProfileLink[];
};

export type LocalPersonFixture = SharedFixture & {
  profileType: "person";
  person: { pronouns?: string; roleTags: string[] };
};

export type LocalCommunityFixture = SharedFixture & {
  profileType: "community";
  community: { subtype?: string; categoryTags: string[] };
};

export type LocalWorldFixture = {
  slug: string;
  displayName: string;
  tags: string[];
  summary: string;
  description: string;
  vrchatWorldId: string;
  canonicalVrchatWorldUrl: string;
  sourceUrl: string;
  visibilityStatus: "public";
  platformCompatibility: Array<"pc" | "android" | "ios">;
  publicationState: "published";
  creatorAttributions: Array<{
    role: "world_author" | "media_credit";
    displayName: string;
    profileSlug: string;
    profileType: "person" | "community";
    sourceLabel: string;
  }>;
  outboundLinks: Array<{
    type: "gumroad" | "commissions";
    label: string;
    url: string;
    source: "reviewed";
  }>;
};

export type LocalEventFixture = {
  slug: string;
  title: string;
  startAt: number;
  doorsOpenAt: number;
  endAt: number;
  timezone: string;
  communitySlug: string;
  worldSlug: string;
  performerSlugs: string[];
  summary: string;
  sourceLabel: string;
  sourceUrl: string;
  watchSurfaceEnabled: boolean;
  mediaLinks: Array<{
    type: "watch" | "vrcdn";
    label: string;
    url: string;
    presentation: "open" | "copy";
  }>;
};

function genre(slug: string, displayName: string, featured = false, displayLabel?: string): LocalGenre {
  return {
    slug,
    displayName,
    ...(displayLabel ? { displayLabel } : {}),
    ...(featured ? { featured: true } : {}),
    source: "manual_review",
    confidence: "high",
    explicit: true,
  };
}

const genreSets = {
  bass: [genre("bass-music", "Bass Music", true), genre("dubstep", "Dubstep"), genre("space-bass", "Space Bass")],
  dnb: [genre("drum-and-bass", "Drum and Bass", true, "DnB"), genre("liquid-drum-and-bass", "Liquid Drum and Bass", false, "Liquid DnB"), genre("jungle", "Jungle")],
  house: [genre("house", "House", true), genre("bass-house", "Bass House"), genre("garage-house", "Garage House")],
  techno: [genre("techno", "Techno", true), genre("hardgroove", "Hardgroove"), genre("electro", "Electro")],
  trance: [genre("trance", "Trance", true), genre("progressive-trance", "Progressive Trance"), genre("breaks", "Breaks")],
} as const;

const linkLabels: Record<LocalProfileLink["type"], string> = {
  vrchat_profile: "VRChat profile",
  vrcdn: "VRCDN stream",
  discord: "Discord",
  soundcloud: "SoundCloud",
  mixcloud: "Mixcloud",
  twitch: "Twitch",
  youtube: "YouTube",
  spotify: "Spotify",
  bandcamp: "Bandcamp",
  instagram: "Instagram",
  website: "Website",
  commissions: "Bookings",
};

function link(slug: string, type: LocalProfileLink["type"], extra: Partial<LocalProfileLink> = {}): LocalProfileLink {
  return {
    type,
    label: linkLabels[type],
    url: `https://${type.replace(/_/g, "-")}.example.invalid/${slug}`,
    source: "reviewed",
    ...extra,
  };
}

function slugify(name: string): string {
  return LOCAL_FIXTURE_SLUG_PREFIX + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type GeneratedSeed = {
  displayName: string;
  aliases: string[];
  genres: keyof typeof genreSets;
  region?: string;
  timezone?: string;
  links: Array<LocalProfileLink["type"]>;
};

// Mirrors generatedPersonSeeds in the Playwright fixture file.
const generatedSeeds: GeneratedSeed[] = [
  { displayName: "Moth", aliases: ["m0th"], genres: "techno", links: ["vrchat_profile", "discord", "twitch"] },
  { displayName: "Velvet Circuit", aliases: ["VCircuit", "Velvet"], genres: "dnb", region: "NA", timezone: "UTC-5", links: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "twitch"] },
  { displayName: "DJ Night Market", aliases: ["Night Market"], genres: "house", region: "APAC", timezone: "UTC+9", links: ["vrchat_profile", "discord", "website", "vrcdn", "soundcloud", "mixcloud", "instagram", "commissions"] },
  { displayName: "The Lavender Subwoofer Disaster", aliases: ["Lavender Subwoofer", "LSDJ"], genres: "bass", links: ["discord", "website"] },
  { displayName: "0xLuma", aliases: ["Luma"], genres: "trance", region: "EU", timezone: "UTC+1", links: ["vrchat_profile", "website", "vrcdn", "youtube"] },
  { displayName: "Courier of the Low End", aliases: ["Low End Courier"], genres: "bass", links: ["vrchat_profile", "discord", "vrcdn", "bandcamp", "spotify"] },
  { displayName: "Solaris and the Breakbeat Weather System", aliases: ["Solaris Weather", "Breakbeat Weather"], genres: "dnb", region: "Global", timezone: "UTC", links: ["vrchat_profile", "discord", "website", "twitch", "mixcloud", "youtube", "instagram"] },
  { displayName: "Nia Nova", aliases: ["Nova"], genres: "house", links: ["discord", "soundcloud", "twitch"] },
];

function generatedPerson(seed: GeneratedSeed): LocalPersonFixture {
  const slug = slugify(seed.displayName);
  return {
    profileType: "person",
    slug,
    displayName: seed.displayName,
    aliases: seed.aliases,
    searchAliases: ["lineup", "fixture lineup", seed.displayName, ...seed.aliases],
    tags: ["DJ", "VRDJ", "Fixture lineup"],
    genres: [...genreSets[seed.genres]],
    headline: `${seed.displayName} fixture profile for lookup density checks.`,
    bio: "Generated fixture data for testing varied lookup names, colors, avatars, and links.",
    ...(seed.region ? { region: seed.region } : {}),
    ...(seed.timezone ? { timezone: seed.timezone } : {}),
    outboundLinks: seed.links.map((type) =>
      link(slug, type, type === "discord" ? { handle: slug.replace(/-/g, "_") } : {}),
    ),
    person: { roleTags: ["DJ", "VRDJ"] },
  };
}

const auroraSlug = "playwright-dj-aurora";
const communitySlug = "playwright-afterglow-social";
const worldSlug = "playwright-neon-harbor";

export const localPersonFixtures: LocalPersonFixture[] = [
  {
    profileType: "person",
    slug: auroraSlug,
    displayName: "DJ Aurora",
    aliases: ["Aurora", "Auralight"],
    tags: ["DJ", "Melodic House", "EU"],
    genres: [genre("melodic-house", "Melodic House", true)],
    headline: "Melodic house sets for late-night VRChat floors.",
    bio: "Melodic house DJ playing warm, vocal-led sets across VRChat club nights.",
    about: "Aurora plays warm, vocal-led melodic house for late-night VRChat floors and hosts a monthly residency.",
    region: "EU",
    timezone: "UTC+1",
    outboundLinks: [
      link(auroraSlug, "vrchat_profile"),
      link(auroraSlug, "discord", { handle: "dj_aurora" }),
      link(auroraSlug, "soundcloud"),
      link(auroraSlug, "twitch"),
      link(auroraSlug, "vrcdn"),
      link(auroraSlug, "commissions"),
    ],
    person: { pronouns: "she/they", roleTags: ["DJ", "Producer", "Host"] },
  },
  {
    profileType: "person",
    slug: "playwright-princess-starlight-interstellar-bassline",
    displayName: "Princess Starlight Interstellar Bassline Orchestra",
    aliases: ["Starlight Bassline", "PSIBO"],
    tags: ["DJ", "Long-name test", "VRDJ"],
    genres: [...genreSets.dnb],
    headline: "Long-form display name fixture for lookup layout checks.",
    bio: "Fixture profile used to make sure dense lookup rows survive surprisingly long DJ names.",
    outboundLinks: [
      link("playwright-princess-starlight-interstellar-bassline", "vrchat_profile"),
      link("playwright-princess-starlight-interstellar-bassline", "discord", { handle: "starlight_bassline" }),
      link("playwright-princess-starlight-interstellar-bassline", "website"),
    ],
    person: { roleTags: ["DJ", "VRDJ"] },
  },
  {
    profileType: "person",
    slug: "playwright-sparse-import",
    displayName: "Sparse Import",
    aliases: [],
    searchAliases: ["sparse imported entry"],
    tags: [],
    outboundLinks: [],
    person: { roleTags: [] },
  },
  {
    profileType: "person",
    slug: "playwright-max-share-card",
    displayName: "W".repeat(80),
    aliases: [],
    tags: [],
    headline: "W".repeat(200),
    outboundLinks: [],
    person: { roleTags: [] },
  },
  ...generatedSeeds.map(generatedPerson),
];

export const localCommunityFixture: LocalCommunityFixture = {
  profileType: "community",
  slug: communitySlug,
  displayName: "Afterglow Social",
  aliases: ["Afterglow", "AGS"],
  tags: ["Club", "Weekend", "Friends"],
  headline: "A warm VRChat club night for music-first communities.",
  bio: "Afterglow Social runs weekend club nights with rotating residents and guest DJs.",
  about: "Founded as a friends-first dance floor, Afterglow now hosts a weekly session and a monthly showcase.",
  region: "Global",
  timezone: "UTC",
  outboundLinks: [
    { type: "website", label: "Afterglow event archive", url: "https://example.invalid/afterglow-events", source: "reviewed" },
  ],
  community: { subtype: "Club night", categoryTags: ["Music", "Dancing", "Social"] },
};

export const localWorldFixture: LocalWorldFixture = {
  slug: worldSlug,
  displayName: "Neon Harbor",
  tags: ["Club world", "Cyberpunk", "Dance floor"],
  summary: "A neon-lit harbor club with a floating dance floor.",
  description: "Neon Harbor is a cyberpunk waterfront club world built for late-night sets, with a main floor, a chill deck, and a DJ booth over the water.",
  vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
  canonicalVrchatWorldUrl: "https://vrchat.example.invalid/home/world/wrld_00000000-0000-4000-8000-000000000001",
  sourceUrl: "https://vrchat.example.invalid/home/world/wrld_00000000-0000-4000-8000-000000000001",
  visibilityStatus: "public",
  platformCompatibility: ["pc", "android"],
  publicationState: "published",
  creatorAttributions: [
    { role: "world_author", displayName: "Afterglow Social", profileSlug: communitySlug, profileType: "community", sourceLabel: "Community credit" },
    { role: "media_credit", displayName: "DJ Aurora", profileSlug: auroraSlug, profileType: "person", sourceLabel: "Community credit" },
  ],
  outboundLinks: [
    { type: "gumroad", label: "Neon Harbor prefab", url: "https://example.invalid/neon-harbor-prefab", source: "reviewed" },
    { type: "commissions", label: "World commissions", url: "https://example.invalid/world-commissions", source: "reviewed" },
  ],
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function localEventFixtures(now: number): LocalEventFixture[] {
  const upcomingStart = now + 7 * DAY;
  const pastStart = now - 30 * DAY;
  return [
    {
      slug: "playwright-afterglow-harbor-sessions",
      title: "Afterglow Harbor Sessions",
      startAt: upcomingStart,
      doorsOpenAt: upcomingStart - HOUR / 2,
      endAt: upcomingStart + 3 * HOUR,
      timezone: "America/New_York",
      communitySlug,
      worldSlug,
      performerSlugs: [auroraSlug],
      summary: "Late-night harbor club session with house, trance, and warm social energy.",
      sourceLabel: "Afterglow event listing",
      sourceUrl: "https://example.invalid/events/afterglow-harbor-sessions",
      watchSurfaceEnabled: false,
      mediaLinks: [
        { type: "watch", label: "Watch room", url: "https://example.invalid/events/afterglow-watch", presentation: "open" },
        { type: "vrcdn", label: "VRCDN stream", url: "https://vrcdn.example.invalid/live/playwright-afterglow-harbor-sessions.live.ts", presentation: "copy" },
      ],
    },
    {
      slug: "playwright-afterglow-watch-room",
      title: "Afterglow Watch Room",
      startAt: pastStart,
      doorsOpenAt: pastStart - HOUR / 2,
      endAt: pastStart + 3 * HOUR,
      timezone: "America/New_York",
      communitySlug,
      worldSlug,
      performerSlugs: [auroraSlug],
      summary: "Live room for the Afterglow set stream.",
      sourceLabel: "Afterglow event listing",
      sourceUrl: "https://example.invalid/events/afterglow-watch-room",
      watchSurfaceEnabled: true,
      mediaLinks: [
        { type: "watch", label: "Watch room", url: "https://example.invalid/events/afterglow-watch", presentation: "open" },
      ],
    },
  ];
}

export function allLocalFixtureSlugs(now: number): string[] {
  return [
    ...localPersonFixtures.map((p) => p.slug),
    localCommunityFixture.slug,
    localWorldFixture.slug,
    ...localEventFixtures(now).map((e) => e.slug),
  ];
}

export function allLocalFixtureUrls(now: number): string[] {
  return [
    ...localPersonFixtures.flatMap((p) => p.outboundLinks.map((l) => l.url)),
    ...localCommunityFixture.outboundLinks.map((l) => l.url),
    localWorldFixture.canonicalVrchatWorldUrl,
    localWorldFixture.sourceUrl,
    ...localWorldFixture.outboundLinks.map((l) => l.url),
    ...localEventFixtures(now).flatMap((e) => [e.sourceUrl, ...e.mediaLinks.map((l) => l.url)]),
  ];
}
