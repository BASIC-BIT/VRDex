import { fetchQuery } from "convex/nextjs";
import { api } from "@convex-generated-api";
import {
  getPlaywrightActiveWorldFixtures,
  getPlaywrightPublicEventFixture,
  getPlaywrightPublicProfileFixture,
  getPlaywrightPublicWorldFixture,
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
