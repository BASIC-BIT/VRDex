import { apiRouteClasses, type ApiRouteClass } from "@vrdex/api-contracts";
import { isIP } from "node:net";

export type ApiRateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type ApiRateLimitIdentity = {
  kind:
    | "api_token"
    | "ip"
    | "oauth_client"
    | "oauth_owner"
    | "oauth_redirect_host"
    | "oauth_registration_software";
  value: string;
};

export type ApiRateLimitQuotaTier = "standard" | "trusted_partner";

export type ApiRateLimitResult = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
  routeClassWindowCount?: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type MemoryBucket = {
  count: number;
  resetAt: number;
};

export type MemoryApiRateLimitStore = Map<string, MemoryBucket>;

export const defaultApiRateLimitPolicies: Record<ApiRouteClass, ApiRateLimitPolicy> = {
  anonymous_public_read: { limit: 120, windowMs: 60_000 },
  authenticated_public_read: { limit: 600, windowMs: 60_000 },
  developer_credential_management: { limit: 30, windowMs: 60_000 },
  oauth_authorize: { limit: 60, windowMs: 60_000 },
  oauth_token: { limit: 30, windowMs: 60_000 },
  oauth_dynamic_client_registration: { limit: 10, windowMs: 60_000 },
  asset_upload_intent: { limit: 30, windowMs: 60_000 },
  public_write: { limit: 30, windowMs: 60_000 },
  anonymous_mcp_public_read: { limit: 60, windowMs: 60_000 },
  authenticated_mcp: { limit: 300, windowMs: 60_000 },
};

export const trustedPartnerApiRateLimitMultiplier = 100;

const trustedPartnerBoostedRouteClasses = new Set<ApiRouteClass>([
  "authenticated_public_read",
  "asset_upload_intent",
  "public_write",
  "authenticated_mcp",
]);

export const oauthClientAggregateRateLimitMultiplier = 10;
export const oauthOwnerAggregateRateLimitMultiplier = 25;

export function oauthRateLimitOwnerForCredential(credential: {
  ownerCommunityProfileId?: string;
  ownerKind?: "community" | "user";
  ownerUserId?: string;
  subjectType: "client" | "user";
  userId?: string;
}) {
  if (credential.subjectType === "user" && credential.userId !== undefined) {
    return { id: credential.userId, kind: "user" as const };
  }

  if (credential.subjectType !== "client" || credential.ownerKind === undefined || credential.ownerUserId === undefined) {
    return undefined;
  }

  return credential.ownerKind === "community" && credential.ownerCommunityProfileId !== undefined
    ? { id: credential.ownerCommunityProfileId, kind: "community" as const }
    : { id: credential.ownerUserId, kind: "user" as const };
}

const globalRateLimitState = globalThis as typeof globalThis & {
  __vrdexApiRateLimitMemory?: MemoryApiRateLimitStore;
};

function memoryStore() {
  globalRateLimitState.__vrdexApiRateLimitMemory ??= new Map();

  return globalRateLimitState.__vrdexApiRateLimitMemory;
}

function rateLimitStoreMode() {
  return process.env.VRDEX_RATE_LIMIT_STORE?.trim().toLowerCase() || "memory";
}

