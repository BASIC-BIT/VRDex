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
  const productionBlocked = process.env.VERCEL_ENV === "production" && process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS !== "true";

  if (productionBlocked || process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" || !browserToken || !convexSecret || requestToken !== browserToken) {
    return null;
  }

  return true;
}

function convexClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured for E2E helpers.");
  }

  return new ConvexHttpClient(convexUrl);
}

export async function POST(request: NextRequest) {
  const allowed = requireE2eRequest(request);

  if (allowed === null) {
    return e2eError("E2E helpers are not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return e2eError("Invalid JSON body.", 400);
  }
  const body = rawBody as Record<string, unknown>;

  const result = await convexClient().mutation(api.e2e.submitProfile, {
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
  const allowed = requireE2eRequest(request);

  if (allowed === null) {
    return e2eError("E2E helpers are not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return e2eError("Invalid JSON body.", 400);
  }
  const body = rawBody as Record<string, unknown>;

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";

  if (!slug && !runId) {
    return e2eError("Cleanup requires a slug or runId.", 400);
  }

  const result = slug
    ? await convexClient().mutation(api.e2e.cleanupProfileBySlug, { slug })
    : await convexClient().mutation(api.e2e.cleanupProfilesByRunId, { runId });

  return NextResponse.json(result);
}
