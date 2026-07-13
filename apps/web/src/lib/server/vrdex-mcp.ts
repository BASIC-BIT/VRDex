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
  McpDocumentFetchResponseSchema,
  McpDocumentSearchResponseSchema,
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
  checkOAuthAccessTokenRateLimit,
  clientIpForRequest,
} from "@/lib/server/api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "@/lib/server/api-rate-limit-events";
import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import { validateOAuthAccessTokenRecord } from "@/lib/server/oauth-dynamic-client-persistence";
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
type PublicSearchResponse = z.infer<typeof PublicSearchResponseSchema>;
type PublicSearchResult = PublicSearchResponse["results"][number];
type PublicProfile = z.infer<typeof PublicProfileSchema>;
type PublicEvent = z.infer<typeof PublicEventSchema>;
type PublicWorld = z.infer<typeof PublicWorldSchema>;
type McpDocumentFetchResponse = z.infer<typeof McpDocumentFetchResponseSchema>;
type McpDocumentDescriptor =
  | { entityType: "event"; slug: string }
  | { entityType: "profile"; profileType?: "person" | "community"; slug: string }
  | { entityType: "world"; slug: string };

const mcpSearchTypes = ["all", "person", "community", "profile", "world", "event"] as const;
const mcpRequiredScopes = ["mcp:read"] as const;
const mcpToolNames = [
  "search",
  "fetch",
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
const mcpDocumentIdSchema = z.string().min(1).max(260);
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

function publicWebOrigin() {
  const candidates = [
    process.env.VRDEX_PUBLIC_WEB_ORIGIN,
    process.env.VRDEX_OAUTH_ISSUER_URL,
    process.env.VRDEX_PUBLIC_API_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();

    if (!value) {
      continue;
    }

    try {
      const url = new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);

      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch {
      continue;
    }
  }

  return "https://vrdex.net";
}

function publicUrlForRoutePath(routePath: string) {
  return new URL(routePath, publicWebOrigin()).href;
}

function encodeMcpDocumentIdPart(value: string) {
  return encodeURIComponent(value);
}

function decodeMcpDocumentIdPart(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function mcpDocumentIdForSearchResult(result: PublicSearchResult) {
  const slug = encodeMcpDocumentIdPart(result.slug);

  if (result.entityType === "profile") {
    return result.profileType === undefined ? `profile:${slug}` : `profile:${result.profileType}:${slug}`;
  }

  return `${result.entityType}:${slug}`;
}

function parseMcpDocumentId(id: string): McpDocumentDescriptor | null {
  const [entityType, second, third, ...rest] = id.split(":");

  if (rest.length > 0) {
    return null;
  }

  if (entityType === "profile") {
    if (third === undefined) {
      const slug = decodeMcpDocumentIdPart(second);

      return slug === undefined ? null : { entityType, slug };
    }

    if (second !== "person" && second !== "community") {
      return null;
    }

    const slug = decodeMcpDocumentIdPart(third);

    return slug === undefined ? null : { entityType, profileType: second, slug };
  }

  if (third !== undefined || (entityType !== "event" && entityType !== "world")) {
    return null;
  }

  const slug = decodeMcpDocumentIdPart(second);

  return slug === undefined ? null : { entityType, slug };
}

function addMcpDocumentLine(lines: string[], label: string, value: boolean | number | string | undefined) {
  const text = typeof value === "string" ? value.trim() : value === undefined ? "" : String(value);

  if (text) {
    lines.push(`${label}: ${text}`);
  }
}

function joinTextList(values: readonly string[] | undefined) {
  const items = values?.map((value) => value.trim()).filter(Boolean) ?? [];

  return items.length === 0 ? undefined : items.join(", ");
}

function formatTimestampMs(value: number | undefined) {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function formatSource(source: { label?: string; sourceType?: string; url?: string } | undefined) {
  if (source === undefined) {
    return undefined;
  }

  return [source.label, source.sourceType, source.url].filter(Boolean).join(" | ");
}

function formatOutboundLinks(links: Array<{ label: string; url: string }> | undefined) {
  if (links === undefined || links.length === 0) {
    return undefined;
  }

  return links.map((link) => `${link.label}: ${link.url}`).join("; ");
}

function namedItemLabel(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["displayName", "title", "name", "slug"]) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function formatNamedItems(values: unknown[] | undefined) {
  const labels = values?.map(namedItemLabel).filter((value): value is string => value !== undefined) ?? [];

  return labels.length === 0 ? undefined : labels.join(", ");
}

function profileRoutePath(profile: Pick<PublicProfile, "profileType" | "slug">) {
  return profile.profileType === "community"
    ? `/c/${encodeURIComponent(profile.slug)}`
    : `/p/${encodeURIComponent(profile.slug)}`;
}

function eventRoutePath(event: Pick<PublicEvent, "slug">) {
  return `/e/${encodeURIComponent(event.slug)}`;
}

function worldRoutePath(world: Pick<PublicWorld, "slug">) {
  return `/w/${encodeURIComponent(world.slug)}`;
}

function toMcpDocumentSearchResult(result: PublicSearchResult) {
  return {
    id: mcpDocumentIdForSearchResult(result),
    title: result.title,
    url: publicUrlForRoutePath(result.routePath),
  };
}

function profileToMcpDocument(profile: PublicProfile): McpDocumentFetchResponse {
  const lines: string[] = [];

  addMcpDocumentLine(lines, "Title", profile.displayName);
  addMcpDocumentLine(lines, "Entity type", "profile");
  addMcpDocumentLine(lines, "Profile type", profile.profileType);
  addMcpDocumentLine(lines, "Slug", profile.slug);
  addMcpDocumentLine(lines, "Trust label", profile.trustLabel);
  addMcpDocumentLine(lines, "Bio", profile.bio);
  addMcpDocumentLine(lines, "Aliases", joinTextList(profile.aliases));
  addMcpDocumentLine(lines, "Tags", joinTextList(profile.tags));
  addMcpDocumentLine(
    lines,
    "Genres",
    joinTextList(profile.genres?.map((genre) => genre.displayLabel ?? genre.displayName)),
  );
  addMcpDocumentLine(lines, "Source", formatSource(profile.source));
  addMcpDocumentLine(lines, "Links", formatOutboundLinks(profile.outboundLinks));

  return {
    id: `profile:${profile.profileType}:${encodeMcpDocumentIdPart(profile.slug)}`,
    metadata: {
      entityType: "profile",
      profileType: profile.profileType,
      slug: profile.slug,
      trustLabel: profile.trustLabel,
    },
    text: lines.join("\n"),
    title: profile.displayName,
    url: publicUrlForRoutePath(profileRoutePath(profile)),
  };
}

function eventToMcpDocument(event: PublicEvent): McpDocumentFetchResponse {
  const lines: string[] = [];

  addMcpDocumentLine(lines, "Title", event.title);
  addMcpDocumentLine(lines, "Entity type", "event");
  addMcpDocumentLine(lines, "Slug", event.slug);
  addMcpDocumentLine(lines, "Community", event.communityName);
  addMcpDocumentLine(lines, "Community slug", event.communitySlug);
  addMcpDocumentLine(lines, "Start", formatTimestampMs(event.startAt));
  addMcpDocumentLine(lines, "Doors open", formatTimestampMs(event.doorsOpenAt));
  addMcpDocumentLine(lines, "End", formatTimestampMs(event.endAt));
  addMcpDocumentLine(lines, "Timezone", event.timezone);
  addMcpDocumentLine(lines, "Summary", event.summary);
  addMcpDocumentLine(lines, "Notes", event.notes);
  addMcpDocumentLine(lines, "Worlds", formatNamedItems(event.worlds));
  addMcpDocumentLine(lines, "Media links", formatOutboundLinks(event.mediaLinks));
  addMcpDocumentLine(lines, "Source", formatSource(event.source));

  return {
    id: `event:${encodeMcpDocumentIdPart(event.slug)}`,
    metadata: {
      communitySlug: event.communitySlug,
      entityType: "event",
      slug: event.slug,
      startAt: event.startAt,
    },
    text: lines.join("\n"),
    title: event.title,
    url: publicUrlForRoutePath(eventRoutePath(event)),
  };
}

function worldToMcpDocument(world: PublicWorld): McpDocumentFetchResponse {
  const lines: string[] = [];

  addMcpDocumentLine(lines, "Title", world.displayName);
  addMcpDocumentLine(lines, "Entity type", "world");
  addMcpDocumentLine(lines, "Slug", world.slug);
  addMcpDocumentLine(lines, "Summary", world.summary);
  addMcpDocumentLine(lines, "Description", world.description);
  addMcpDocumentLine(lines, "Tags", joinTextList(world.tags));
  addMcpDocumentLine(lines, "Platform compatibility", joinTextList(world.platformCompatibility));
  addMcpDocumentLine(lines, "Visibility status", world.visibilityStatus);
  addMcpDocumentLine(lines, "VRChat world URL", world.canonicalVrchatWorldUrl);
  addMcpDocumentLine(lines, "Outbound links", formatOutboundLinks(world.outboundLinks));
  addMcpDocumentLine(lines, "Source", formatSource(world.source));
  addMcpDocumentLine(lines, "Upcoming events", formatNamedItems(world.eventContext?.upcoming));
  addMcpDocumentLine(lines, "Recent events", formatNamedItems(world.eventContext?.recent));

  return {
    id: `world:${encodeMcpDocumentIdPart(world.slug)}`,
    metadata: {
      entityType: "world",
      slug: world.slug,
      visibilityStatus: world.visibilityStatus,
    },
    text: lines.join("\n"),
    title: world.displayName,
    url: publicUrlForRoutePath(worldRoutePath(world)),
  };
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
    validation = await validateOAuthAccessTokenRecord({
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
    clientId: validation.clientId,
    identity: { kind: "oauth_client" as const, value: validation.clientId },
    quotaTier: validation.trustTier === "trusted_partner" ? "trusted_partner" as const : "standard" as const,
    tokenId: claims.jti,
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
  let rateLimitIdentity = authentication.identity;

  try {
    if (authentication.identity.kind === "oauth_client" && "tokenId" in authentication) {
      const evaluation = await checkOAuthAccessTokenRateLimit({
        clientId: authentication.clientId,
        quotaTier,
        routeClass,
        tokenId: authentication.tokenId,
      });

      rateLimit = evaluation.rateLimit;
      rateLimitIdentity = evaluation.identity;
    } else {
      rateLimit = await checkApiRateLimit({
        identity: authentication.identity,
        quotaTier,
        routeClass,
      });
    }
  } catch {
    return mcpJsonRpcError(500, -32603, "MCP rate limiting is unavailable.");
  }

  if (rateLimit.allowed) {
    return null;
  }

  const response = mcpJsonRpcError(429, -32000, "MCP rate limit exceeded.");

  await recordApiRateLimitBlockedEvent({
    identity: rateLimitIdentity,
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

  async function readPublicSearch(options: {
    limit: number | undefined;
    query: string;
    type: (typeof mcpSearchTypes)[number] | undefined;
  }) {
    const normalizedType = options.type ?? "all";
    const cappedLimit = boundedLimit(options.limit, 24, 50);
    const searchText = options.query.trim();

    if (!searchText) {
      return {
        query: searchText,
        type: normalizedType,
        results: [],
      } satisfies PublicSearchResponse;
    }

    const entityType = entityTypeForSearchType(normalizedType);
    const results = await convex().query(api.search.searchUniversal, {
      query: searchText,
      limit: cappedLimit,
      ...(entityType === undefined ? {} : { entityType }),
    });
    const filteredResults =
      normalizedType === "person" || normalizedType === "community"
        ? results.filter((result) => result.profileType === normalizedType)
        : results;

    return {
      query: searchText,
      type: normalizedType,
      results: filteredResults.slice(0, cappedLimit),
    } satisfies PublicSearchResponse;
  }

  server.registerTool(
    "search",
    {
      title: "Search VRDex Documents",
      description: "OpenAI/ChatGPT-compatible search over public VRDex profiles, worlds, and events.",
      inputSchema: z.object({
        query: z.string().trim().max(160),
      }),
      outputSchema: mcpOutputSchema(McpDocumentSearchResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ query }) => {
      let search;

      try {
        search = await readPublicSearch({ query, type: "all", limit: 10 });
      } catch {
        return mcpPublicReadUnavailable("search");
      }

      return mcpJsonResult(McpDocumentSearchResponseSchema, {
        results: search.results.map(toMcpDocumentSearchResult),
      });
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch VRDex Document",
      description: "OpenAI/ChatGPT-compatible fetch for a public VRDex search result by id.",
      inputSchema: z.object({
        id: mcpDocumentIdSchema,
      }),
      outputSchema: mcpOutputSchema(McpDocumentFetchResponseSchema),
      annotations: { readOnlyHint: true, idempotentHint: true },
      _meta: mcpPublicReadToolMeta,
    },
    async ({ id }) => {
      const descriptor = parseMcpDocumentId(id);
      let document: McpDocumentFetchResponse | null;

      if (descriptor === null) {
        return mcpNotFound("Search result", id);
      }

      try {
        if (descriptor.entityType === "profile") {
          const profile = await convex().query(api.profiles.getPublicBySlug, {
            slug: descriptor.slug,
            ...(descriptor.profileType === undefined ? {} : { profileType: descriptor.profileType }),
            now: now(),
          });

          document = profile === null ? null : profileToMcpDocument(profile);
        } else if (descriptor.entityType === "event") {
          const event = await convex().query(api.events.getPublicBySlug, { slug: descriptor.slug });

          document = event === null ? null : eventToMcpDocument(event);
        } else {
          const world = await convex().query(api.worlds.getPublicBySlug, { slug: descriptor.slug, now: now() });

          document = world === null ? null : worldToMcpDocument(world);
        }
      } catch {
        return mcpPublicReadUnavailable("fetch");
      }

      if (document === null) {
        return mcpNotFound("Search result", id);
      }

      return mcpJsonResult(McpDocumentFetchResponseSchema, document);
    },
  );

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
      let search;

      try {
        search = await readPublicSearch({ limit, query, type });
      } catch {
        return mcpPublicReadUnavailable("search");
      }

      return mcpJsonResult(PublicSearchResponseSchema, search);
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