function deploymentEnvironment() {
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();
  const configuredEnvironment = process.env.VRDEX_DEPLOYMENT_ENV?.trim().toLowerCase();
  const environment = vercelEnvironment || configuredEnvironment;

  if (environment !== undefined && !["development", "preview", "staging", "production"].includes(environment)) {
    throw new Error("VRDEX_DEPLOYMENT_ENV must be development, preview, staging, or production.");
  }

  if (environment !== undefined) {
    return environment;
  }

  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function assertRateLimitStoreAllowed(mode: string) {
  if (deploymentEnvironment() !== "production") {
    return;
  }

  if (!process.env.VRDEX_RATE_LIMIT_STORE?.trim()) {
    throw new Error("Production deployments must configure VRDEX_RATE_LIMIT_STORE with a shared store.");
  }

  if (mode === "memory" || mode === "disabled" || mode === "none") {
    throw new Error(`Production deployments cannot use the ${mode} API rate limit store.`);
  }
}

function rateLimitPrefix() {
  return process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX?.trim() || "vrdex:api-rate";
}

export function listDefaultApiRateLimitPolicies() {
  return apiRouteClasses.map((routeClass) => ({
    routeClass,
    ...defaultApiRateLimitPolicies[routeClass],
  }));
}

export function apiRateLimitPolicyForRouteClass(
  routeClass: ApiRouteClass,
  quotaTier: ApiRateLimitQuotaTier = "standard",
) {
  const policy = defaultApiRateLimitPolicies[routeClass];

  if (quotaTier !== "trusted_partner" || !trustedPartnerBoostedRouteClasses.has(routeClass)) {
    return policy;
  }

  return {
    ...policy,
    limit: policy.limit * trustedPartnerApiRateLimitMultiplier,
  };
}

export function listApiRateLimitPolicies(quotaTier: ApiRateLimitQuotaTier = "standard") {
  return apiRouteClasses.map((routeClass) => ({
    routeClass,
    quotaTier,
    ...apiRateLimitPolicyForRouteClass(routeClass, quotaTier),
  }));
}

function identitySegment(identity: ApiRateLimitIdentity) {
  return `${identity.kind}:${identity.value.trim() || "unknown"}`;
}

export async function hashedApiRateLimitIdentityValue(namespace: string, value: string) {
  const input = new TextEncoder().encode(
    `${namespace.trim().toLowerCase()}\0${value.trim().toLowerCase()}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", input);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rateLimitKey(routeClass: ApiRouteClass, identity: ApiRateLimitIdentity) {
  return `${rateLimitPrefix()}:${routeClass}:${identitySegment(identity)}`;
}

export function apiRateLimitRouteClassRequestCounterKey(routeClass: ApiRouteClass) {
  return `${rateLimitPrefix()}:${routeClass}:requests`;
}

function resultForCount(args: {
  count: number;
  key: string;
  now: number;
  policy: ApiRateLimitPolicy;
  routeClassWindowCount?: number;
  resetAt: number;
}): ApiRateLimitResult {
  const remaining = Math.max(0, args.policy.limit - args.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((args.resetAt - args.now) / 1_000));

  return {
    allowed: args.count <= args.policy.limit,
    key: args.key,
    limit: args.policy.limit,
    remaining,
    ...(args.routeClassWindowCount === undefined ? {} : { routeClassWindowCount: args.routeClassWindowCount }),
    resetAt: args.resetAt,
    retryAfterSeconds,
  };
}

function isVercelRuntime() {
  const value = process.env.VERCEL?.trim().toLowerCase();

  return value === "1" || value === "true";
}

export function trustedClientIpHeaderName() {
  if (isVercelRuntime()) {
    return "x-vercel-forwarded-for";
  }

  const configuredHeader = process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER?.trim().toLowerCase();

  if (!configuredHeader) {
    return undefined;
  }

  if (!/^[a-z0-9-]+$/.test(configuredHeader)) {
    throw new Error("VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER must be a valid HTTP header name.");
  }

  return configuredHeader;
}

export function clientIpForRequest(request: Request) {
  const headerName = trustedClientIpHeaderName();

  if (headerName === undefined) {
    return "unknown";
  }

  const value = request.headers.get(headerName)?.trim();

  if (!value || value.includes(",") || isIP(value) === 0) {
    return "unknown";
  }

  return value.toLowerCase();
}

export function apiRateLimitResponseHeaders(rateLimit: ApiRateLimitResult) {
  return {
    "Retry-After": String(rateLimit.retryAfterSeconds),
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
    "RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1_000)),
  };
}

export function createMemoryApiRateLimitStore(): MemoryApiRateLimitStore {
  return new Map();
}

function incrementMemoryApiRateLimitBucket(args: {
  key: string;
  now: number;
  policy: ApiRateLimitPolicy;
  store: MemoryApiRateLimitStore;
}) {
  const current = args.store.get(args.key);
  const bucket =
    current === undefined || current.resetAt <= args.now
      ? { count: 0, resetAt: args.now + args.policy.windowMs }
      : current;

  bucket.count += 1;
  args.store.set(args.key, bucket);

  return bucket;
}

export function checkMemoryApiRateLimit(args: {
  identity: ApiRateLimitIdentity;
  now?: number;
  policy: ApiRateLimitPolicy;
  routeClass: ApiRouteClass;
  store: MemoryApiRateLimitStore;
  trackRouteClassRequest?: boolean;
}) {
  const now = args.now ?? Date.now();
  const key = rateLimitKey(args.routeClass, args.identity);
  const bucket = incrementMemoryApiRateLimitBucket({
    key,
    now,
    policy: args.policy,
    store: args.store,
  });
  const routeClassBucket =
    args.trackRouteClassRequest === false
      ? undefined
      : incrementMemoryApiRateLimitBucket({
          key: apiRateLimitRouteClassRequestCounterKey(args.routeClass),
          now,
          policy: args.policy,
          store: args.store,
        });

  return resultForCount({
    count: bucket.count,
    key,
    now,
    policy: args.policy,
    ...(routeClassBucket === undefined ? {} : { routeClassWindowCount: routeClassBucket.count }),
    resetAt: bucket.resetAt,
  });
}

export async function checkRedisRestApiRateLimit(args: {
  fetcher?: typeof fetch;
  identity: ApiRateLimitIdentity;
  now: number;
  policy: ApiRateLimitPolicy;
  routeClass: ApiRouteClass;
  trackRouteClassRequest?: boolean;
}) {
  const restUrl = process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL?.trim();
  const restToken = process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN?.trim();

  if (!restUrl || !restToken) {
    throw new Error("Redis REST rate limiting requires VRDEX_RATE_LIMIT_REDIS_REST_URL and VRDEX_RATE_LIMIT_REDIS_REST_TOKEN.");
  }

  const key = rateLimitKey(args.routeClass, args.identity);
  const routeClassCounterKey = apiRateLimitRouteClassRequestCounterKey(args.routeClass);
  const pipelineUrl = new URL("pipeline", restUrl.endsWith("/") ? restUrl : `${restUrl}/`);
  const fetcher = args.fetcher ?? fetch;
  const commands: string[][] = [
    ["INCR", key],
    ["PEXPIRE", key, String(args.policy.windowMs), "NX"],
    ["PTTL", key],
  ];

  if (args.trackRouteClassRequest !== false) {
    commands.push(["INCR", routeClassCounterKey], ["PEXPIRE", routeClassCounterKey, String(args.policy.windowMs), "NX"]);
  }

  const response = await fetcher(pipelineUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${restToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(`Redis REST rate limit check failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown }>;
  const count = Number(payload[0]?.result);
  const ttlMs = Number(payload[2]?.result);
  const routeClassWindowCount = Number(payload[3]?.result);

  if (!Number.isFinite(count)) {
    throw new Error("Redis REST rate limit check returned an invalid counter.");
  }

  return resultForCount({
    count,
    key,
    now: args.now,
    policy: args.policy,
    routeClassWindowCount: Number.isFinite(routeClassWindowCount) ? routeClassWindowCount : undefined,
    resetAt: args.now + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : args.policy.windowMs),
  });
}

