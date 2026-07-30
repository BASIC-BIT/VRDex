import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

import {
  activeAuthSessionViewerQuery,
  completeRecentAuthChallengeMutation,
} from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import { expireAuthSessionCookies } from "@/lib/server/invalid-auth-session";
import {
  clearRecentAuthBindingCookie,
  readRecentAuthBindingCookie,
  recentAuthBindingDecision,
  setRecentAuthFinishCookie,
} from "@/lib/server/recent-auth-binding";
import {
  reauthenticationFinishPath,
  validRecentAuthChallengeId,
} from "@/lib/recent-auth";
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

function completionResponse(destination: string, json: boolean) {
  if (!json) {
    return redirect(destination);
  }
  return Response.json(
    { destination },
    {
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );
}

async function completeReauthentication({
  challengeId,
  json,
  request,
  returnTo,
}: {
  challengeId: string | null;
  json: boolean;
  request: Request;
  returnTo: string;
}) {
  const bindingValue = readRecentAuthBindingCookie(request, challengeId);
  const authToken = await convexAuthNextjsToken();
  let currentUserId: string | null = null;
  let convex: ReturnType<typeof convexHttpClient> | null = null;

  if (authToken !== undefined) {
    convex = convexHttpClient();
    convex.setAuth(authToken);
    let viewer;
    try {
      viewer = await convex.query(activeAuthSessionViewerQuery, {});
    } catch {
      return clearRecentAuthBindingCookie(
        completionResponse(
          `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
          json,
        ),
        request,
        challengeId,
      );
    }
    if (viewer === null) {
      currentUserId = null;
    } else {
      currentUserId = viewer.user.id;
    }
  }

  const decision = recentAuthBindingDecision({
    binding: bindingValue,
    challengeId,
    currentUserId,
  });
  let completion:
    | {
        actionClass:
          | "developer_oauth_application"
          | "developer_token"
          | "session_revocation";
        clearAuth: false;
        state: "completed";
      }
    | {
        clearAuth: boolean;
        state: "already_completed" | "mismatch" | "missing";
      };
  try {
    completion =
      challengeId !== null && convex !== null
        ? await convex.mutation(completeRecentAuthChallengeMutation, {
            bindingConfirmed: decision === "match",
            challengeId,
          })
        : { clearAuth: false, state: "missing" as const };
  } catch {
    return clearRecentAuthBindingCookie(
      completionResponse(
        `/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
        json,
      ),
      request,
      challengeId,
    );
  }
  const clearAuth = completion.clearAuth;
  const destination =
    (completion.state === "completed" ||
      completion.state === "already_completed") &&
    challengeId !== null
      ? reauthenticationFinishPath(returnTo, challengeId)
      : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  const response = clearRecentAuthBindingCookie(
    completionResponse(destination, json),
    request,
    challengeId,
  );

  if (
    completion.state === "completed" &&
    challengeId !== null &&
    "actionClass" in completion
  ) {
    setRecentAuthFinishCookie(response, request, {
      actionClass: completion.actionClass,
      challengeId,
      issuedAt: Date.now(),
    });
  }

  return clearAuth
    ? expireAuthSessionCookies(response)
    : response;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  return completeReauthentication({
    challengeId: validRecentAuthChallengeId(
      requestUrl.searchParams.get("challenge"),
    ),
    json: false,
    request,
    returnTo: validateSignInReturnTo(
      requestUrl.searchParams.get("returnTo"),
    ),
  });
}

export async function POST(request: Request) {
  let payload: { challenge?: unknown; returnTo?: unknown } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    // Invalid input follows the same fail-closed path as a missing challenge.
  }
  return completeReauthentication({
    challengeId: validRecentAuthChallengeId(
      typeof payload.challenge === "string" ? payload.challenge : null,
    ),
    json: true,
    request,
    returnTo: validateSignInReturnTo(
      typeof payload.returnTo === "string" ? payload.returnTo : null,
    ),
  });
}
