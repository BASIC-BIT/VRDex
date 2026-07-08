import {
  createMcpHandler,
  fromJsonSchema,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { api, internal } from "@convex-generated-api";
import {
  getBearerTokenFromAuthorizationHeader,
  hasBearerTokenInUrl,
  mcpOutputJsonSchemaForZodSchema,
  PublicActiveWorldsResponseSchema,
  PublicEventSchema,
  PublicEventsResponseSchema,
  PublicProfileSchema,
  PublicSearchResponseSchema,
  PublicWorldSchema,
  z,
} from "@vrdex/api-contracts";

import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  clientIpForRequest,
} from "@/lib/server/api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "@/lib/server/api-rate-limit-events";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import {
  oauthAccessTokenSigningConfigured,
  oauthIssuerUrl,
  oauthMcpResourceUri,
  oauthScopeString,
  parseOAuthScopeString,
  verifyOAuthAccessToken,
} from "@/lib/server/oauth-jwt";

type ResponseSchema<T> = z.ZodType<T>;

type VrdexMcpConvexClient = Pick<ReturnType<typeof convexHttpClient>, "query">;
type AcceptedMcpRouteClass = "anonymous_mcp_public_read" | "authenticated_mcp";

type VrdexMcpServerOptions = {
  convex?: VrdexMcpConvexClient;
  now?: () => number;
};

const mcpSearchTypes = ["all", "person", "community", "profile", "world", "event"] as const;
const mcpRequiredScopes = ["mcp:read"] as const;
const mcpToolNames = [
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
] as const;
const mcpPublicReadSecuritySchemes = [
  { type: "noauth" },
  { scopes: [...mcpRequiredScopes], type: "oauth2" },
] satisfies Array<Record<string, unknown>>;
const mcpPublicReadToolMeta = {
  securitySchemes: mcpPublicReadSecuritySchemes,
} satisfies Record<string, unknown>;
const mcpToolNameSet = new Set<string>(mcpToolNames);
const mcpSlugSchema = z.string().min(1).max(160);
const mcpLimitSchema = z.number().int().min(1);

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(value ?? fallback, max));
}

function entityTypeForSearchType(type: (typeof mcpSearchTypes)[number]) {
  if (type === "world" || type === "event") {
    return type;
  }

  if (type === "person" || type === "community" || type === "profile") {
    return "profile";
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnownMcpToolName(value: unknown): value is (typeof mcpToolNames)[number] {
  return typeof value === "string" && mcpToolNameSet.has(value);
}

export function mcpToolCallNamesFromPayload(payload: unknown) {
  const messages = Array.isArray(payload) ? payload : [payload];
  const toolNames: Array<(typeof mcpToolNames)[number]> = [];

  for (const message of messages) {
    if (!isRecord(message) || message.method !== "tools/call" || !isRecord(message.params)) {
      continue;
    }

    if (isKnownMcpToolName(message.params.name)) {
      toolNames.push(message.params.name);
    }
  }

  return toolNames;
}

export async function mcpToolCallNamesFromRequest(request: Request) {
  if (request.method !== "POST") {
    return [];
  }

  try {
    return mcpToolCallNamesFromPayload(await request.json());
  } catch {
    return [];
  }
}

export function acceptedMcpRouteClassForRequest(request: Request): AcceptedMcpRouteClass {
  return getBearerTokenFromAuthorizationHeader(request.headers.get("authorization")) === null
    ? "anonymous_mcp_public_read"
    : "authenticated_mcp";
}

export async function recordAcceptedMcpToolInvocations(request: Request) {
  const toolNames = await mcpToolCallNamesFromRequest(request);

  if (toolNames.length === 0) {
    return { recorded: 0 };
  }

  try {
    return await convexAdminHttpClient().mutation(internal.mcpToolEvents.recordInvocations, {
      routeClass: acceptedMcpRouteClassForRequest(request),
      toolNames,
    });
  } catch {
    return { recorded: 0 };
  }
}

function mcpJsonResult<T>(schema: ResponseSchema<T>, value: unknown) {
  const structuredContent = schema.parse(value);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function mcpOutputSchema<T>(schema: ResponseSchema<T>) {
  return fromJsonSchema<T>(mcpOutputJsonSchemaForZodSchema(schema));
}

function mcpNotFound(resourceName: string, slug: string) {
  return {
    content: [{ type: "text" as const, text: `${resourceName} was not found for slug "${slug}".` }],
    isError: true as const,
  };
}

function mcpPublicReadUnavailable(operation: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `VRDex public data is temporarily unavailable for ${operation}. Try again later.`,
      },
    ],
    isError: true as const,
  };
}

