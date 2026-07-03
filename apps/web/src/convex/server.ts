import { fetchQuery } from "convex/nextjs";
import { api } from "@convex-generated-api";
import {
  getPlaywrightActiveWorldFixtures,
  getPlaywrightDiscoveryFixture,
  getPlaywrightProfileLookupFixture,
  getPlaywrightPublicEventFixture,
  getPlaywrightPublicProfileFixture,
  getPlaywrightPublicWorldFixture,
  searchPlaywrightDiscoveryFixture,
} from "./playwright-fixtures";

type PublicProfileType = "person" | "community";

export async function fetchBackendStatus() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const data = await fetchQuery(api.health.status, {});

    return {
      kind: "live" as const,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex fetchQuery failed: ${message}`);

    return {
      kind: "error" as const,
    };
  }
}

export async function fetchPublicProfileBySlug(slug: string, profileType: PublicProfileType) {
  const fixtureProfile = getPlaywrightPublicProfileFixture(slug, profileType);

  if (fixtureProfile !== null) {
    return {
      kind: "live" as const,
      profile: fixtureProfile,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const };
  }

  try {
    const profile = await fetchQuery(api.profiles.getPublicBySlug, {
      slug,
      profileType,
      now: Date.now(),
    });

    return {
      kind: "live" as const,
      profile,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex profile fetch failed: ${message}`);

    return {
      kind: "error" as const,
    };
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

export async function fetchPublicShortLinkTargetByCode(code: string) {
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
  const fixtureDiscovery = getPlaywrightDiscoveryFixture();

  if (fixtureDiscovery !== null) {
    return {
      kind: "live" as const,
      data: fixtureDiscovery,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, data: emptyDiscoveryData() };
  }

  try {
    const data = await fetchQuery(api.search.listDiscovery, { now: Date.now() });

    return {
      kind: "live" as const,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex discovery fetch failed: ${message}`);

    return {
      kind: "error" as const,
      data: emptyDiscoveryData(),
    };
  }
}

export async function fetchDiscoverySearch(query: string) {
  const fixtureSearch = searchPlaywrightDiscoveryFixture(query);

  if (fixtureSearch.kind === "handled") {
    return {
      kind: "live" as const,
      results: fixtureSearch.results,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, results: [] };
  }

  try {
    const results = await fetchQuery(api.search.searchUniversal, { query, limit: 24 });

    return {
      kind: "live" as const,
      results,
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

  if (fixtureLookup.kind === "handled") {
    return {
      kind: "live" as const,
      results: fixtureLookup.results,
    };
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return { kind: "missing-url" as const, results: [] };
  }

  try {
    const results = await fetchQuery(api.profiles.lookupPeople, { query, limit: 12 });

    return {
      kind: "live" as const,
      results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`Server-side Convex lookup fetch failed: ${message}`);

    return {
      kind: "error" as const,
      results: [],
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
  };
}
