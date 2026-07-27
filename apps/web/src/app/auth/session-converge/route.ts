import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

import {
  activeAuthSessionViewerQuery,
  cancelRecentAuthChallengeMutation,
} from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import { expireAuthSessionCookies } from "@/lib/server/invalid-auth-session";
import { clearRecentAuthBindingCookie } from "@/lib/server/recent-auth-binding";
import { validRecentAuthChallengeId } from "@/lib/recent-auth";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export const dynamic = "force-dynamic";

function redirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      "cache-control": "private, no-store",
      location: path,
    },
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = validateSignInReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );
  const challengeId = validRecentAuthChallengeId(
    requestUrl.searchParams.get("challenge"),
  );
  const authToken = await convexAuthNextjsToken();

  if (authToken !== undefined) {
    const convex = convexHttpClient();
    convex.setAuth(authToken);
    let viewer;
    try {
      viewer = await convex.query(activeAuthSessionViewerQuery, {});
    } catch {
      return expireAuthSessionCookies(
        clearRecentAuthBindingCookie(
          redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
          request,
          challengeId,
        ),
      );
    }
    if (viewer === null) {
      return expireAuthSessionCookies(
        clearRecentAuthBindingCookie(
          redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
          request,
          challengeId,
        ),
      );
    }
    if (challengeId !== null) {
      try {
        await convex.mutation(cancelRecentAuthChallengeMutation, {
          challengeId,
        });
      } catch {
        // Challenge expiry is bounded; convergence must not revoke a valid winner.
      }
    }
    return clearRecentAuthBindingCookie(
      redirect(returnTo),
      request,
      challengeId,
    );
  }

  return expireAuthSessionCookies(
    clearRecentAuthBindingCookie(
      redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
      request,
      challengeId,
    ),
  );
}
