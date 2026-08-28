import { fetchQuery } from "convex/nextjs";
import { cache } from "react";
import { convexAuthToken } from "@/lib/server/auth";
import type { FunctionReference } from "convex/server";
import { api } from "@convex-generated-api";
import type { PrivateSeedLookupResult, SeedLookupViewerAccess } from "@/app/_components/profile-lookup-page";
import type { SearchResultFilter } from "@/app/_components/search-view-state";
import { publicSearchBackendFilters } from "@/lib/server/public-search-query";
import { getTwitchLiveState } from "@/lib/server/twitch-live";
import { getVrcdnLiveStates } from "@/lib/server/vrcdn-live";
import {
  getPlaywrightActiveWorldFixtures,
  getPlaywrightDiscoveryFixture,
  getPlaywrightProfileLookupFixture,
  getPlaywrightPublicEventFixture,
  getPlaywrightPublicProfileFixture,
  getPlaywrightPublicShortLinkFixture,
  getPlaywrightPublicWorldFixture,
  searchPlaywrightDiscoveryFixture,
} from "./playwright-fixtures";
import { profileClaimPath } from "@/lib/profile-claim";
import type { PublicProfileShareCard } from "../../../../convex/_profileShareCard";

const seedAccessApi = (api as unknown as {
  seedAccess: {
    lookupPeople: FunctionReference<
      "query",
      "public",
      { query: string; limit?: number },
      PrivateSeedLookupResult[]
    >;
    viewerAccess: FunctionReference<"query", "public", Record<string, never>, SeedLookupViewerAccess>;
  };
}).seedAccess;

const signedOutSeedAccess: SeedLookupViewerAccess = { allowed: false, source: "signed_out" };

type PublicProfileType = "person" | "community";

