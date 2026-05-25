import { fetchQuery } from "convex/nextjs";
import { api } from "@convex-generated-api";
import { getPlaywrightPublicProfileFixture, getPlaywrightPublicWorldFixture } from "./playwright-fixtures";

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
    const profile = await fetchQuery(api.profiles.getPublicBySlug, { slug, profileType });

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
    const world = await fetchQuery(api.worlds.getPublicBySlug, { slug });

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
