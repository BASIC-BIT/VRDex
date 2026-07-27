import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";
import { resolveSameOriginUrl } from "@/lib/return-path";

export const dynamic = "force-dynamic";

function withStatus(path: string, status: string, count?: number): string {
  const separator = path.includes("?") ? "&" : "?";
  const suffix = count === undefined ? "" : `&discordGuilds=${count}`;

  return `${path}${separator}discordVerify=${status}${suffix}`;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const token = await convexAuthNextjsToken();

  // The user declined the Discord consent screen, or Discord sent us back
  // without the pair we need.
  if (!code || !state) {
    return NextResponse.redirect(new URL(withStatus("/account", "declined"), request.nextUrl.origin));
  }

  if (!token) {
    return NextResponse.redirect(
      new URL(`/sign-in?returnTo=${encodeURIComponent("/account")}`, request.nextUrl.origin),
    );
  }

  try {
    const { status, returnTo, verifiedGuildCount } = await fetchAction(
      api.discordVerification.completeGuildVerification,
      { code, state },
      { token },
    );

    // The action reports operational failure in its result rather than
    // throwing, so a transient Discord outage still returns the user to the
    // page they started from instead of stranding them on /account.
    return NextResponse.redirect(
      resolveSameOriginUrl(
        status === "verified"
          ? withStatus(returnTo, "verified", verifiedGuildCount)
          : withStatus(returnTo, "failed"),
        request.nextUrl.origin,
      ),
    );
  } catch (error) {
    console.error(
      `Discord guild verification callback failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return NextResponse.redirect(new URL(withStatus("/account", "failed"), request.nextUrl.origin));
  }
}
