import { convexAuthToken } from "@/lib/server/auth";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { NextResponse, type NextRequest } from "next/server";

import { api } from "@convex-generated-api";
import { appendReturnPathQuery, resolveSameOriginUrl } from "@/lib/return-path";
import {
  unauthenticatedRedirectResponse,
  signInPath,
  isUnauthenticatedError,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

function withAnalyticsJourney(
  path: string,
  analyticsJourneyId?: string | null,
  discordOAuthReturn = false,
): string {
  return appendReturnPathQuery(path, {
    analyticsJourneyId: analyticsJourneyId ?? undefined,
    discordOAuthReturn: discordOAuthReturn ? "1" : undefined,
  });
}

function withStatus(
  path: string,
  status: string,
  count?: number,
  analyticsJourneyId?: string,
): string {
  return appendReturnPathQuery(path, {
    discordVerify: status,
    discordGuilds: count,
    analyticsJourneyId,
  });
}

/**
 * Where the round-trip started, recovered from an invalid-session error.
 *
 * The single-use state row is the only record of it, and by the time a revoked
 * session surfaces the actions have either consumed that row or refused to.
 * Both attach it to the error so sign-in can return the user to the claim they
 * were part-way through; `signInPath` validates the value.
 */
function carriedReturnTo(error: unknown): string {
  const data = (error as {
    data?: { returnTo?: unknown; analyticsJourneyId?: unknown };
  }).data;
  const carried = data?.returnTo;
  const returnTo = typeof carried === "string" ? carried : "/account";

  return withAnalyticsJourney(
    returnTo,
    typeof data?.analyticsJourneyId === "string" ? data.analyticsJourneyId : undefined,
    true,
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const token = await convexAuthToken();

  if (!token) {
    // No session at all — the refresh failed while the user was on Discord's
    // consent screen. The state row still knows where they started, and losing
    // it here would send them through sign-in to `/account` instead of the
    // claim they were completing. Read-only and unconsumed, so the round-trip
    // still works if they sign back in.
    const pending = state
      ? await fetchQuery(api.discordVerification.peekVerificationReturnTo, { state }).catch(
          () => ({ returnTo: null, analyticsJourneyId: null }),
        )
      : { returnTo: null, analyticsJourneyId: null };

    return NextResponse.redirect(
      new URL(
        signInPath(withAnalyticsJourney(
          pending.returnTo ?? "/account",
          pending.analyticsJourneyId,
          true,
        )),
        request.nextUrl.origin,
      ),
    );
  }

  // A declined consent screen comes back with the original `state` but no
  // `code`. Consume the row so it is not stranded, and return the user to the
  // page they started from rather than dropping them on /account.
  if (!code) {
    // Discord also omits `code` for provider and configuration errors such as
    // `temporarily_unavailable` or `invalid_request`. Reporting those as
    // "declined" would tell the user they refused something they did not.
    const oauthError = request.nextUrl.searchParams.get("error");
    const status =
      oauthError === null || oauthError === "access_denied" ? "declined" : "failed";
    let declinedReturnTo = "/account";
    let analyticsJourneyId: string | undefined;

    if (state) {
      try {
        ({ returnTo: declinedReturnTo, analyticsJourneyId } = await fetchAction(
          api.discordVerification.abandonGuildVerification,
          { state },
          { token },
        ));
      } catch (error) {
        // A session revoked or expired while the user sat on Discord's consent
        // screen still leaves a cached JWT that made `token` truthy above, so
        // it surfaces here. Redirecting past it leaves the stale auth cookies
        // in place; the successful-code branch below clears them, and a
        // declined one is no different.
        if (isUnauthenticatedError(error)) {
          return unauthenticatedRedirectResponse(request, carriedReturnTo(error));
        }

        // An unknown or expired state is not worth surfacing: the user simply
        // lands on their account page.
      }
    }

    return NextResponse.redirect(
      resolveSameOriginUrl(
        withStatus(declinedReturnTo, status, undefined, analyticsJourneyId),
        request.nextUrl.origin,
      ),
    );
  }

  if (!state) {
    return NextResponse.redirect(
      resolveSameOriginUrl(withStatus("/account", "failed"), request.nextUrl.origin),
    );
  }

  try {
    const { status, returnTo, analyticsJourneyId, verifiedGuildCount } = await fetchAction(
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
          ? withStatus(returnTo, "verified", verifiedGuildCount, analyticsJourneyId)
          : withStatus(returnTo, "failed", undefined, analyticsJourneyId),
        request.nextUrl.origin,
      ),
    );
  } catch (error) {
    // Same reasoning as the start route: a revoked session is not an outage,
    // and sending the user back with `failed` would tell them the Discord check
    // went wrong when the fix is to sign in again.
    if (isUnauthenticatedError(error)) {
      return unauthenticatedRedirectResponse(request, carriedReturnTo(error));
    }

    console.error(
      `Discord guild verification callback failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    return NextResponse.redirect(new URL(withStatus("/account", "failed"), request.nextUrl.origin));
  }
}
