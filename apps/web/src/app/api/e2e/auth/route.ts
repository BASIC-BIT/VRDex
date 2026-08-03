import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

import { api } from "@convex-generated-api";

export const dynamic = "force-dynamic";

/**
 * Server-side seam for the Clerk-backed auth E2E specs.
 *
 * Clerk owns accounts and sessions, so this route no longer mints them: the
 * Playwright fixture in `e2e/clerk-auth.ts` creates and deletes the Clerk user
 * through the Backend API, and signs in with a testing token. What is left here
 * is the VRDex-side state a claim depends on but that no external provider can
 * seed during a test — the Discord verification watermark and a guild control
 * proof — plus teardown of the Convex rows keyed to that account.
 *
 * The route exists rather than the specs calling Convex directly because
 * `VRDEX_E2E_CONVEX_SECRET` must not reach the browser or the runner. Playwright
 * only ever holds the browser token.
 *
 * Deliberately absent, and not to be restored: `consume-code` (Convex Auth email
 * codes) and `set-session-state` (Convex Auth session rows). Both named tables
 * that no longer exist, and their behaviour is Clerk's now.
 */
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

/**
 * Surfaces the Convex-side reason instead of letting the throw become an opaque
 * 500. Callers need to tell a genuine failure apart from a shared staging target
 * that has not deployed this revision yet, and an HTML error page cannot carry
 * that distinction.
 */
async function runHelperMutation<T>(operation: () => Promise<T>) {
  try {
    return NextResponse.json(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return NextResponse.json({ error: message }, { status: 400 });
  }
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

  if (action === "link-discord") {
    const providerAccountId = typeof body.providerAccountId === "string" ? body.providerAccountId : "";

    return await runHelperMutation(() =>
      convexClient().mutation(api.e2e.linkDiscordAccountByEmail, {
        secret: convexSecret,
        email,
        providerAccountId,
      }),
    );
  }

  if (action === "record-guild-proof") {
    const guildId = typeof body.guildId === "string" ? body.guildId : "";
    const guildName = typeof body.guildName === "string" ? body.guildName : undefined;

    return await runHelperMutation(() =>
      convexClient().mutation(api.e2e.recordGuildControlProofByEmail, {
        secret: convexSecret,
        email,
        guildId,
        ...(guildName !== undefined ? { guildName } : {}),
      }),
    );
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