// `profileType` narrows to one of the two profile kinds. The root slug route omits it
// because a bare /basicbit does not say which kind it is -- the slug itself decides.
export async function fetchPublicProfileBySlug(slug: string, profileType?: PublicProfileType) {
  const fixtureProfile =
    profileType === undefined
      ? getPlaywrightPublicProfileFixture(slug, "person") ??
        getPlaywrightPublicProfileFixture(slug, "community")
      : getPlaywrightPublicProfileFixture(slug, profileType);

  if (fixtureProfile !== null) {
    return {
      kind: "live" as const,
      profile: fixtureProfile,
      shareCard: fixtureProfileShareCard(slug),
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const profile = await fetchQuery(api.profiles.getPublicBySlug, {
      slug,
      ...(profileType === undefined ? {} : { profileType }),
      now: Date.now(),
      includeShareCard: true,
    });

    const { publicProfile, shareCard } = profile === null
      ? { publicProfile: null, shareCard: null }
      : (({ shareCard: projectedShareCard, ...rest }) => ({
          publicProfile: rest,
          shareCard: projectedShareCard ?? null,
        }))(profile);

    // Together rather than in sequence: a profile that streams to both would
    // otherwise pay for two provider round trips before rendering anything.
    const [twitchLive, vrcdnLive] = publicProfile
      ? await Promise.all([
          getTwitchLiveState(publicProfile.outboundLinks),
          getVrcdnLiveStates(publicProfile.outboundLinks),
        ])
      : [undefined, undefined];

    return {
      kind: "live" as const,
      profile: publicProfile
        ? { ...publicProfile, ...(twitchLive ? { twitchLive } : {}), ...(vrcdnLive ? { vrcdnLive } : {}) }
        : null,
      shareCard,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex profile fetch failed: ${message}`);

    return {
      kind: "error" as const,
    };
  }
}

function fixtureProfileShareCard(slug: string): PublicProfileShareCard | null {
  const profile =
    getPlaywrightPublicProfileFixture(slug, "person") ??
    getPlaywrightPublicProfileFixture(slug, "community");

  if (profile === null) {
    return null;
  }

  const profileImage = profile.mediaKit?.profileImage;
  const logoImage = profile.mediaKit?.primaryLogo;
  const rasterImageUrl = (asset: typeof profileImage) =>
    asset?.mimeType === "image/png" ||
    asset?.mimeType === "image/jpeg" ||
    asset?.mimeType === "image/webp"
      ? asset.imageUrl
      : undefined;
  const profileImageUrl = rasterImageUrl(profileImage);
  const logoImageUrl = rasterImageUrl(logoImage);
  const prefersLogo = profile.mediaKit?.compactDisplay === "logo";
  const avatarImageUrl = prefersLogo
    ? logoImageUrl ?? profileImageUrl ?? profile.avatarImageUrl
    : profileImageUrl ?? logoImageUrl ?? profile.avatarImageUrl;
  const avatarImageKind = avatarImageUrl === undefined
    ? undefined
    : avatarImageUrl === logoImageUrl && logoImageUrl !== profileImageUrl
      ? "logo" as const
      : "profile" as const;

  return {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    trustLabel: profile.trustLabel,
    ...((profile.headline ?? profile.bio) ? { summary: profile.headline ?? profile.bio } : {}),
    ...(avatarImageUrl ? { avatarImageUrl } : {}),
    ...(avatarImageKind ? { avatarImageKind } : {}),
    ...(rasterImageUrl(profile.mediaKit?.banner) || profile.bannerImageUrl
      ? { bannerImageUrl: rasterImageUrl(profile.mediaKit?.banner) ?? profile.bannerImageUrl }
      : {}),
  };
}

export async function fetchPublicProfileShareCardBySlug(slug: string) {
  const fixtureProfile = fixtureProfileShareCard(slug);

  if (fixtureProfile !== null) {
    return { kind: "live" as const, entityType: "profile" as const, profile: fixtureProfile };
  }

  if (getPlaywrightPublicWorldFixture(slug) !== null) {
    return { kind: "live" as const, entityType: "world" as const, profile: null };
  }

  if (getPlaywrightPublicEventFixture(slug) !== null) {
    return { kind: "live" as const, entityType: "event" as const, profile: null };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, entityType: null, profile: null };
  }

  try {
    const result = await fetchQuery(api.profiles.getPublicShareCardBySlug, { slug });
    return {
      kind: "live" as const,
      entityType: result?.entityType ?? null,
      profile: result?.profile ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Server-side Convex profile share-card fetch failed: ${message}`);
    return { kind: "error" as const, entityType: null, profile: null };
  }
}

export async function fetchClaimProfileBySlug(slug: string) {
  const fixtureProfile =
    getPlaywrightPublicProfileFixture(slug, "person") ??
    getPlaywrightPublicProfileFixture(slug, "community");

  if (fixtureProfile !== null) {
    return { kind: "live" as const, profile: fixtureProfile };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, profile: null };
  }

  try {
    const profile = await fetchQuery(
      api.profileClaims.getClaimTargetBySlug,
      { profileSlug: slug },
      { token: await convexAuthToken() },
    );

    return { kind: "live" as const, profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Server-side Convex claim profile fetch failed: ${message}`);
    return { kind: "error" as const, profile: null };
  }
}

export async function fetchPublicEventBySlug(slug: string) {
  const fixtureEvent = getPlaywrightPublicEventFixture(slug);

  if (fixtureEvent !== null) {
    return {
      kind: "live" as const,
      event: fixtureEvent,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const event = await fetchQuery(api.events.getPublicBySlug, { slug });

    return {
      kind: "live" as const,
      event,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex event fetch failed: ${message}`);

    return {
      kind: "error" as const,
    };
  }
}

