import {
  createMcpHandler,
  fromJsonSchema,
  type AuthInfo,
  type McpHttpHandler,
  McpServer,
} from "@modelcontextprotocol/server";
import { api, internal } from "@convex-generated-api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  ApiEventCreateRequestSchema,
  ApiEventUpdateRequestSchema,
  ApiEventWriteResponseSchema,
  ApiProfileSubmitRequestSchema,
  ApiProfileUpdateRequestSchema,
  ApiProfileWriteResponseSchema,
  type ApiScope,
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
import { createHash, randomUUID } from "node:crypto";

import {
  apiRateLimitPolicyForRouteClass,
  checkApiRateLimit,
  checkFailedMcpAuthenticationRateLimit,
  checkOAuthAccessTokenRateLimit,
  clientIpForRequest,
  oauthRateLimitOwnerForCredential,
  type ApiRateLimitIdentity,
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
import { publicSearchBackendFilters } from "@/lib/server/public-search-query";
import { hostedMcpReadScopes } from "@/lib/server/hosted-mcp-policy";
import { vrcdnPlaybackHref } from "../../../../../convex/_vrcdnLinks";

type ResponseSchema<T> = z.ZodType<T>;

type VrdexMcpConvexClient = Pick<ReturnType<typeof convexHttpClient>, "query">;
type VrdexMcpAdminConvexClient = Pick<ReturnType<typeof convexAdminHttpClient>, "mutation">;
type AcceptedMcpRouteClass =
  | "anonymous_mcp_public_read"
  | "authenticated_mcp"
  | "authenticated_mcp_write";

type VrdexMcpServerOptions = {
  anonymousPublicReads?: boolean;
  authInfo?: AuthInfo;
  adminConvex?: VrdexMcpAdminConvexClient;
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
const mcpRequiredScopes = hostedMcpReadScopes;
const mcpEventWriteToolNames = ["vrdex_event_create", "vrdex_event_update"] as const;
const mcpProfileWriteToolNames = ["vrdex_profile_update", "vrdex_profile_submit"] as const;
const mcpWriteToolNames = [...mcpEventWriteToolNames, ...mcpProfileWriteToolNames] as const;
/**
 * The resource scope each write tool needs alongside `mcp:write`.
 *
 * Per tool rather than per request, so a client holding `mcp:write profile:write`
 * can set a DJ's links without also being able to publish events under their
 * name. A request calling both kinds needs both scopes.
 */
const mcpWriteToolResourceScopes: Record<(typeof mcpWriteToolNames)[number], ApiScope> = {
  vrdex_event_create: "events:write",
  vrdex_event_update: "events:write",
  vrdex_profile_update: "profile:write",
  // Submitting is inherently a write to a profile nobody owns, so it asks for
  // the contribution grant rather than the edit-your-own-profiles one.
  vrdex_profile_submit: "profile:contribute",
};
const mcpToolNames = [
  "search",
  "fetch",
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
  ...mcpWriteToolNames,
] as const;
const mcpPublicReadSecuritySchemes = [
  { type: "noauth" },
  { scopes: [...mcpRequiredScopes], type: "oauth2" },
] satisfies Array<Record<string, unknown>>;
const mcpAuthenticatedReadSecuritySchemes = [
  { scopes: [...mcpRequiredScopes], type: "oauth2" },
] satisfies Array<Record<string, unknown>>;
function mcpWriteSecuritySchemes(toolName: (typeof mcpWriteToolNames)[number]) {
  return [
    { scopes: ["mcp:write", mcpWriteToolResourceScopes[toolName]], type: "oauth2" },
  ] satisfies Array<Record<string, unknown>>;
}
const hostedMcpMaxRequestBodyBytes = 1024 * 1024;
const mcpToolNameSet = new Set<string>(mcpToolNames);
const mcpWriteToolNameSet = new Set<string>(mcpWriteToolNames);
const mcpDocumentIdSchema = z.string().min(1).max(260);
const mcpSlugSchema = z.string().min(1).max(160);
const mcpLimitSchema = z.number().int().min(1);
const mcpIdempotencyKeySchema = z.string().trim().min(8).max(128);
const mcpEventUpdateInputSchema = z.object({
  idempotencyKey: mcpIdempotencyKeySchema,
  slug: mcpSlugSchema.describe("Current public event slug."),
  update: ApiEventUpdateRequestSchema,
});
const mcpEventCreateInputSchema = ApiEventCreateRequestSchema.extend({
  idempotencyKey: mcpIdempotencyKeySchema,
});
const mcpProfileUpdateInputSchema = z.object({
  idempotencyKey: mcpIdempotencyKeySchema,
  slug: mcpSlugSchema.describe("Current public profile slug."),
  update: ApiProfileUpdateRequestSchema,
});
const mcpProfileSubmitInputSchema = ApiProfileSubmitRequestSchema.extend({
  idempotencyKey: mcpIdempotencyKeySchema,
});
const mcpProfileWriteResultSchema = ApiProfileWriteResponseSchema.extend({
  canonicalUrl: z.string().url(),
  // Absent exactly when the saved profile has no public surface. An owner may
  // edit a draft or opted-out profile, and that write succeeded; there is simply
  // nothing to read back.
  profile: PublicProfileSchema.optional(),
}).meta({
  description: "Accepted profile write plus the normalized public profile read back from VRDex.",
  id: "HostedMcpProfileWriteResult",
});
const mcpEventWriteResultSchema = ApiEventWriteResponseSchema.extend({
  canonicalUrl: z.string().url(),
  event: PublicEventSchema,
}).meta({
  description: "Accepted event write plus the normalized public event read back from VRDex.",
  id: "HostedMcpEventWriteResult",
});

type HostedMcpPrincipal = {
  clientId: string;
  requestId: string;
  tokenId: string;
  userId: Id<"users">;
};
type HostedMcpAuthorizationDependencies = {
  checkRateLimit?: typeof checkApiRateLimit;
  validateAccessTokenRecord?: typeof validateOAuthAccessTokenRecord;
};

export function hostedMcpAnonymousPublicReadsEnabled(
  value = process.env.VRDEX_HOSTED_MCP_ANONYMOUS_READS,
) {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === undefined
    || normalized === ""
    || normalized === "1"
    || normalized === "true"
    || normalized === "yes"
  ) {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  throw new Error("VRDEX_HOSTED_MCP_ANONYMOUS_READS must be true or false when set.");
}

function hostedMcpExplicitAuthenticationRequested(request: Request) {
  return new URL(request.url).searchParams.get("auth") === "required";
}

function mcpReadToolMeta(anonymousPublicReads: boolean) {
  return {
    securitySchemes: anonymousPublicReads
      ? mcpPublicReadSecuritySchemes
      : mcpAuthenticatedReadSecuritySchemes,
  } satisfies Record<string, unknown>;
}

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  return Math.max(1, Math.min(value ?? fallback, max));
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

  // Resolved for the same reason the Discord export resolves: this is a flat
  // text document handed to a client that has no VRCDN parser, so a bare
  // `vrcdn:<id>` would arrive as an opaque token where a fetchable address
  // belongs.
  return links.map((link) => `${link.label}: ${vrcdnPlaybackHref(link.url) ?? link.url}`).join("; ");
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
  return `/${encodeURIComponent(profile.slug)}`;
}

function eventRoutePath(event: Pick<PublicEvent, "slug">) {
  return `/${encodeURIComponent(event.slug)}`;
}

function worldRoutePath(world: Pick<PublicWorld, "slug">) {
  return `/${encodeURIComponent(world.slug)}`;
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
  const toolNames = (await mcpToolCallNamesFromRequest(request))
    .filter((toolName) => !mcpWriteToolNameSet.has(toolName));

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

async function boundedMcpToolCallNamesFromRequest(request: Request) {
  if (request.method !== "POST") {
    return { toolNames: [] as string[] };
  }

  const declaredLength = request.headers.get("content-length");

  if (
    declaredLength !== null
    && /^\d+$/.test(declaredLength)
    && Number(declaredLength) > hostedMcpMaxRequestBodyBytes
  ) {
    return { tooLarge: true as const, toolNames: [] as string[] };
  }

  if (request.body === null) {
    return { toolNames: [] as string[] };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > hostedMcpMaxRequestBodyBytes) {
        await reader.cancel();

        return { tooLarge: true as const, toolNames: [] as string[] };
      }

      chunks.push(value);
    }
  } catch {
    return { toolNames: [] as string[] };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      toolNames: mcpToolCallNamesFromPayload(
        JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      ),
    };
  } catch {
    return { toolNames: [] as string[] };
  }
}