export async function checkApiRateLimit(args: {
  identity: ApiRateLimitIdentity;
  now?: number;
  quotaTier?: ApiRateLimitQuotaTier;
  routeClass: ApiRouteClass;
  limitMultiplier?: number;
  trackRouteClassRequest?: boolean;
}) {
  const basePolicy = apiRateLimitPolicyForRouteClass(args.routeClass, args.quotaTier);
  const limitMultiplier = args.limitMultiplier ?? 1;

  if (!Number.isInteger(limitMultiplier) || limitMultiplier < 1) {
    throw new Error("API rate limit multiplier must be a positive integer.");
  }

  const policy = { ...basePolicy, limit: basePolicy.limit * limitMultiplier };
  const now = args.now ?? Date.now();
  const mode = rateLimitStoreMode();
  assertRateLimitStoreAllowed(mode);

  if (mode === "disabled" || mode === "none") {
    return resultForCount({
      count: 1,
      key: rateLimitKey(args.routeClass, args.identity),
      now,
      policy: { limit: Number.MAX_SAFE_INTEGER, windowMs: policy.windowMs },
      resetAt: now + policy.windowMs,
    });
  }

  if (mode === "redis-rest" || mode === "upstash") {
    return await checkRedisRestApiRateLimit({
      identity: args.identity,
      now,
      policy,
      routeClass: args.routeClass,
      trackRouteClassRequest: args.trackRouteClassRequest,
    });
  }

  if (mode !== "memory") {
    throw new Error(`Unsupported API rate limit store: ${mode}`);
  }

  return checkMemoryApiRateLimit({
    identity: args.identity,
    now,
    policy,
    routeClass: args.routeClass,
    store: memoryStore(),
    trackRouteClassRequest: args.trackRouteClassRequest,
  });
}

export async function checkOAuthAccessTokenRateLimit(args: {
  clientId: string;
  owner?: {
    id: string;
    kind: "community" | "user";
  };
  quotaTier: ApiRateLimitQuotaTier;
  routeClass: ApiRouteClass;
  tokenId: string;
  checkRateLimit?: typeof checkApiRateLimit;
}) {
  const checkRateLimit = args.checkRateLimit ?? checkApiRateLimit;
  const tokenIdentity = { kind: "oauth_client" as const, value: args.tokenId };
  const clientIdentity = { kind: "oauth_client" as const, value: args.clientId };
  const tokenRateLimit = await checkRateLimit({
    identity: tokenIdentity,
    quotaTier: args.quotaTier,
    routeClass: args.routeClass,
  });

  if (!tokenRateLimit.allowed) {
    return { identity: tokenIdentity, rateLimit: tokenRateLimit };
  }

  const clientRateLimit = await checkRateLimit({
    identity: clientIdentity,
    limitMultiplier: oauthClientAggregateRateLimitMultiplier,
    quotaTier: args.quotaTier,
    routeClass: args.routeClass,
    trackRouteClassRequest: false,
  });

  if (!clientRateLimit.allowed) {
    return { identity: clientIdentity, rateLimit: clientRateLimit };
  }

  if (args.owner !== undefined) {
    const ownerIdentity = {
      kind: "oauth_owner" as const,
      value: await hashedApiRateLimitIdentityValue("oauth-owner", `${args.owner.kind}:${args.owner.id}`),
    };
    const ownerRateLimit = await checkRateLimit({
      identity: ownerIdentity,
      limitMultiplier: oauthOwnerAggregateRateLimitMultiplier,
      quotaTier: args.quotaTier,
      routeClass: args.routeClass,
      trackRouteClassRequest: false,
    });

    if (!ownerRateLimit.allowed) {
      return { identity: ownerIdentity, rateLimit: ownerRateLimit };
    }
  }

  return { identity: tokenIdentity, rateLimit: tokenRateLimit };
}