function mcpJsonRpcError(status: number, code: number, message: string) {
  return withMcpHttpHeaders(
    Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code, message },
      },
      { status },
    ),
  );
}

function hasRequiredScopes(grantedScopes: readonly string[], requiredScopes: readonly string[]) {
  const granted = new Set(grantedScopes);

  return requiredScopes.every((scope) => granted.has(scope));
}

function looksLikeCompactJwt(value: string) {
  return value.split(".").length === 3;
}

function quoteAuthParamValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function mcpWwwAuthenticateHeader(
  request: Request,
  options: {
    error?: "invalid_request" | "invalid_token" | "insufficient_scope";
    errorDescription?: string;
  } = {},
) {
  const params = [
    ["resource_metadata", `${oauthIssuerUrl(request)}/.well-known/oauth-protected-resource`],
    ["scope", oauthScopeString(mcpRequiredScopes)],
    ...(options.error === undefined ? [] : [["error", options.error] as const]),
    ...(options.errorDescription === undefined ? [] : [["error_description", options.errorDescription] as const]),
  ];

  return `Bearer ${params.map(([key, value]) => `${key}=${quoteAuthParamValue(value)}`).join(", ")}`;
}

function mcpAuthenticationErrorResponse(
  request: Request,
  status: 400 | 401 | 403,
  code: number,
  message: string,
  options: Parameters<typeof mcpWwwAuthenticateHeader>[1],
) {
  const response = mcpJsonRpcError(status, code, message);

  response.headers.set("WWW-Authenticate", mcpWwwAuthenticateHeader(request, options));

  return response;
}

async function authenticateMcpBearerToken(request: Request, tokenValue: string) {
  if (!oauthAccessTokenSigningConfigured()) {
    if (!looksLikeCompactJwt(tokenValue)) {
      return {
        ok: false as const,
        response: mcpAuthenticationErrorResponse(request, 401, -32600, "OAuth bearer token is invalid.", {
          error: "invalid_token",
          errorDescription: "The bearer token is malformed or invalid.",
        }),
      };
    }

    return {
      ok: false as const,
      response: mcpJsonRpcError(500, -32603, "OAuth bearer token verification is unavailable."),
    };
  }

  const issuer = oauthIssuerUrl(request);
  const resource = oauthMcpResourceUri(request);
  let claims: ReturnType<typeof verifyOAuthAccessToken>;
  let tokenScopes: string[];

  try {
    claims = verifyOAuthAccessToken(tokenValue, { audience: resource, issuer });
    tokenScopes = parseOAuthScopeString(claims.scope, []);
  } catch {
    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(request, 401, -32600, "OAuth bearer token is invalid.", {
        error: "invalid_token",
        errorDescription: "The bearer token is expired, malformed, or issued for the wrong resource.",
      }),
    };
  }

  if (!hasRequiredScopes(tokenScopes, mcpRequiredScopes)) {
    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(request, 403, -32600, "OAuth bearer token scope is insufficient.", {
        error: "insufficient_scope",
        errorDescription: "The bearer token must include the mcp:read scope.",
      }),
    };
  }

  let validation;

  try {
    validation = await convexHttpClient().mutation(api.oauthApps.validateAccessToken, {
      clientId: claims.client_id,
      tokenId: claims.jti,
      resource,
      requiredScopes: [...mcpRequiredScopes],
      routeClass: "authenticated_mcp",
    });
  } catch {
    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(request, 401, -32600, "OAuth bearer token is invalid.", {
        error: "invalid_token",
        errorDescription: "The bearer token could not be validated.",
      }),
    };
  }

  if (!validation.ok) {
    if (validation.reason === "missing_scope") {
      return {
        ok: false as const,
        response: mcpAuthenticationErrorResponse(request, 403, -32600, "OAuth bearer token scope is insufficient.", {
          error: "insufficient_scope",
          errorDescription: "The bearer token must include the mcp:read scope.",
        }),
      };
    }

    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(request, 401, -32600, "OAuth bearer token is invalid.", {
        error: "invalid_token",
        errorDescription: "The bearer token is expired, revoked, or issued for the wrong resource.",
      }),
    };
  }

  return {
    ok: true as const,
    identity: { kind: "oauth_client" as const, value: validation.clientId },
    quotaTier: validation.trustTier === "trusted_partner" ? "trusted_partner" as const : "standard" as const,
  };
}