async function recordHostedMcpWriteInvocation(args: {
  idempotencyKeyHash: string;
  principal: HostedMcpPrincipal;
  result: "accepted" | "denied" | "indeterminate" | "readback_warning";
  targetEventId?: Id<"events">;
  targetProfileId?: Id<"profiles">;
  toolName: (typeof mcpWriteToolNames)[number];
}) {
  try {
    await convexAdminHttpClient().mutation(internal.mcpToolEvents.recordWriteInvocation, {
      idempotencyKeyHash: args.idempotencyKeyHash,
      oauthClientId: args.principal.clientId,
      oauthTokenId: args.principal.tokenId,
      ownerUserId: args.principal.userId,
      requestId: args.principal.requestId,
      result: args.result,
      toolName: args.toolName,
      ...(args.targetEventId === undefined ? {} : { targetEventId: args.targetEventId }),
      ...(args.targetProfileId === undefined ? {} : { targetProfileId: args.targetProfileId }),
    });
  } catch {
    // Observability must never turn an accepted or rejected write into a retry.
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Resolved per write tool, not once per session: a token carrying
 * `mcp:write profile:write` is a principal for the profile tools and nobody at
 * all for the event tools.
 */
function hostedMcpPrincipal(
  authInfo: AuthInfo | undefined,
  toolName: (typeof mcpWriteToolNames)[number],
): HostedMcpPrincipal | null {
  const extra = authInfo?.extra;

  if (
    authInfo === undefined
    || extra === undefined
    || extra.subjectType !== "user"
    || typeof extra.userId !== "string"
    || typeof extra.tokenId !== "string"
    || typeof extra.requestId !== "string"
    || !hasRequiredScopes(authInfo.scopes, ["mcp:write", mcpWriteToolResourceScopes[toolName]])
  ) {
    return null;
  }

  return {
    clientId: authInfo.clientId,
    requestId: extra.requestId,
    tokenId: extra.tokenId,
    userId: extra.userId as Id<"users">,
  };
}

function mcpWriteUnauthorized(toolName: (typeof mcpWriteToolNames)[number]) {
  return {
    content: [{
      type: "text" as const,
      text: `A user-delegated VRDex OAuth session with mcp:write and ${mcpWriteToolResourceScopes[toolName]} is required.`,
    }],
    isError: true as const,
  };
}

function mcpEventWriteIndeterminate(operation: "create" | "update") {
  return {
    content: [{
      type: "text" as const,
      text: `The VRDex event ${operation} request did not complete cleanly, and the server may already have accepted the mutation. Do not retry automatically; inspect the target event or replay only with the same idempotency key after operator review.`,
    }],
    isError: true as const,
  };
}

function isMcpWriteDenied(error: unknown) {
  return isRecord(error) && isRecord(error.data) && error.data.code === "MCP_WRITE_DENIED";
}

function mcpConvexErrorCode(error: unknown) {
  return isRecord(error) && isRecord(error.data) && typeof error.data.code === "string"
    ? error.data.code
    : null;
}

function mcpConvexErrorMessage(error: unknown) {
  return isRecord(error) && isRecord(error.data) && typeof error.data.message === "string"
    ? error.data.message
    : null;
}

/**
 * Relay a refusal the agent can act on.
 *
 * The backend already decided which codes are worth naming; anything else
 * arrives as `MCP_WRITE_DENIED` and falls through to the generic text. Without
 * this an over-length headline and an unwritable profile read identically, and
 * the agent retries the one it could have fixed.
 */
function mcpProfileWriteRejected(error: unknown) {
  const message = mcpConvexErrorMessage(error);

  return {
    content: [{
      type: "text" as const,
      text: message === null
        ? "VRDex rejected the profile write. Do not retry the mutation automatically."
        : `VRDex rejected the profile write. ${message} Correct the request before trying again.`,
    }],
    isError: true as const,
  };
}

function mcpEventWriteDenied() {
  return {
    content: [{
      type: "text" as const,
      text: "VRDex rejected the event write. Confirm the event input, idempotency key, and durable community ownership before trying a corrected request.",
    }],
    isError: true as const,
  };
}

function mcpEventReadbackError(
  write: z.infer<typeof ApiEventWriteResponseSchema>,
  detail?: string,
) {
  const suffix = detail === undefined ? "" : ` ${detail}`;

  return {
    content: [{
      type: "text" as const,
      text: `VRDex accepted the event write for slug "${write.slug}", but public readback did not complete cleanly.${suffix} Do not retry the mutation automatically; inspect the saved event first.`,
    }],
    isError: true as const,
  };
}

function mcpProfileWriteIndeterminate(operation: "update" | "submission") {
  return {
    content: [{
      type: "text" as const,
      text: `The VRDex profile ${operation} request did not complete cleanly, and the server may already have accepted the mutation. Do not retry automatically; read the profile back or replay only with the same idempotency key after operator review.`,
    }],
    isError: true as const,
  };
}

function mcpProfileWriteDenied() {
  return {
    content: [{
      type: "text" as const,
      text: "VRDex rejected the profile write. Confirm the slug, the field values, and that the profile is one you own or that is still unclaimed before trying a corrected request.",
    }],
    isError: true as const,
  };
}

// The claimed and suppressed refusals reuse the sentences already approved for
// the browser path verbatim, and add only the no-retry clause the event write
// tools already carry. New public-facing sentences need sign-off; these are not
// new ones.
function mcpProfileClaimed() {
  return {
    content: [{
      type: "text" as const,
      text: "This profile has been claimed, so only its owner can edit it. Do not retry the mutation automatically.",
    }],
    isError: true as const,
  };
}

function mcpProfileReadbackError(
  write: z.infer<typeof ApiProfileWriteResponseSchema>,
  detail?: string,
) {
  const suffix = detail === undefined ? "" : ` ${detail}`;

  return {
    content: [{
      type: "text" as const,
      text: `VRDex accepted the profile write for slug "${write.slug}", but public readback did not complete cleanly.${suffix} Do not retry the mutation automatically; read the saved profile first.`,
    }],
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
    requiredScopes?: readonly string[];
  } = {},
) {
  const params = [
    ["resource_metadata", `${oauthIssuerUrl(request)}/.well-known/oauth-protected-resource/mcp`],
    ["scope", oauthScopeString(options.requiredScopes ?? mcpRequiredScopes)],
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

async function authenticateMcpBearerToken(
  request: Request,
  tokenValue: string,
  requiredScopes: readonly string[],
  routeClass: "authenticated_mcp" | "authenticated_mcp_write",
  dependencies: HostedMcpAuthorizationDependencies = {},
) {
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

  if (!hasRequiredScopes(tokenScopes, requiredScopes)) {
    const scopeDescription = oauthScopeString(requiredScopes);

    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(request, 403, -32600, "OAuth bearer token scope is insufficient.", {
        error: "insufficient_scope",
        errorDescription: `The bearer token must include: ${scopeDescription}.`,
        requiredScopes,
      }),
    };
  }

  let validation;

  try {
    validation = await (dependencies.validateAccessTokenRecord ?? validateOAuthAccessTokenRecord)({
      clientId: claims.client_id,
      tokenId: claims.jti,
      resource,
      requiredScopes: [...requiredScopes] as ApiScope[],
      routeClass,
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
      const scopeDescription = oauthScopeString(requiredScopes);

      return {
        ok: false as const,
        response: mcpAuthenticationErrorResponse(request, 403, -32600, "OAuth bearer token scope is insufficient.", {
          error: "insufficient_scope",
          errorDescription: `The bearer token must include: ${scopeDescription}.`,
          requiredScopes,
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

  if (routeClass === "authenticated_mcp_write" && (validation.subjectType !== "user" || validation.userId === undefined)) {
    return {
      ok: false as const,
      response: mcpAuthenticationErrorResponse(
        request,
        403,
        -32600,
        "Hosted MCP writes require a user-delegated OAuth token.",
        {
          error: "insufficient_scope",
          // Neutral about what is being written. Naming community ownership
          // sent profile clients after the wrong authority model: a submission
          // targets no community at all, and a profile correction needs the
          // profile to be unclaimed rather than owned.
          errorDescription: "Use an authorization-code session for a VRDex user.",
          requiredScopes,
        },
      ),
    };
  }

  const ownerCommunityProfileId = "ownerCommunityProfileId" in validation
    ? validation.ownerCommunityProfileId
    : undefined;
  const owner = oauthRateLimitOwnerForCredential({
    subjectType: validation.subjectType,
    ...(validation.userId === undefined ? {} : { userId: String(validation.userId) }),
    ...("ownerKind" in validation ? { ownerKind: validation.ownerKind } : {}),
    ...("ownerUserId" in validation ? { ownerUserId: String(validation.ownerUserId) } : {}),
    ...(ownerCommunityProfileId === undefined
      ? {}
      : { ownerCommunityProfileId: String(ownerCommunityProfileId) }),
  });

  return {
    ok: true as const,
    authInfo: {
      token: tokenValue,
      clientId: validation.clientId,
      scopes: tokenScopes,
      expiresAt: claims.exp,
      resource: new URL(resource),
      extra: {
        requestId: randomUUID(),
        subjectType: validation.subjectType,
        tokenId: claims.jti,
        ...(validation.userId === undefined ? {} : { userId: String(validation.userId) }),
      },
    } satisfies AuthInfo,
    clientId: validation.clientId,
    identity: { kind: "oauth_client" as const, value: validation.clientId },
    ...(owner === undefined ? {} : { owner }),
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

async function mcpRateLimitExceededResponse(args: {
  identity: ApiRateLimitIdentity;
  quotaTier: "standard" | "trusted_partner";
  rateLimit: Awaited<ReturnType<typeof checkApiRateLimit>>;
  routeClass: AcceptedMcpRouteClass;
}) {
  const policy = apiRateLimitPolicyForRouteClass(args.routeClass, args.quotaTier);
  const response = mcpJsonRpcError(429, -32000, "MCP rate limit exceeded.");

  await recordApiRateLimitBlockedEvent({
    identity: args.identity,
    quotaTier: args.quotaTier,
    rateLimit: args.rateLimit,
    routeClass: args.routeClass,
    windowMs: policy.windowMs,
  });

  response.headers.set("Retry-After", String(args.rateLimit.retryAfterSeconds));
  response.headers.set("RateLimit-Limit", String(args.rateLimit.limit));
  response.headers.set("RateLimit-Remaining", String(args.rateLimit.remaining));
  response.headers.set("RateLimit-Reset", String(Math.ceil(args.rateLimit.resetAt / 1_000)));

  return response;
}

async function rateLimitMcpAuthenticationFailure(
  request: Request,
  authenticationResponse: Response | null,
  options: { increment?: boolean } = {},
) {
  let evaluation: Awaited<ReturnType<typeof checkFailedMcpAuthenticationRateLimit>>;

  try {
    evaluation = await checkFailedMcpAuthenticationRateLimit(request, options);
  } catch {
    return mcpJsonRpcError(500, -32603, "MCP rate limiting is unavailable.");
  }

  return evaluation.rateLimit.allowed
    ? authenticationResponse
    : await mcpRateLimitExceededResponse({
        identity: evaluation.identity,
        quotaTier: evaluation.quotaTier,
        rateLimit: evaluation.rateLimit,
        routeClass: evaluation.routeClass,
      });
}

async function oversizedMcpRequestResponse(
  request: Request,
  dependencies: HostedMcpAuthorizationDependencies,
) {
  const identity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const quotaTier = "standard" as const;
  const routeClass = "anonymous_mcp_public_read" as const;
  let rateLimit;

  try {
    rateLimit = await (dependencies.checkRateLimit ?? checkApiRateLimit)({
      identity,
      quotaTier,
      routeClass,
    });
  } catch {
    return mcpJsonRpcError(500, -32603, "MCP rate limiting is unavailable.");
  }

  if (!rateLimit.allowed) {
    return await mcpRateLimitExceededResponse({
      identity,
      quotaTier,
      rateLimit,
      routeClass,
    });
  }

  return mcpJsonRpcError(413, -32600, "MCP request body exceeds the 1 MiB limit.");
}

export async function authorizeHostedMcpRequest(
  request: Request,
  dependencies: HostedMcpAuthorizationDependencies = {},
) {
  if (hasBearerTokenInUrl(request.url)) {
    return {
      response: mcpAuthenticationErrorResponse(
        request,
        400,
        -32600,
        "Bearer tokens must be sent in the Authorization header, not the URL.",
        {
          error: "invalid_request",
          errorDescription: "Bearer tokens must be sent in the Authorization header.",
        },
      ),
      routeClass: "anonymous_mcp_public_read" as const,
    };
  }

  const bearerToken = getBearerTokenFromAuthorizationHeader(request.headers.get("authorization"));
  const anonymousPublicReads =
    hostedMcpAnonymousPublicReadsEnabled()
    && !hostedMcpExplicitAuthenticationRequested(request);
  const blockedBeforeBodyRead = await rateLimitMcpAuthenticationFailure(request, null, {
    increment: false,
  });

  if (blockedBeforeBodyRead !== null) {
    return {
      response: blockedBeforeBodyRead,
      routeClass: bearerToken === null
        ? "anonymous_mcp_public_read" as const
        : "authenticated_mcp" as const,
    };
  }

  const parsedRequest = await boundedMcpToolCallNamesFromRequest(request.clone());

  if ("tooLarge" in parsedRequest && parsedRequest.tooLarge) {
    return {
      response: await oversizedMcpRequestResponse(request, dependencies),
      routeClass: bearerToken === null
        ? "anonymous_mcp_public_read" as const
        : "authenticated_mcp" as const,
    };
  }

  const toolNames = parsedRequest.toolNames;
  const writeToolsCalled = toolNames.filter((toolName) => mcpWriteToolNameSet.has(toolName));
  const writeCallCount = writeToolsCalled.length;
  const writeRequested = writeCallCount > 0;
  const readToolRequested = toolNames.some((toolName) => !mcpWriteToolNameSet.has(toolName));
  // Only the resources this request actually writes. Demanding the full write
  // catalog would make a link-editing agent ask for `events:write` it will never
  // use, which is the consent screen telling the user something untrue.
  const writeScopes: readonly ApiScope[] = writeRequested
    ? [
      "mcp:write",
      ...new Set(
        writeToolsCalled.map(
          (toolName) => mcpWriteToolResourceScopes[toolName as (typeof mcpWriteToolNames)[number]],
        ),
      ),
    ]
    : [];
  const requiredScopes: readonly ApiScope[] =
    writeRequested && readToolRequested
      ? [...mcpRequiredScopes, ...writeScopes]
      : writeRequested
        ? writeScopes
        : readToolRequested || bearerToken === null || request.method !== "POST"
          ? mcpRequiredScopes
          : [];
  const authenticatedRouteClass = writeRequested
    ? "authenticated_mcp_write" as const
    : "authenticated_mcp" as const;

  if (
    bearerToken === null
    && (writeRequested || !anonymousPublicReads)
  ) {
    const response = await rateLimitMcpAuthenticationFailure(
      request,
      mcpAuthenticationErrorResponse(request, 401, -32600, writeRequested
        ? "OAuth bearer token is required for hosted MCP writes."
        : "OAuth bearer token is required for this MCP deployment.", {
        requiredScopes,
      }),
    );

    return {
      response,
      routeClass: writeRequested
        ? "authenticated_mcp_write" as const
        : "anonymous_mcp_public_read" as const,
    };
  }

  const authentication =
    bearerToken === null
      ? {
          ok: true as const,
          identity: { kind: "ip" as const, value: clientIpForRequest(request) },
          quotaTier: "standard" as const,
        }
      : await authenticateMcpBearerToken(
          request,
          bearerToken,
          requiredScopes,
          authenticatedRouteClass,
          dependencies,
        );

  if (!authentication.ok) {
    return {
      response: await rateLimitMcpAuthenticationFailure(request, authentication.response),
      routeClass: authenticatedRouteClass,
    };
  }

  const routeClass =
    authentication.identity.kind === "oauth_client"
      ? authenticatedRouteClass
      : "anonymous_mcp_public_read";
  const quotaTier = authentication.quotaTier;

  let rateLimit;
  let rateLimitIdentity: ApiRateLimitIdentity = authentication.identity;

  try {
    if (authentication.identity.kind === "oauth_client" && "tokenId" in authentication) {
      const evaluation = await checkOAuthAccessTokenRateLimit({
        clientId: authentication.clientId,
        ...("owner" in authentication ? { owner: authentication.owner } : {}),
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
    return {
      response: mcpJsonRpcError(500, -32603, "MCP rate limiting is unavailable."),
      routeClass,
    };
  }

  if (rateLimit.allowed) {
    if (writeCallCount > 1) {
      return {
        response: mcpJsonRpcError(
          400,
          -32600,
          "MCP batches may contain at most one hosted write.",
        ),
        routeClass,
      };
    }

    return {
      response: null,
      routeClass,
      ...("authInfo" in authentication ? { authInfo: authentication.authInfo } : {}),
    };
  }

  return {
    response: await mcpRateLimitExceededResponse({
      identity: rateLimitIdentity,
      quotaTier,
      rateLimit,
      routeClass,
    }),
    routeClass,
  };
}

export async function rejectInvalidOrRateLimitedMcpRequest(request: Request) {
  return (await authorizeHostedMcpRequest(request)).response;
}

export function buildVrdexMcpServer(options: VrdexMcpServerOptions = {}) {
  const anonymousPublicReads = options.anonymousPublicReads ?? hostedMcpAnonymousPublicReadsEnabled();
  const convex = () => options.convex ?? convexHttpClient();
  const adminConvex = () => options.adminConvex ?? convexAdminHttpClient();
  const now = options.now ?? Date.now;
  const readToolMeta = mcpReadToolMeta(anonymousPublicReads);
  const principalFor = (toolName: (typeof mcpWriteToolNames)[number]) =>
    hostedMcpPrincipal(options.authInfo, toolName);
  // Passed to the mutation rather than checked here: whether the wider grant is
  // needed depends on who owns the target, which only the write can answer.
  const contributeGranted = options.authInfo?.scopes?.includes("profile:contribute") === true;
  const server = new McpServer({
    name: "vrdex",
    version: "0.5.0",
  });

  /**
   * Read the saved profile back publicly before reporting success.
   *
   * Same contract the event tools hold themselves to: an agent that is told a
   * write succeeded will move on, so "succeeded" has to mean the public surface
   * actually shows it. A readback failure is reported as a warning rather than a
   * failure, because the write itself did land and retrying would double it.
   */
  async function profileWriteResult(args: {
    idempotencyKeyHash: string;
    principal: HostedMcpPrincipal;
    toolName: "vrdex_profile_update" | "vrdex_profile_submit";
    write: z.infer<typeof ApiProfileWriteResponseSchema>;
  }) {
    const { idempotencyKeyHash, principal, toolName, write } = args;
    const targetProfileId = write.profileId as Id<"profiles">;

    // Nothing to read back, and that is the correct outcome rather than a
    // failure: an owner may edit a draft or opted-out profile, and demanding a
    // public readback there answers a successful write with an error.
    if (!write.publiclyViewable) {
      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "accepted",
        targetProfileId,
        toolName,
      });

      return mcpJsonResult(mcpProfileWriteResultSchema, {
        ...write,
        canonicalUrl: publicUrlForRoutePath(write.profilePath),
      });
    }

    let profile: PublicProfile | null;

    try {
      profile = await convex().query(api.profiles.getPublicBySlug, {
        slug: write.slug,
        now: now(),
      });
    } catch {
      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "readback_warning",
        targetProfileId,
        toolName,
      });
      return mcpProfileReadbackError(write);
    }

    if (profile === null || profile.id !== write.profileId) {
      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "readback_warning",
        targetProfileId,
        toolName,
      });
      return mcpProfileReadbackError(
        write,
        profile === null
          ? "The saved profile is not publicly readable yet."
          : "The public profile readback did not match the saved profile.",
      );
    }

    let result: ReturnType<typeof mcpJsonResult<z.infer<typeof mcpProfileWriteResultSchema>>>;

    try {
      result = mcpJsonResult(mcpProfileWriteResultSchema, {
        ...write,
        canonicalUrl: publicUrlForRoutePath(write.profilePath),
        profile,
      });
    } catch {
      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "readback_warning",
        targetProfileId,
        toolName,
      });
      return mcpProfileReadbackError(
        write,
        "The saved profile did not match the public response contract.",
      );
    }

    await recordHostedMcpWriteInvocation({
      idempotencyKeyHash,
      principal,
      result: "accepted",
      targetProfileId,
      toolName,
    });
    return result;
  }

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

    const results = await convex().query(api.search.searchUniversal, {
      query: searchText,
      limit: cappedLimit,
      ...publicSearchBackendFilters(normalizedType),
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
    },
    async ({ limit }) => {
      const cappedLimit = boundedLimit(limit, 8, 24);
      let events;

      try {
        events = await convex().query(api.events.listPublicUpcoming, { now: now(), limit: cappedLimit });
      } catch {
        return mcpPublicReadUnavailable("upcoming events");
      }

      return mcpJsonResult(PublicEventsResponseSchema, {
        events,
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
      _meta: readToolMeta,
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
      _meta: readToolMeta,
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

  server.registerTool(
    "vrdex_event_create",
    {
      title: "Create VRDex Event",
      description:
        "Create and publish an event for a community owned by the signed-in VRDex user. This changes public data and requires explicit approval.",
      inputSchema: mcpEventCreateInputSchema,
      outputSchema: mcpOutputSchema(mcpEventWriteResultSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes: mcpWriteSecuritySchemes("vrdex_event_create") },
    },
    async ({ idempotencyKey, ...input }) => {
      const principal = principalFor("vrdex_event_create");
      if (principal === null) {
        return mcpWriteUnauthorized("vrdex_event_create");
      }

      const idempotencyKeyHash = sha256(idempotencyKey);
      const requestFingerprint = sha256(canonicalJson(input));
      let write: z.infer<typeof ApiEventWriteResponseSchema>;

      try {
        write = await adminConvex().mutation(internal.events.createCommunityEventForMcpOwner, {
          ...input,
          idempotencyKeyHash,
          oauthClientId: principal.clientId,
          oauthTokenId: principal.tokenId,
          ownerUserId: principal.userId,
          requestFingerprint,
          requestId: principal.requestId,
        });
      } catch (error) {
        const denied = isMcpWriteDenied(error);

        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: denied ? "denied" : "indeterminate",
          toolName: "vrdex_event_create",
        });
        return denied ? mcpEventWriteDenied() : mcpEventWriteIndeterminate("create");
      }

      let event: PublicEvent | null;

      try {
        event = await convex().query(api.events.getPublicBySlug, { slug: write.slug });
      } catch {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_create",
        });
        return mcpEventReadbackError(write);
      }

      if (event === null || event.id !== write.eventId) {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_create",
        });
        return mcpEventReadbackError(
          write,
          event === null
            ? "The saved event is not publicly readable yet."
            : "The public event readback did not match the saved event.",
        );
      }

      let result: ReturnType<typeof mcpJsonResult<z.infer<typeof mcpEventWriteResultSchema>>>;

      try {
        result = mcpJsonResult(mcpEventWriteResultSchema, {
          ...write,
          canonicalUrl: publicUrlForRoutePath(write.eventPath),
          event,
        });
      } catch {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_create",
        });
        return mcpEventReadbackError(write, "The saved event did not match the public response contract.");
      }

      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "accepted",
        targetEventId: write.eventId as Id<"events">,
        toolName: "vrdex_event_create",
      });
      return result;
    },
  );

  server.registerTool(
    "vrdex_event_update",
    {
      title: "Update VRDex Event",
      description:
        "Update an event owned through the signed-in VRDex user's community. Omitted fields are preserved; explicit nulls and empty arrays clear data. This changes public data and requires explicit approval.",
      inputSchema: mcpEventUpdateInputSchema,
      outputSchema: mcpOutputSchema(mcpEventWriteResultSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes: mcpWriteSecuritySchemes("vrdex_event_update") },
    },
    async ({ idempotencyKey, slug, update }) => {
      const principal = principalFor("vrdex_event_update");
      if (principal === null) {
        return mcpWriteUnauthorized("vrdex_event_update");
      }

      const idempotencyKeyHash = sha256(idempotencyKey);
      const requestFingerprint = sha256(canonicalJson({ slug, update }));
      let write: z.infer<typeof ApiEventWriteResponseSchema>;

      try {
        write = await adminConvex().mutation(internal.events.updateCommunityEventForMcpOwner, {
          ...update,
          currentSlug: slug,
          idempotencyKeyHash,
          oauthClientId: principal.clientId,
          oauthTokenId: principal.tokenId,
          ownerUserId: principal.userId,
          requestFingerprint,
          requestId: principal.requestId,
        });
      } catch (error) {
        const denied = isMcpWriteDenied(error);

        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: denied ? "denied" : "indeterminate",
          toolName: "vrdex_event_update",
        });
        return denied ? mcpEventWriteDenied() : mcpEventWriteIndeterminate("update");
      }

      let event: PublicEvent | null;

      try {
        event = await convex().query(api.events.getPublicBySlug, { slug: write.slug });
      } catch {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_update",
        });
        return mcpEventReadbackError(write);
      }

      if (event === null || event.id !== write.eventId) {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_update",
        });
        return mcpEventReadbackError(
          write,
          event === null
            ? "The saved event is not publicly readable yet."
            : "The public event readback did not match the saved event.",
        );
      }

      let result: ReturnType<typeof mcpJsonResult<z.infer<typeof mcpEventWriteResultSchema>>>;

      try {
        result = mcpJsonResult(mcpEventWriteResultSchema, {
          ...write,
          canonicalUrl: publicUrlForRoutePath(write.eventPath),
          event,
        });
      } catch {
        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: "readback_warning",
          targetEventId: write.eventId as Id<"events">,
          toolName: "vrdex_event_update",
        });
        return mcpEventReadbackError(write, "The saved event did not match the public response contract.");
      }

      await recordHostedMcpWriteInvocation({
        idempotencyKeyHash,
        principal,
        result: "accepted",
        targetEventId: write.eventId as Id<"events">,
        toolName: "vrdex_event_update",
      });
      return result;
    },
  );

  server.registerTool(
    "vrdex_profile_update",
    {
      title: "Update VRDex Profile",
      description:
        "Update a profile owned by the signed-in VRDex user, or an unclaimed profile as a community correction, which additionally requires profile:contribute and expectedUpdatedAt from the profile as you read it. Omitted fields are preserved; sending outboundLinks replaces the whole list. This changes public data and requires explicit approval.",
      inputSchema: mcpProfileUpdateInputSchema,
      outputSchema: mcpOutputSchema(mcpProfileWriteResultSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes: mcpWriteSecuritySchemes("vrdex_profile_update") },
    },
    async ({ idempotencyKey, slug, update }) => {
      const principal = principalFor("vrdex_profile_update");
      if (principal === null) {
        return mcpWriteUnauthorized("vrdex_profile_update");
      }

      const idempotencyKeyHash = sha256(idempotencyKey);
      const requestFingerprint = sha256(canonicalJson({ slug, update }));
      let write: z.infer<typeof ApiProfileWriteResponseSchema>;

      try {
        write = await adminConvex().mutation(internal.profiles.updateProfileForMcpActor, {
          ...update,
          contributeGranted,
          currentSlug: slug,
          idempotencyKeyHash,
          oauthClientId: principal.clientId,
          oauthTokenId: principal.tokenId,
          ownerUserId: principal.userId,
          requestFingerprint,
          requestId: principal.requestId,
        });
      } catch (error) {
        const code = mcpConvexErrorCode(error);

        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          // Any code at all means the mutation refused deliberately and wrote
          // nothing. Only an error the backend never classified leaves the
          // outcome unknown, and that is the one an agent must not retry.
          result: code === null ? "indeterminate" : "denied",
          toolName: "vrdex_profile_update",
        });

        if (code === null) {
          return mcpProfileWriteIndeterminate("update");
        }

        if (code === "PROFILE_CLAIMED") {
          return mcpProfileClaimed();
        }

        return code === "MCP_WRITE_DENIED"
          ? mcpProfileWriteDenied()
          : mcpProfileWriteRejected(error);
      }

      return await profileWriteResult({
        idempotencyKeyHash,
        principal,
        toolName: "vrdex_profile_update",
        write,
      });
    },
  );

  server.registerTool(
    "vrdex_profile_submit",
    {
      title: "Submit VRDex Community Profile",
      description:
        "Create and publish a community-sourced profile, left unclaimed and credited to the signed-in VRDex user. Search first: a duplicate submission creates a second profile. This changes public data and requires explicit approval.",
      inputSchema: mcpProfileSubmitInputSchema,
      outputSchema: mcpOutputSchema(mcpProfileWriteResultSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: { securitySchemes: mcpWriteSecuritySchemes("vrdex_profile_submit") },
    },
    async ({ idempotencyKey, ...input }) => {
      const principal = principalFor("vrdex_profile_submit");
      if (principal === null) {
        return mcpWriteUnauthorized("vrdex_profile_submit");
      }

      const idempotencyKeyHash = sha256(idempotencyKey);
      const requestFingerprint = sha256(canonicalJson(input));
      let write: z.infer<typeof ApiProfileWriteResponseSchema>;

      try {
        write = await adminConvex().mutation(internal.profiles.submitCommunityProfileForMcpActor, {
          ...input,
          idempotencyKeyHash,
          oauthClientId: principal.clientId,
          oauthTokenId: principal.tokenId,
          ownerUserId: principal.userId,
          requestFingerprint,
          requestId: principal.requestId,
        });
      } catch (error) {
        const code = mcpConvexErrorCode(error);

        await recordHostedMcpWriteInvocation({
          idempotencyKeyHash,
          principal,
          result: code === null ? "indeterminate" : "denied",
          toolName: "vrdex_profile_submit",
        });

        if (code === null) {
          return mcpProfileWriteIndeterminate("submission");
        }

        return code === "MCP_WRITE_DENIED"
          ? mcpProfileWriteDenied()
          : mcpProfileWriteRejected(error);
      }

      return await profileWriteResult({
        idempotencyKeyHash,
        principal,
        toolName: "vrdex_profile_submit",
        write,
      });
    },
  );

  return server;
}

export function createVrdexMcpHandler(options: VrdexMcpServerOptions = {}): McpHttpHandler {
  return createMcpHandler((context) => buildVrdexMcpServer({
    ...options,
    authInfo: context.authInfo ?? options.authInfo,
  }), {
    legacy: "stateless",
  });
}