export async function fetchPublicWorldBySlug(slug: string) {
  const fixtureWorld = getPlaywrightPublicWorldFixture(slug);

  if (fixtureWorld !== null) {
    return {
      kind: "live" as const,
      world: fixtureWorld,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const world = await fetchQuery(api.worlds.getPublicBySlug, { slug, now: Date.now() });

    return {
      kind: "live" as const,
      world,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex world fetch failed: ${message}`);

    return {
      kind: "error" as const,
    };
  }
}

type PublicEntity =
  | {
      type: "profile";
      profile: NonNullable<Awaited<ReturnType<typeof fetchPublicProfileBySlug>>["profile"]>;
      shareCard: PublicProfileShareCard | null;
    }
  | { type: "world"; world: NonNullable<Awaited<ReturnType<typeof fetchPublicWorldBySlug>>["world"]> }
  | { type: "event"; event: NonNullable<Awaited<ReturnType<typeof fetchPublicEventBySlug>>["event"]> };

// Profiles, worlds, and events share one slug namespace and all render from the site
// root, so /basicbit has to ask all three which one owns the name.
//
// Fanned out rather than resolved in a single backend query on purpose: each fetcher
// already layers Playwright fixtures and (for profiles) Twitch live state over its
// Convex call, and running them concurrently costs one round of latency, not three.
async function fetchPublicEntityBySlugUncached(
  slug: string,
): Promise<
  | { kind: "missing-url" }
  | { kind: "error" }
  | { kind: "live"; entity: PublicEntity | null }
> {
  const [profileResult, worldResult, eventResult] = await Promise.all([
    fetchPublicProfileBySlug(slug),
    fetchPublicWorldBySlug(slug),
    fetchPublicEventBySlug(slug),
  ]);

  if (profileResult.kind === "live" && profileResult.profile !== null) {
    return {
      kind: "live",
      entity: {
        type: "profile",
        profile: profileResult.profile,
        shareCard: profileResult.shareCard,
      },
    };
  }

  if (worldResult.kind === "live" && worldResult.world !== null) {
    return { kind: "live", entity: { type: "world", world: worldResult.world } };
  }

  if (eventResult.kind === "live" && eventResult.event !== null) {
    return { kind: "live", entity: { type: "event", event: eventResult.event } };
  }

  const results = [profileResult, worldResult, eventResult];

  // An unreachable backend must not read as "no such page" -- a 404 would tell a
  // visitor their profile is gone when the truth is the read failed.
  if (results.some((result) => result.kind === "error")) {
    return { kind: "error" };
  }

  if (results.some((result) => result.kind === "missing-url")) {
    return { kind: "missing-url" };
  }

  return { kind: "live", entity: null };
}

// `generateMetadata` and the page body both resolve this route. React's request
// cache keeps those callers on one root lookup without persisting data between
// visitors or changing the direct Open Graph image route's lightweight query.
export const fetchPublicEntityBySlug = cache(fetchPublicEntityBySlugUncached);

export async function fetchPublicShortLinkTargetByCode(code: string) {
  const fixtureTarget = getPlaywrightPublicShortLinkFixture(code);

  if (fixtureTarget !== null) {
    return {
      kind: "live" as const,
      target: fixtureTarget,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, target: null };
  }

  try {
    const target = await fetchQuery(api.shortLinks.resolvePublicByCode, { code });

    return {
      kind: "live" as const,
      target,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex short link fetch failed: ${message}`);

    return {
      kind: "error" as const,
      target: null,
    };
  }
}

export async function fetchHomeActiveWorlds() {
  const fixtureWorlds = getPlaywrightActiveWorldFixtures();

  if (fixtureWorlds !== null) {
    return {
      kind: "live" as const,
      worlds: fixtureWorlds,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, worlds: [] };
  }

  try {
    const worlds = await fetchQuery(api.worlds.listHomeActiveWorlds, { now: Date.now(), limit: 3 });

    return {
      kind: "live" as const,
      worlds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex active worlds fetch failed: ${message}`);

    return {
      kind: "error" as const,
      worlds: [],
    };
  }
}

export async function fetchDiscovery() {
  const now = Date.now();
  const fixtureDiscovery = getPlaywrightDiscoveryFixture();

  if (fixtureDiscovery !== null) {
    return {
      kind: "live" as const,
      data: { ...fixtureDiscovery, eventSchedule: fixtureDiscovery.eventSchedule ?? [] },
      now: Date.UTC(2025, 0, 1, 12, 0, 0),
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, data: emptyDiscoveryData(), now };
  }

  try {
    const data = await fetchQuery(api.search.listDiscovery, { now });
    const eventSchedule = await fetchQuery(api.events.listPublicUpcoming, { now, limit: 12 })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Server-side Convex event schedule fetch failed: ${message}`);
        return [];
      });

    return {
      kind: "live" as const,
      data: { ...data, eventSchedule },
      now,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex discovery fetch failed: ${message}`);

    return {
      kind: "error" as const,
      data: emptyDiscoveryData(),
      now,
    };
  }
}

function matchesSearchFilter(
  result: { entityType: string; profileType?: string },
  filter: SearchResultFilter,
) {
  if (filter === "all") {
    return true;
  }

  return filter === "person" || filter === "community"
    ? result.entityType === "profile" && result.profileType === filter
    : result.entityType === filter;
}

function withSearchClaimEntry<T extends {
  claimEligible?: boolean;
  slug: string;
}>(result: T): T & { claimEntryPath?: string } {
  return {
    ...result,
    ...(result.claimEligible ? { claimEntryPath: profileClaimPath(result.slug, "search") } : {}),
  };
}

export async function fetchDiscoverySearch(
  query: string,
  filter: SearchResultFilter = "all",
  limit = 24,
) {
  const fixtureSearch = searchPlaywrightDiscoveryFixture(query);

  if (fixtureSearch.kind === "handled") {
    return {
      kind: "live" as const,
      results: fixtureSearch.results
        .filter((result) => matchesSearchFilter(result, filter))
        .map(withSearchClaimEntry),
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, results: [] };
  }

  try {
    const results = await fetchQuery(api.search.searchUniversal, {
      query,
      limit,
      ...publicSearchBackendFilters(filter),
    });

    return {
      kind: "live" as const,
      results: results.map(withSearchClaimEntry),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex search fetch failed: ${message}`);

    return {
      kind: "error" as const,
      results: [],
    };
  }
}

