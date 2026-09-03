import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";

import { api } from "@convex-generated-api";
import { getPlaywrightPublicProfileFixture } from "@/convex/playwright-fixtures";
import { getVrcdnLiveStates } from "@/lib/server/vrcdn-live";
import { validateSlugFormat } from "../../../../../../../../convex/_globalSlugs";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store",
};

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug: requestedSlug } = await context.params;
  const validation = validateSlugFormat(requestedSlug);

  if (!validation.ok) {
    return NextResponse.json({ states: {} }, { headers: responseHeaders, status: 404 });
  }

  const slug = validation.slug;
  const fixtureProfile =
    getPlaywrightPublicProfileFixture(slug, "person") ??
    getPlaywrightPublicProfileFixture(slug, "community");

  if (fixtureProfile !== null) {
    return NextResponse.json(
      { states: fixtureProfile.vrcdnLive ?? {} },
      { headers: responseHeaders },
    );
  }

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return NextResponse.json({ states: {} }, { headers: responseHeaders, status: 503 });
  }

  try {
    const profile = await fetchQuery(api.profiles.getPublicBySlug, {
      includeTelemetry: false,
      now: Date.now(),
      slug,
    });

    if (profile === null) {
      return NextResponse.json({ states: {} }, { headers: responseHeaders, status: 404 });
    }

    // Every browser heartbeat and player sanity check needs a provider
    // observation made for this request. The server render still uses the
    // shared one-minute cache, but this route deliberately bypasses it.
    const states = await getVrcdnLiveStates(profile.outboundLinks, { freshnessMode: "fresh" });

    return NextResponse.json({ states: states ?? {} }, { headers: responseHeaders });
  } catch {
    console.error(JSON.stringify({
      errorKind: "route",
      level: "error",
      message: "VRCDN profile live-state route failed",
    }));

    return NextResponse.json({ states: {} }, { headers: responseHeaders, status: 503 });
  }
}
