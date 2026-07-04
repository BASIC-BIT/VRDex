import { api } from "@convex-generated-api";
import {
  createOAuthClientId,
  normalizeDynamicMcpClientRegistration,
} from "@vrdex/api-contracts";

import {
  checkApiRateLimit,
  clientIpForRequest,
  type ApiRateLimitResult,
} from "@/lib/server/api-rate-limit";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
  oauthIssuerUrl,
  oauthMcpResourceUri,
  oauthScopeString,
} from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function registrationProblem(
  status: 400 | 429 | 500,
  error: string,
  errorDescription: string,
  headers: HeadersInit = {},
) {
  return Response.json(
    {
      error,
      error_description: errorDescription,
    },
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

function rateLimitHeaders(rateLimit: ApiRateLimitResult) {
  return {
    "Retry-After": String(rateLimit.retryAfterSeconds),
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
    "RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1_000)),
  };
}

function requestBodyValue(body: unknown) {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  let rateLimit;

  try {
    rateLimit = await checkApiRateLimit({
      identity: { kind: "ip", value: clientIpForRequest(request) },
      routeClass: "oauth_dynamic_client_registration",
    });
  } catch {
    return registrationProblem(
      500,
      "server_error",
      "The server is not configured to rate-limit dynamic client registrations.",
    );
  }

  if (!rateLimit.allowed) {
    return registrationProblem(
      429,
      "temporarily_unavailable",
      "Too many dynamic client registration requests were sent from this network.",
      rateLimitHeaders(rateLimit),
    );
  }

  let body: Record<string, unknown>;

  try {
    body = requestBodyValue(await request.json());
  } catch {
    return registrationProblem(400, "invalid_request", "Send a JSON object when registering an OAuth client.");
  }

  let registration: ReturnType<typeof normalizeDynamicMcpClientRegistration>;

  try {
    registration = normalizeDynamicMcpClientRegistration(body);
  } catch (error) {
    return registrationProblem(
      400,
      "invalid_client_metadata",
      error instanceof Error ? error.message : "The client metadata is invalid.",
    );
  }

  const clientId = createOAuthClientId();
  const resource = oauthMcpResourceUri(request);

  let dynamicClient;

  try {
    dynamicClient = await convexHttpClient().mutation(api.oauthApps.createDynamicMcpClient, {
      clientId,
      clientName: registration.clientName,
      ...(registration.clientUri === undefined ? {} : { clientUri: registration.clientUri }),
      ...(registration.logoUri === undefined ? {} : { logoUri: registration.logoUri }),
      redirectUris: registration.redirectUris,
      grantTypes: registration.grantTypes,
      responseTypes: registration.responseTypes,
      tokenEndpointAuthMethod: registration.tokenEndpointAuthMethod,
      contacts: registration.contacts,
      ...(registration.softwareId === undefined ? {} : { softwareId: registration.softwareId }),
      ...(registration.softwareVersion === undefined ? {} : { softwareVersion: registration.softwareVersion }),
      allowedScopes: registration.allowedScopes,
      resource,
    });
  } catch {
    return registrationProblem(
      500,
      "server_error",
      "The server could not register this dynamic OAuth client.",
    );
  }

  const issuer = oauthIssuerUrl(request);

  return Response.json(
    {
      client_id: dynamicClient.clientId,
      client_id_issued_at: Math.floor(dynamicClient.createdAt / 1_000),
      client_name: dynamicClient.clientName,
      grant_types: dynamicClient.grantTypes,
      redirect_uris: dynamicClient.redirectUris,
      response_types: dynamicClient.responseTypes,
      scope: oauthScopeString(dynamicClient.allowedScopes),
      token_endpoint_auth_method: dynamicClient.tokenEndpointAuthMethod,
      ...(dynamicClient.clientUri === undefined ? {} : { client_uri: dynamicClient.clientUri }),
      ...(dynamicClient.logoUri === undefined ? {} : { logo_uri: dynamicClient.logoUri }),
      ...(dynamicClient.contacts.length === 0 ? {} : { contacts: dynamicClient.contacts }),
      ...(dynamicClient.softwareId === undefined ? {} : { software_id: dynamicClient.softwareId }),
      ...(dynamicClient.softwareVersion === undefined ? {} : { software_version: dynamicClient.softwareVersion }),
      resource,
      authorization_server: issuer,
    },
    {
      headers: {
        "cache-control": "no-store",
        pragma: "no-cache",
      },
      status: 201,
    },
  );
}
