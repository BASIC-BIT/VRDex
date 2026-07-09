import {
  createOAuthClientId,
  normalizeDynamicMcpClientRegistration,
} from "@vrdex/api-contracts";

import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  clientIpForRequest,
  type ApiRateLimitResult,
} from "./api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "./api-rate-limit-events";
import {
  oauthIssuerUrl,
  oauthMcpResourceUri,
  oauthScopeString,
} from "./oauth-jwt";

type NormalizedDynamicMcpClientRegistration = ReturnType<typeof normalizeDynamicMcpClientRegistration>;

export type DynamicMcpClientMutationInput = {
  allowedScopes: NormalizedDynamicMcpClientRegistration["allowedScopes"];
  clientId: string;
  clientName: string;
  clientUri?: string;
  contacts: NormalizedDynamicMcpClientRegistration["contacts"];
  grantTypes: NormalizedDynamicMcpClientRegistration["grantTypes"];
  logoUri?: string;
  redirectUris: NormalizedDynamicMcpClientRegistration["redirectUris"];
  resource: string;
  responseTypes: NormalizedDynamicMcpClientRegistration["responseTypes"];
  softwareId?: string;
  softwareVersion?: string;
  tokenEndpointAuthMethod: NormalizedDynamicMcpClientRegistration["tokenEndpointAuthMethod"];
};

type RegisteredDynamicMcpClient = {
  allowedScopes: readonly string[];
  clientId: string;
  clientName: string;
  clientUri?: string;
  contacts: readonly string[];
  createdAt: number;
  grantTypes: readonly string[];
  logoUri?: string;
  redirectUris: readonly string[];
  responseTypes: readonly string[];
  softwareId?: string;
  softwareVersion?: string;
  tokenEndpointAuthMethod: string;
};

export type DynamicMcpClientRegistrationDependencies = {
  checkRateLimit?: typeof checkApiRateLimit;
  createClientId?: () => string;
  recordRateLimitBlockedEvent?: typeof recordApiRateLimitBlockedEvent;
  registerDynamicMcpClient?: (input: DynamicMcpClientMutationInput) => Promise<RegisteredDynamicMcpClient>;
};

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

async function defaultRegisterDynamicMcpClient(input: DynamicMcpClientMutationInput) {
  const [{ internal }, { convexAdminHttpClient }] = await Promise.all([
    import("@convex-generated-api"),
    import("./convex-http"),
  ]);

  return await convexAdminHttpClient().mutation(internal.oauthApps.createDynamicMcpClient, input);
}

export async function dynamicMcpClientRegistrationResponse(
  request: Request,
  dependencies: DynamicMcpClientRegistrationDependencies = {},
) {
  const checkRateLimit = dependencies.checkRateLimit ?? checkApiRateLimit;
  const createClientId = dependencies.createClientId ?? createOAuthClientId;
  const recordRateLimitBlockedEvent = dependencies.recordRateLimitBlockedEvent ?? recordApiRateLimitBlockedEvent;
  const registerDynamicMcpClient = dependencies.registerDynamicMcpClient ?? defaultRegisterDynamicMcpClient;
  const routeClass = "oauth_dynamic_client_registration";
  const identity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const policy = apiRateLimitPolicyForRouteClass(routeClass);
  let rateLimit;

  try {
    rateLimit = await checkRateLimit({
      identity,
      routeClass,
    });
  } catch {
    return registrationProblem(
      500,
      "server_error",
      "The server is not configured to rate-limit dynamic client registrations.",
    );
  }

  if (!rateLimit.allowed) {
    await recordRateLimitBlockedEvent({
      identity,
      quotaTier: "standard",
      rateLimit,
      routeClass,
      windowMs: policy.windowMs,
    });

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

  let registration: NormalizedDynamicMcpClientRegistration;

  try {
    registration = normalizeDynamicMcpClientRegistration(body);
  } catch (error) {
    return registrationProblem(
      400,
      "invalid_client_metadata",
      error instanceof Error ? error.message : "The client metadata is invalid.",
    );
  }

  const clientId = createClientId();
  const resource = oauthMcpResourceUri(request);

  let dynamicClient;

  try {
    dynamicClient = await registerDynamicMcpClient({
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
