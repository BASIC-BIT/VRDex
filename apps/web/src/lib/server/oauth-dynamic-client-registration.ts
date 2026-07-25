import {
  createOAuthClientId,
  normalizeDynamicMcpClientRegistration,
} from "@vrdex/api-contracts";

import {
  apiRateLimitPolicyForRouteClass,
  apiRateLimitResponseHeaders,
  checkApiRateLimit,
  clientIpForRequest,
  hashedApiRateLimitIdentityValue,
  type ApiRateLimitIdentity,
} from "./api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "./api-rate-limit-events";
import { hostedMcpEventWritesEnabled } from "./hosted-mcp-policy";
import {
  oauthIssuerUrl,
  oauthMcpResourceUri,
  oauthScopeString,
} from "./oauth-jwt";
import {
  createDynamicMcpClient,
  type DynamicMcpClientMutationInput,
} from "./oauth-dynamic-client-persistence";

type NormalizedDynamicMcpClientRegistration = ReturnType<typeof normalizeDynamicMcpClientRegistration>;

const registrationSoftwareRateLimitMultiplier = 10;
const registrationRedirectHostRateLimitMultiplier = 25;

export type { DynamicMcpClientMutationInput } from "./oauth-dynamic-client-persistence";

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

function requestBodyValue(body: unknown) {
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

async function defaultRegisterDynamicMcpClient(input: DynamicMcpClientMutationInput) {
  return await createDynamicMcpClient(input);
}

async function normalizedRegistrationRateLimitDimensions(registration: NormalizedDynamicMcpClientRegistration) {
  const softwareIdentity = registration.softwareId ?? registration.clientName;
  const redirectHosts = [...new Set(registration.redirectUris.map((redirectUri) => new URL(redirectUri).hostname.toLowerCase()))];

  return [
    {
      identity: {
        kind: "oauth_registration_software" as const,
        value: await hashedApiRateLimitIdentityValue("oauth-registration-software", softwareIdentity),
      },
      limitMultiplier: registrationSoftwareRateLimitMultiplier,
    },
    ...await Promise.all(
      redirectHosts.map(async (redirectHost) => ({
        identity: {
          kind: "oauth_redirect_host" as const,
          value: await hashedApiRateLimitIdentityValue("oauth-redirect-host", redirectHost),
        },
        limitMultiplier: registrationRedirectHostRateLimitMultiplier,
      })),
    ),
  ];
}

export async function dynamicMcpClientRegistrationResponse(
  request: Request,
  dependencies: DynamicMcpClientRegistrationDependencies = {},
) {
  const allowEventWrites = hostedMcpEventWritesEnabled();
  const checkRateLimit = dependencies.checkRateLimit ?? checkApiRateLimit;
  const createClientId = dependencies.createClientId ?? createOAuthClientId;
  const recordRateLimitBlockedEvent = dependencies.recordRateLimitBlockedEvent ?? recordApiRateLimitBlockedEvent;
  const registerDynamicMcpClient = dependencies.registerDynamicMcpClient ?? defaultRegisterDynamicMcpClient;
  const routeClass = "oauth_dynamic_client_registration";
  const networkIdentity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const policy = apiRateLimitPolicyForRouteClass(routeClass);
  let rateLimit;

  try {
    rateLimit = await checkRateLimit({
      identity: networkIdentity,
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
      identity: networkIdentity,
      quotaTier: "standard",
      rateLimit,
      routeClass,
      windowMs: policy.windowMs,
    });

    return registrationProblem(
      429,
      "temporarily_unavailable",
      "Too many dynamic client registration requests were sent from this network.",
      apiRateLimitResponseHeaders(rateLimit),
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
    registration = normalizeDynamicMcpClientRegistration(body, {
      allowEventWrites,
      // Some native clients copy the issuer-wide scope catalog into an MCP
      // DCR request. Persist and return only scopes valid for this MCP
      // resource; explicit CIMD scope declarations remain strict.
      discardKnownNonMcpScopes: true,
    });
  } catch (error) {
    return registrationProblem(
      400,
      "invalid_client_metadata",
      error instanceof Error ? error.message : "The client metadata is invalid.",
    );
  }

  for (const dimension of await normalizedRegistrationRateLimitDimensions(registration)) {
    try {
      rateLimit = await checkRateLimit({
        identity: dimension.identity satisfies ApiRateLimitIdentity,
        limitMultiplier: dimension.limitMultiplier,
        routeClass,
        trackRouteClassRequest: false,
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
        identity: dimension.identity,
        quotaTier: "standard",
        rateLimit,
        routeClass,
        windowMs: policy.windowMs,
      });

      return registrationProblem(
        429,
        "temporarily_unavailable",
        "Too many dynamic client registration requests were sent for this client metadata.",
        apiRateLimitResponseHeaders(rateLimit),
      );
    }
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
      ...(allowEventWrites ? { allowEventWrites: true } : {}),
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
