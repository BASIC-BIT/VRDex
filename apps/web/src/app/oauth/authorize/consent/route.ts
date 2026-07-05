import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex-generated-api";

import { convexHttpClient } from "@/lib/server/convex-http";
import {
  normalizeOAuthAuthorizationRequest,
  redirectUriWithOAuthResult,
} from "@/lib/server/oauth-authorization-request";
import {
  createOAuthAuthorizationCodeValue,
  hashOAuthAuthorizationCodeValue,
} from "@/lib/server/oauth-pkce";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const authorizationCodeTtlMs = 10 * 60 * 1000;

function formToAuthorizeSearchParams(form: FormData) {
  const params = new URLSearchParams();

  for (const key of [
    "response_type",
    "client_id",
    "redirect_uri",
    "resource",
    "scope",
    "code_challenge",
    "code_challenge_method",
    "state",
  ]) {
    const value = form.get(key);

    if (typeof value === "string" && value.trim()) {
      params.set(key, value);
    }
  }

  return params;
}

function redirectResponse(location: string) {
  return Response.redirect(location, 303);
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_request", error_description: "OAuth consent requires form data." }, { status: 400 });
  }

  let authorization: ReturnType<typeof normalizeOAuthAuthorizationRequest>;

  try {
    authorization = normalizeOAuthAuthorizationRequest(form, request);
  } catch (error) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: error instanceof Error ? error.message : "The authorization request is invalid.",
      },
      { status: 400 },
    );
  }

  if (String(form.get("decision") ?? "") !== "approve") {
    return redirectResponse(
      redirectUriWithOAuthResult({
        error: "access_denied",
        errorDescription: "The resource owner denied the request.",
        redirectUri: authorization.redirectUri,
        state: authorization.state,
      }),
    );
  }

  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    const redirectTo = `/oauth/authorize?${formToAuthorizeSearchParams(form).toString()}`;

    return redirectResponse(new URL(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`, request.url).toString());
  }

  const now = Date.now();
  const code = createOAuthAuthorizationCodeValue();
  const convex = convexHttpClient();

  convex.setAuth(authToken);

  const result = await convex.mutation(api.oauthApps.issueAuthorizationCode, {
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    requestedScopes: authorization.requestedScopes,
    resource: authorization.resource,
    codeHash: await hashOAuthAuthorizationCodeValue(code),
    codeChallenge: authorization.codeChallenge,
    codeChallengeMethod: authorization.codeChallengeMethod,
    expiresAt: now + authorizationCodeTtlMs,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.reason,
        error_description: "The OAuth client cannot use the requested redirect URI, resource, or scopes.",
      },
      { status: 400 },
    );
  }

  return redirectResponse(
    redirectUriWithOAuthResult({
      code,
      redirectUri: result.redirectUri,
      state: authorization.state,
    }),
  );
}
