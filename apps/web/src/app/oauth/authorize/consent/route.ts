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

  const decision = String(form.get("decision") ?? "");

  if (decision !== "approve" && decision !== "deny") {
    return Response.json(
      { error: "invalid_request", error_description: "OAuth consent requires an approve or deny decision." },
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

  const viewer = await convex.query(api.accounts.viewer, {});

  if (viewer === null) {
    return Response.json(
      { error: "invalid_request", error_description: "The OAuth consent transaction is invalid or expired." },
      { headers: { "cache-control": "no-store", pragma: "no-cache" }, status: 400 },
    );
  }

  const code = decision === "approve" ? createOAuthAuthorizationCodeValue() : undefined;
  const result = await convexAdminHttpClient().mutation(internal.oauthApps.completeAuthorizationConsent, {
    transactionHash: hashOAuthConsentTransactionValue(transaction),
    userId: viewer.user.id,
    decision,
    ...(code === undefined
      ? {}
      : {
          codeHash: await hashOAuthAuthorizationCodeValue(code),
          expiresAt: Date.now() + authorizationCodeTtlMs,
        }),
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

  if (!result.approved) {
    return redirectResponse(
      redirectUriWithOAuthResult({
        error: "access_denied",
        errorDescription: "The resource owner denied the request.",
        redirectUri: result.redirectUri,
        state: result.state,
      }),
    );
  }

  if (code === undefined) {
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  return redirectResponse(
    redirectUriWithOAuthResult({
      code,
      redirectUri: result.redirectUri,
      state: result.state,
    }),
  );
}
