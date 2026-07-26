import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

import { api } from "@convex-generated-api";

export const dynamic = "force-dynamic";

function e2eError(message: string, status = 403) {
  return NextResponse.json({ error: message }, { status });
}

function requireE2eAuthRequest(request: NextRequest) {
  const browserToken = process.env.VRDEX_E2E_BROWSER_TOKEN?.trim();
  const convexSecret = process.env.VRDEX_E2E_CONVEX_SECRET?.trim();
  const requestToken = request.headers.get("x-vrdex-e2e-token") ?? request.cookies.get("vrdex_e2e_token")?.value;
  const productionBlocked = process.env.VERCEL_ENV === "production" && process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS !== "true";

  if (
    productionBlocked ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true" ||
    !browserToken ||
    !convexSecret ||
    requestToken !== browserToken
  ) {
    return null;
  }

  return convexSecret;
}

function convexClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    throw new Error("Convex URL is not configured for E2E auth helpers.");
  }

  return new ConvexHttpClient(convexUrl);
}

export async function POST(request: NextRequest) {
  const convexSecret = requireE2eAuthRequest(request);

  if (convexSecret === null) {
    return e2eError("E2E auth helpers are not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return e2eError("Invalid JSON body.", 400);
  }
  const body = rawBody as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const email = typeof body.email === "string" ? body.email : "";

  if (action === "consume-code") {
    const result = await convexClient().mutation(api.e2e.consumeAuthCode, { secret: convexSecret, email });

    return NextResponse.json(result);
  }

  if (action === "link-discord") {
    const providerAccountId = typeof body.providerAccountId === "string" ? body.providerAccountId : "";
    const result = await convexClient().mutation(api.e2e.linkDiscordAccountByEmail, {
      secret: convexSecret,
      email,
      providerAccountId,
    });

    return NextResponse.json(result);
  }

  if (action === "set-session-state") {
    const state =
      body.state === "absolute_expired" ||
      body.state === "inactive_expired" ||
      body.state === "invalid_refresh" ||
      body.state === "revoked"
        ? body.state
        : null;
    const now = typeof body.now === "number" ? body.now : Number.NaN;

    if (state === null || !Number.isFinite(now)) {
      return e2eError("Invalid E2E auth session state.", 400);
    }

    const result = await convexClient().mutation(
      api.e2e.setAuthSessionStateByEmail,
      {
        secret: convexSecret,
        email,
        state,
        now,
      },
    );

    return NextResponse.json(result);
  }

  return e2eError("Unsupported E2E auth helper action.", 400);
}

export async function DELETE(request: NextRequest) {
  const convexSecret = requireE2eAuthRequest(request);

  if (convexSecret === null) {
    return e2eError("E2E auth helpers are not enabled for this request.");
  }

  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== "object") {
    return e2eError("Invalid JSON body.", 400);
  }
  const body = rawBody as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const result = await convexClient().mutation(api.e2e.cleanupAuthUserByEmail, { secret: convexSecret, email });

  return NextResponse.json(result);
}
