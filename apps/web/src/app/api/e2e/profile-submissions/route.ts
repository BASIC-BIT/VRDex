import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

import { api } from "@convex-generated-api";

export const dynamic = "force-dynamic";

function e2eError(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status });
}

function requireE2eRequest(request: NextRequest) {
  const browserToken = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
  const convexSecret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();
  const requestToken = request.headers.get("x-vrdex-e2e-token") ?? request.cookies.get("vrdex_e2e_token")?.value;

  if (process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" || !browserToken || !convexSecret || requestToken !== browserToken) {
    return null;
  }

  return convexSecret;
}

function convexClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured for E2E helpers.");
  }

  return new ConvexHttpClient(convexUrl);
}

export async function POST(request: NextRequest) {
  const secret = requireE2eRequest(request);

  if (secret === null) {
    return e2eError("E2E helpers are not enabled for this request.");
  }

  const body = await request.json();
  const result = await convexClient().mutation(api.e2e.submitProfile, {
    secret,
    runId: String(body.runId ?? "playwright"),
    profileType: body.profileType === "community" ? "community" : "person",
    displayName: String(body.displayName ?? ""),
    aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : [],
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    person: body.profileType === "community" ? undefined : { roleTags: Array.isArray(body.roleTags) ? body.roleTags.map(String) : [] },
    community:
      body.profileType === "community"
        ? {
            subtype: typeof body.subtype === "string" ? body.subtype : undefined,
            categoryTags: Array.isArray(body.categoryTags) ? body.categoryTags.map(String) : [],
          }
        : undefined,
  });

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const secret = requireE2eRequest(request);

  if (secret === null) {
    return e2eError("E2E helpers are not enabled for this request.");
  }

  const body = await request.json();
  const result = await convexClient().mutation(api.e2e.cleanupProfileBySlug, {
    secret,
    slug: String(body.slug ?? ""),
  });

  return NextResponse.json(result);
}
