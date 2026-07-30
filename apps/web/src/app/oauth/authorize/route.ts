import { convexAuthToken } from "@/lib/server/auth";
import { internal } from "@convex-generated-api";
import {
  isOAuthClientMetadataDocumentUrl,
  OAUTH_CONSENT_TRANSACTION_TTL_MS,
} from "@vrdex/api-contracts";

import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  clientIpForRequest,
} from "@/lib/server/api-rate-limit";
import { viewerQuery } from "@/lib/server/auth";
import { recordApiRateLimitBlockedEvent } from "@/lib/server/api-rate-limit-events";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  hostedMcpEventWriteGrantAllowed,
  hostedMcpEventWritesEnabled,
} from "@/lib/server/hosted-mcp-policy";
import { upsertClientMetadataDocumentMcpClient } from "@/lib/server/oauth-dynamic-client-persistence";
import { oauthAuthorizeProblemRedirect } from "@/lib/server/oauth-authorize-problem";
import { fetchOAuthClientMetadataDocument } from "@/lib/server/oauth-client-metadata-document";
import {
  createOAuthConsentTransactionValue,
  hashOAuthConsentTransactionValue,
} from "@/lib/server/oauth-consent-transaction";
import {
  normalizeOAuthAuthorizationRequest,
  redirectUriWithOAuthClientError,
} from "@/lib/server/oauth-authorization-request";
import { oauthIssuerUrl, oauthMcpResourceUri } from "@/lib/server/oauth-jwt";
import { oauthRateLimitResponse } from "@/lib/server/oauth-route-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function oauthProblem(status: 400 | 429 | 500, error: string, errorDescription: string, headers: HeadersInit = {}) {
  return Response.json(
    { error, error_description: errorDescription },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
        ...headers,
      },
      status,
    },
  );
}

function redirectResponse(location: string) {
  return Response.redirect(location, 303);
}

function recordAuthorizationClientRejection(
  client: { reason: string; redirectDiagnostics?: unknown },
) {
  console.warn("VRDex OAuth authorization client rejected.", {
    reason: client.reason,
    ...(client.redirectDiagnostics === undefined
      ? {}
      : { redirectDiagnostics: client.redirectDiagnostics }),
  });
}

async function ensureClientMetadataDocumentClient(
  authorization: ReturnType<typeof normalizeOAuthAuthorizationRequest>,
  request: Request,
) {
  if (!isOAuthClientMetadataDocumentUrl(authorization.clientId)) {
    return null;
  }

  if (authorization.resource !== oauthMcpResourceUri(request)) {
    throw new Error("Client metadata document clients can only request the hosted MCP resource.");
  }

  const identity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const routeClass = "oauth_dynamic_client_registration";
  const policy = apiRateLimitPolicyForRouteClass(routeClass);
  const rateLimit = await checkApiRateLimit({ identity, routeClass });

  if (!rateLimit.allowed) {
    await recordApiRateLimitBlockedEvent({
      identity,
      quotaTier: "standard",
      rateLimit,
      routeClass,
      windowMs: policy.windowMs,
    });

    return oauthProblem(
      429,
      "temporarily_unavailable",
      "Too many client metadata document requests were sent from this network.",
      {
        "Retry-After": String(rateLimit.retryAfterSeconds),
        "RateLimit-Limit": String(rateLimit.limit),
        "RateLimit-Remaining": String(rateLimit.remaining),
        "RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1_000)),
      },
    );
  }

  const allowEventWrites = hostedMcpEventWritesEnabled();
  const metadata = await fetchOAuthClientMetadataDocument(authorization.clientId, { allowEventWrites });

  await upsertClientMetadataDocumentMcpClient({
    clientId: metadata.clientId,
    clientName: metadata.clientName,
    ...(metadata.clientUri === undefined ? {} : { clientUri: metadata.clientUri }),
    ...(metadata.logoUri === undefined ? {} : { logoUri: metadata.logoUri }),
    redirectUris: metadata.redirectUris,
    grantTypes: metadata.grantTypes,
    responseTypes: metadata.responseTypes,
    tokenEndpointAuthMethod: metadata.tokenEndpointAuthMethod,
    contacts: metadata.contacts,
    ...(metadata.softwareId === undefined ? {} : { softwareId: metadata.softwareId }),
    ...(metadata.softwareVersion === undefined ? {} : { softwareVersion: metadata.softwareVersion }),
    allowedScopes: metadata.allowedScopes,
    ...(allowEventWrites ? { allowEventWrites: true } : {}),
    resource: authorization.resource,
  });

  return null;
}