export async function fetchProfileLookup(query: string) {
  const fixtureLookup = getPlaywrightProfileLookupFixture(query);
  const fixturePrivateResults = fixtureLookup.kind === "handled"
    ? fixtureLookup.privateResults
    : undefined;
  const fixtureViewerAccess = fixtureLookup.kind === "handled"
    ? fixtureLookup.viewerAccess
    : undefined;

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return {
      kind: fixtureLookup.kind === "handled" ? ("live" as const) : ("missing-url" as const),
      privateResults: fixturePrivateResults ?? [] as PrivateSeedLookupResult[],
      results: fixtureLookup.kind === "handled" ? fixtureLookup.results : [],
      viewerAccess: fixtureViewerAccess ?? signedOutSeedAccess,
    };
  }

  try {
    const token = await convexAuthToken();
    const publicResultsPromise = fixtureLookup.kind === "handled"
      ? Promise.resolve(fixtureLookup.results)
      : query
        ? fetchQuery(api.search.searchUniversal, {
            query,
            limit: 12,
            entityType: "profile",
            profileType: "person",
          }).then((searchResults) => searchResults.flatMap((result) => result.person ?? []))
        : Promise.resolve([]);
    const viewerAccessPromise = fixtureViewerAccess
      ? Promise.resolve(fixtureViewerAccess)
      : token
      ? fetchQuery(seedAccessApi.viewerAccess, {}, { token })
      : Promise.resolve(signedOutSeedAccess);
    const [results, viewerAccess] = await Promise.all([publicResultsPromise, viewerAccessPromise]);
    const privateResults = fixturePrivateResults ?? (
      token && query && viewerAccess.allowed
        ? await fetchQuery(seedAccessApi.lookupPeople, { query, limit: 12 }, { token })
        : []
    );

    return {
      kind: "live" as const,
      privateResults,
      results,
      viewerAccess,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex lookup fetch failed: ${message}`);

    return {
      kind: "error" as const,
      privateResults: [] as PrivateSeedLookupResult[],
      results: [],
      viewerAccess: signedOutSeedAccess,
    };
  }
}

function emptyDiscoveryData() {
  return {
    featured: [],
    upcomingEvents: [],
    people: [],
    communities: [],
    worlds: [],
    terms: [],
    eventSchedule: [],
  };
}

export async function fetchEditableEventBySlug(slug: string) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, event: null };
  }

  try {
    const event = await fetchQuery(
      api.events.getEditableBySlug,
      { slug },
      { token: await convexAuthToken() },
    );

    return { kind: "live" as const, event };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Server-side Convex editable event fetch failed: ${message}`);
    return { kind: "error" as const, event: null };
  }
}
