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

  return convexSecret;
}

function convexClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured for E2E helpers.");
  }

  return new ConvexHttpClient(convexUrl);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function fieldVisibility(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const allowed = new Set(["public", "unlisted", "private"]);
  const entries = Object.entries(value).filter((entry): entry is [string, "public" | "unlisted" | "private"] => allowed.has(String(entry[1])));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export async function POST(request: NextRequest) {
  const convexSecret = requireE2eRequest(request);

  if (convexSecret === null) {
    return e2eError("E2E helpers are not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return e2eError("Invalid JSON body.", 400);
  }
  const body = rawBody as Record<string, unknown>;

  const result = await convexClient().mutation(api.e2e.submitProfile, {
    secret: convexSecret,
    runId: String(body.runId ?? "playwright"),
    profileType: body.profileType === "community" ? "community" : "person",
    displayName: String(body.displayName ?? ""),
    aliases: stringArray(body.aliases),
    tags: stringArray(body.tags),
    headline: optionalString(body.headline),
    bio: optionalString(body.bio),
    about: optionalString(body.about),
    region: optionalString(body.region),
    timezone: optionalString(body.timezone),
    fieldVisibility: fieldVisibility(body.fieldVisibility),
    person: body.profileType === "community" ? undefined : { pronouns: optionalString(body.pronouns), roleTags: stringArray(body.roleTags) },
    community:
      body.profileType === "community"
        ? {
            subtype: optionalString(body.subtype),
            categoryTags: stringArray(body.categoryTags),
          }
        : undefined,
  });

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const convexSecret = requireE2eRequest(request);

  if (convexSecret === null) {
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
    ? await convexClient().mutation(api.e2e.cleanupProfileBySlug, { secret: convexSecret, slug })
    : await convexClient().mutation(api.e2e.cleanupProfilesByRunId, { secret: convexSecret, runId });

  return NextResponse.json(result);
}
