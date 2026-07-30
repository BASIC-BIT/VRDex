import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

import { failRecentAuthChallengeMutation } from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import { expireAuthSessionCookies } from "@/lib/server/invalid-auth-session";
import {
  clearRecentAuthBindingCookie,
  decodeRecentAuthBinding,
  readRecentAuthBindingCookie,
} from "@/lib/server/recent-auth-binding";
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
  const binding = decodeRecentAuthBinding(
    readRecentAuthBindingCookie(request, challengeId),
  );
  if (
    challengeId === null ||
    binding === null ||
    binding.challengeId !== challengeId
  ) {
    return new Response(null, {
      status: 303,
      headers: {
        "cache-control": "private, no-store",
        location: returnTo,
      },
    });
  }
  let authToken: string | undefined;
  try {
    authToken = await convexAuthNextjsToken();
  } catch {
    authToken = undefined;
  }

  if (authToken !== undefined) {
    const convex = convexHttpClient();
    convex.setAuth(authToken);
    try {
      const failure = await convex.mutation(failRecentAuthChallengeMutation, {
        challengeId,
      });
      if (!failure.clearAuth) {
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
    } catch {
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
  }

  if (authToken === undefined) {
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

  return expireAuthSessionCookies(
    clearRecentAuthBindingCookie(
      new Response(null, {
        status: 303,
        headers: {
          "cache-control": "private, no-store",
          location: `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
        },
      }),
      request,
      challengeId,
    ),
  );
}
