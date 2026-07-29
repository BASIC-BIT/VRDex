import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl, safeReturnPath } from "@/lib/return-path";
import {
  invalidAuthSessionRedirectResponse,
  isAuthSessionInvalidError,
} from "@/lib/server/invalid-auth-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  const token = await convexAuthNextjsToken();

  if (!token) {
    return NextResponse.redirect(
      new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
    );
  }

  try {
    const { authorizeUrl } = await fetchAction(
      api.discordVerification.startGuildVerification,
      { returnTo },
      { token },
    );

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    // A revoked or expired session is not an outage. The JWT cookie stays valid
    // for up to an hour after revocation, so without this the guard's
    // `AUTH_SESSION_INVALID` fell into the generic branch below and the user was
    // told to "try again" on something retrying can never fix — and the stale
    // cookies were never cleared.
    if (isAuthSessionInvalidError(error)) {
      return invalidAuthSessionRedirectResponse(request, returnTo);
    }

    console.error(
      `Discord guild verification start failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return NextResponse.redirect(
      resolveSameOriginUrl(
        appendReturnPathQuery(returnTo, { discordVerify: "unavailable" }),
        request.nextUrl.origin,
      ),
    );
  }
}