export async function GET(request: Request) {
  const rateLimited = await oauthRateLimitResponse(request, "oauth_authorize");

  if (rateLimited !== null) {
    return rateLimited;
  }

  let authorization: ReturnType<typeof normalizeOAuthAuthorizationRequest>;

  try {
    authorization = normalizeOAuthAuthorizationRequest(new URL(request.url).searchParams, request);
  } catch {
    return oauthAuthorizeProblemRedirect(request, "invalid_request");
  }

  try {
    const metadataProblem = await ensureClientMetadataDocumentClient(authorization, request);

    if (metadataProblem !== null) {
      return metadataProblem;
    }
  } catch {
    return oauthAuthorizeProblemRedirect(request, "invalid_client_metadata");
  }

  const authToken = await convexAuthToken();

  if (authToken === undefined) {
    const redirectTo = `${new URL(request.url).pathname}${new URL(request.url).search}`;

    return redirectResponse(new URL(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`, oauthIssuerUrl(request)).toString());
  }

  const userConvex = convexHttpClient();

  userConvex.setAuth(authToken);
  const viewer = await userConvex.query(viewerQuery, {});

  if (viewer === null) {
    const redirectTo = `${new URL(request.url).pathname}${new URL(request.url).search}`;

    return redirectResponse(new URL(`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`, oauthIssuerUrl(request)).toString());
  }

  const client = await convexAdminHttpClient().query(internal.oauthApps.resolveAuthorizationClient, {
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    requestedScopes: authorization.requestedScopes,
    resource: authorization.resource,
  });

  if (!client.ok) {
    recordAuthorizationClientRejection(client);

    if (
      (client.reason === "invalid_scope" || client.reason === "wrong_resource") &&
      client.redirectUri !== undefined
    ) {
      return redirectResponse(
        redirectUriWithOAuthClientError({
          reason: client.reason,
          redirectUri: client.redirectUri,
          state: authorization.state,
        }),
      );
    }

    return oauthAuthorizeProblemRedirect(request, "invalid_client");
  }

  if (!hostedMcpEventWriteGrantAllowed({
    mcpResource: oauthMcpResourceUri(request),
    requestedScopes: authorization.requestedScopes,
    resource: authorization.resource,
  })) {
    return redirectResponse(
      redirectUriWithOAuthClientError({
        reason: "invalid_scope",
        redirectUri: authorization.redirectUri,
        state: authorization.state,
      }),
    );
  }

  const transaction = createOAuthConsentTransactionValue();

  try {
    await convexAdminHttpClient().mutation(internal.oauthConsentTransactions.create, {
      userId: viewer.user.id,
      transactionHash: await hashOAuthConsentTransactionValue(transaction),
      clientId: authorization.clientId,
      redirectUri: authorization.redirectUri,
      requestedScopes: authorization.requestedScopes,
      resource: authorization.resource,
      codeChallenge: authorization.codeChallenge,
      codeChallengeMethod: authorization.codeChallengeMethod,
      ...(authorization.state === undefined ? {} : { state: authorization.state }),
      expiresAt: Date.now() + OAUTH_CONSENT_TRANSACTION_TTL_MS,
    });
  } catch {
    return oauthAuthorizeProblemRedirect(request, "server_error");
  }

  const reviewUrl = new URL("/oauth/authorize/review", oauthIssuerUrl(request));
  reviewUrl.searchParams.set("transaction", transaction);

  return redirectResponse(reviewUrl.toString());
}
