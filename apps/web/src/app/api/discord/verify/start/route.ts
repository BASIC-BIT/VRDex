import { convexAuthToken } from "@/lib/server/auth";
import { fetchAction } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl, safeReturnPath } from "@/lib/return-path";
import {
  unauthenticatedRedirectResponse,
  isUnauthenticatedError,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  const analyticsJourneyId = request.nextUrl.searchParams.get("analyticsJourneyId") ?? undefined;
  const analyticsEntrySourceValue = request.nextUrl.searchParams.get("analyticsEntrySource");
  const analyticsEntrySource =
    analyticsEntrySourceValue === "account" ||
    analyticsEntrySourceValue === "profile" ||
    analyticsEntrySourceValue === "search"
      ? analyticsEntrySourceValue
      : undefined;
  const analyticsProfileTypeValue = request.nextUrl.searchParams.get("analyticsProfileType");
  const analyticsProfileType =
    analyticsProfileTypeValue === "person" || analyticsProfileTypeValue === "community"
      ? analyticsProfileTypeValue
      : undefined;
  const token = await convexAuthToken();

  if (!token) {
    return NextResponse.redirect(
      new URL(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`, request.nextUrl.origin),
    );
  }

  try {
    const { authorizeUrl } = await fetchAction(
      api.discordVerification.startGuildVerification,
      { returnTo, analyticsJourneyId, analyticsEntrySource, analyticsProfileType },
      { token },
    );

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    // A revoked or expired session is not an outage. The JWT cookie stays valid
    // for up to an hour after revocation, so without this the guard's
    // `AUTH_SESSION_INVALID` fell into the generic branch below and the user was
    // told to "try again" on something retrying can never fix — and the stale
    // cookies were never cleared.
    if (isUnauthenticatedError(error)) {
      return unauthenticatedRedirectResponse(request, returnTo);
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