function setMcpHttpHeaders(headers: Headers) {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id, mcp-param-name, mcp-param-arguments",
  );
  headers.set(
    "access-control-expose-headers",
    "mcp-session-id, ratelimit-limit, ratelimit-remaining, ratelimit-reset, retry-after, www-authenticate",
  );

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }

  return headers;
}

export function withMcpHttpHeaders(response: Response) {
  return new Response(response.body, {
    headers: setMcpHttpHeaders(new Headers(response.headers)),
    status: response.status,
    statusText: response.statusText,
  });
}

export async function rejectInvalidOrRateLimitedMcpRequest(request: Request) {
  if (hasBearerTokenInUrl(request.url)) {
    return mcpAuthenticationErrorResponse(
      request,
      400,
      -32600,
      "Bearer tokens must be sent in the Authorization header, not the URL.",
      {
        error: "invalid_request",
        errorDescription: "Bearer tokens must be sent in the Authorization header.",
      },
    );
  }

  const bearerToken = getBearerTokenFromAuthorizationHeader(request.headers.get("authorization"));
  const authentication =
    bearerToken === null
      ? {
          ok: true as const,
          identity: { kind: "ip" as const, value: clientIpForRequest(request) },
          quotaTier: "standard" as const,
        }
      : await authenticateMcpBearerToken(request, bearerToken);

  if (!authentication.ok) {
    return authentication.response;
  }

  const routeClass =
    authentication.identity.kind === "oauth_client" ? "authenticated_mcp" : "anonymous_mcp_public_read";
  const quotaTier = authentication.quotaTier;
  const policy = apiRateLimitPolicyForRouteClass(routeClass, quotaTier);

  let rateLimit;

  try {
    rateLimit = await checkApiRateLimit({
      identity: authentication.identity,
      quotaTier,
      routeClass,
    });
  } catch {
    return mcpJsonRpcError(500, -32603, "MCP rate limiting is unavailable.");
  }

  if (rateLimit.allowed) {
    return null;
  }

  const response = mcpJsonRpcError(429, -32000, "MCP rate limit exceeded.");

  await recordApiRateLimitBlockedEvent({
    identity: authentication.identity,
    quotaTier,
    rateLimit,
    routeClass,
    windowMs: policy.windowMs,
  });

  response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
  response.headers.set("RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1_000)));

  return response;
}

export function buildVrdexMcpServer(options: VrdexMcpServerOptions = {}) {
  const convex = () => options.convex ?? convexHttpClient();
  const now = options.now ?? Date.now;
  const server = new McpServer({
    name: "vrdex",
    version: "0.5.0",
  });

  server.registerTool(
    "vrdex_search",
    {
      title: "Search VRDex",
      description: "Search public VRDex profiles, worlds, and events.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(50).optional(),
        query: z.string().trim().max(160),
        type: z.enum(mcpSearchTypes).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicSearchResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ limit, query, type }) => {
      const normalizedType = type ?? "all";
      const cappedLimit = boundedLimit(limit, 24, 50);
      const searchText = query.trim();

      if (!searchText) {
        return mcpJsonResult(PublicSearchResponseSchema, {
          query: searchText,
          type: normalizedType,
          results: [],
        });
      }

      const entityType = entityTypeForSearchType(normalizedType);
      let results;

      try {
        results = await convex().query(api.search.searchUniversal, {
          query: searchText,
          limit: cappedLimit,
          ...(entityType === undefined ? {} : { entityType }),
        });
      } catch {
        return mcpPublicReadUnavailable("search");
      }

      const filteredResults =
        normalizedType === "person" || normalizedType === "community"
          ? results.filter((result) => result.profileType === normalizedType)
          : results;

      return mcpJsonResult(PublicSearchResponseSchema, {
        query: searchText,
        type: normalizedType,
        results: filteredResults.slice(0, cappedLimit),
      });
    },
  );

  server.registerTool(
    "vrdex_get_profile",
    {
      title: "Get VRDex Profile",
      description: "Read one public VRDex person or community profile by slug.",
      inputSchema: z.object({
        profileType: z.enum(["person", "community"]).optional(),
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicProfileSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ profileType, slug }) => {
      let profile;

      try {
        profile = await convex().query(api.profiles.getPublicBySlug, {
          slug,
          ...(profileType === undefined ? {} : { profileType }),
          now: now(),
        });
      } catch {
        return mcpPublicReadUnavailable("profile lookup");
      }

      if (profile === null) {
        return mcpNotFound("Profile", slug);
      }

      return mcpJsonResult(PublicProfileSchema, profile);
    },
  );

  server.registerTool(
    "vrdex_get_event",
    {
      title: "Get VRDex Event",
      description: "Read one public VRDex event by slug.",
      inputSchema: z.object({
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicEventSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ slug }) => {
      let event;

      try {
        event = await convex().query(api.events.getPublicBySlug, { slug });
      } catch {
        return mcpPublicReadUnavailable("event lookup");
      }

      if (event === null) {
        return mcpNotFound("Event", slug);
      }

      return mcpJsonResult(PublicEventSchema, event);
    },
  );

  server.registerTool(
    "vrdex_list_upcoming_events",
    {
      title: "List VRDex Upcoming Events",
      description: "List upcoming public VRDex event cards.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(24).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicEventsResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ limit }) => {
      const cappedLimit = boundedLimit(limit, 8, 24);
      let discovery;

      try {
        discovery = await convex().query(api.search.listDiscovery, { now: now() });
      } catch {
        return mcpPublicReadUnavailable("upcoming events");
      }

      return mcpJsonResult(PublicEventsResponseSchema, {
        events: discovery.upcomingEvents.slice(0, cappedLimit),
      });
    },
  );

  server.registerTool(
    "vrdex_get_world",
    {
      title: "Get VRDex World",
      description: "Read one public VRDex world by slug.",
      inputSchema: z.object({
        slug: mcpSlugSchema,
      }),
      outputSchema: mcpOutputSchema(PublicWorldSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ slug }) => {
      let world;

      try {
        world = await convex().query(api.worlds.getPublicBySlug, { slug, now: now() });
      } catch {
        return mcpPublicReadUnavailable("world lookup");
      }

      if (world === null) {
        return mcpNotFound("World", slug);
      }

      return mcpJsonResult(PublicWorldSchema, world);
    },
  );

  server.registerTool(
    "vrdex_list_active_worlds",
    {
      title: "List VRDex Active Worlds",
      description: "List public VRDex worlds with upcoming or live events.",
      inputSchema: z.object({
        limit: mcpLimitSchema.max(6).optional(),
      }),
      outputSchema: mcpOutputSchema(PublicActiveWorldsResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ limit }) => {
      const cappedLimit = boundedLimit(limit, 3, 6);
      let worlds;

      try {
        worlds = await convex().query(api.worlds.listHomeActiveWorlds, { now: now(), limit: cappedLimit });
      } catch {
        return mcpPublicReadUnavailable("active worlds");
      }

      return mcpJsonResult(PublicActiveWorldsResponseSchema, { worlds });
    },
  );

  return server;
}

export function createVrdexMcpHandler(options: VrdexMcpServerOptions = {}): McpHttpHandler {
  return createMcpHandler(() => buildVrdexMcpServer(options), {
    legacy: "stateless",
  });
}
