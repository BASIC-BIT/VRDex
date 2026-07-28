import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

import { cancelRecentAuthChallengeMutation } from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import { clearRecentAuthBindingCookie } from "@/lib/server/recent-auth-binding";
import { validRecentAuthChallengeId } from "@/lib/recent-auth";
import { validateSignInReturnTo } from "@/lib/safe-return-to";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = validateSignInReturnTo(
    requestUrl.searchParams.get("returnTo"),
  );
  const challengeId = validRecentAuthChallengeId(
    requestUrl.searchParams.get("challenge"),
  );
  const authToken = await convexAuthNextjsToken();

  if (authToken !== undefined && challengeId !== null) {
    const convex = convexHttpClient();
    convex.setAuth(authToken);
    try {
      await convex.mutation(cancelRecentAuthChallengeMutation, {
        challengeId,
      });
    } catch {
      // Cookie cleanup and safe navigation do not depend on backend cleanup.
    }
  }

  return clearRecentAuthBindingCookie(
    new Response(null, {
      status: 303,
      headers: {
        "cache-control": "private, no-store",
        location: returnTo,
      },
    }),
    request,
    challengeId,
  );
}
