import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api, internal } from "@convex-generated-api";

import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import { redirectUriWithOAuthResult } from "@/lib/server/oauth-authorization-request";
import {
  hashOAuthConsentTransactionValue,
  normalizeOAuthConsentTransactionValue,
  oauthConsentOriginAllowed,
} from "@/lib/server/oauth-consent-transaction";
import {
  createOAuthAuthorizationCodeValue,
  hashOAuthAuthorizationCodeValue,
} from "@/lib/server/oauth-pkce";
import { oauthRateLimitResponse } from "@/lib/server/oauth-route-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const authorizationCodeTtlMs = 10 * 60 * 1000;

function redirectResponse(location: string) {
  return Response.redirect(location, 303);
}

export async function POST(request: Request) {
  const rateLimited = await oauthRateLimitResponse(request, "oauth_authorize");

  if (rateLimited !== null) {
    return rateLimited;
  }

  if (!oauthConsentOriginAllowed(request)) {
    return Response.json(
      { error: "invalid_request", error_description: "OAuth consent origin validation failed." },
      { headers: { "cache-control": "no-store", pragma: "no-cache" }, status: 403 },
    );
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_request", error_description: "OAuth consent requires form data." }, { status: 400 });
  }

  let transaction: string;

  try {
    transaction = normalizeOAuthConsentTransactionValue(String(form.get("transaction") ?? ""));
  } catch {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "The OAuth consent transaction is invalid or expired.",
      },
      { headers: { "cache-control": "no-store", pragma: "no-cache" }, status: 400 },
    );
  }

  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    const redirectTo = `/oauth/authorize/review?transaction=${encodeURIComponent(transaction)}`;

    return redirectResponse(new URL(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`, request.url).toString());
  }

  const convex = convexHttpClient();
  convex.setAuth(authToken);

  const consumed = await convex.mutation(api.oauthConsentTransactions.consume, {
    transactionHash: hashOAuthConsentTransactionValue(transaction),
  });

  if (!consumed.ok) {
    return Response.json(
      { error: "invalid_request", error_description: "The OAuth consent transaction is invalid or expired." },
      { headers: { "cache-control": "no-store", pragma: "no-cache" }, status: 400 },
    );
  }

  const authorization = consumed.authorization;

  const client = await convexAdminHttpClient().query(internal.oauthApps.resolveAuthorizationClient, {
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    requestedScopes: authorization.requestedScopes,
    resource: authorization.resource,
  });

  if (!client.ok) {
    return Response.json(
      {
        error: "invalid_request",
        error_description: "The OAuth client cannot use the requested redirect URI, resource, or scopes.",
      },
      { headers: { "cache-control": "no-store", pragma: "no-cache" }, status: 400 },
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

  const now = Date.now();
  const code = createOAuthAuthorizationCodeValue();

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
