import { apiRouteClasses, type ApiRouteClass } from "@vrdex/api-contracts";

export type ApiRateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type ApiRateLimitIdentity = {
  kind: "api_token" | "ip" | "oauth_client";
  value: string;
};

export type ApiRateLimitQuotaTier = "standard" | "trusted_partner";

export type ApiRateLimitResult = {
  allowed: boolean;
  key: string;
  limit: number;
  remaining: number;
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

function rateLimitKey(routeClass: ApiRouteClass, identity: ApiRateLimitIdentity) {
  return `${rateLimitPrefix()}:${routeClass}:${identitySegment(identity)}`;
}

function resultForCount(args: {
  count: number;
  key: string;
  now: number;
  policy: ApiRateLimitPolicy;
  resetAt: number;
}): ApiRateLimitResult {
  const remaining = Math.max(0, args.policy.limit - args.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((args.resetAt - args.now) / 1_000));

  return {
    allowed: args.count <= args.policy.limit,
    key: args.key,
    limit: args.policy.limit,
    remaining,
    resetAt: args.resetAt,
    retryAfterSeconds,
  };
}

export function clientIpForRequest(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return forwardedFor || realIp || "unknown";
}

export function createMemoryApiRateLimitStore(): MemoryApiRateLimitStore {
  return new Map();
}

export function checkMemoryApiRateLimit(args: {
  identity: ApiRateLimitIdentity;
  now?: number;
  policy: ApiRateLimitPolicy;
  routeClass: ApiRouteClass;
  store: MemoryApiRateLimitStore;
}) {
  const now = args.now ?? Date.now();
  const key = rateLimitKey(args.routeClass, args.identity);
  const current = args.store.get(key);
  const bucket =
    current === undefined || current.resetAt <= now
      ? { count: 0, resetAt: now + args.policy.windowMs }
      : current;

  bucket.count += 1;
  args.store.set(key, bucket);

  return resultForCount({
    count: bucket.count,
    key,
    now,
    policy: args.policy,
    resetAt: bucket.resetAt,
  });
}

export async function checkRedisRestApiRateLimit(args: {
  fetcher?: typeof fetch;
  identity: ApiRateLimitIdentity;
  now: number;
  policy: ApiRateLimitPolicy;
  routeClass: ApiRouteClass;
}) {
  const restUrl = process.env.VRDEX_RATE_LIMIT_REDIS_REST_URL?.trim();
  const restToken = process.env.VRDEX_RATE_LIMIT_REDIS_REST_TOKEN?.trim();

  if (!restUrl || !restToken) {
    throw new Error("Redis REST rate limiting requires VRDEX_RATE_LIMIT_REDIS_REST_URL and VRDEX_RATE_LIMIT_REDIS_REST_TOKEN.");
  }

  const key = rateLimitKey(args.routeClass, args.identity);
  const pipelineUrl = new URL("pipeline", restUrl.endsWith("/") ? restUrl : `${restUrl}/`);
  const fetcher = args.fetcher ?? fetch;
  const response = await fetcher(pipelineUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${restToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["PEXPIRE", key, String(args.policy.windowMs), "NX"],
      ["PTTL", key],
    ]),
  });

  if (!response.ok) {
    throw new Error(`Redis REST rate limit check failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as Array<{ result?: unknown }>;
  const count = Number(payload[0]?.result);
  const ttlMs = Number(payload[2]?.result);

  if (!Number.isFinite(count)) {
    throw new Error("Redis REST rate limit check returned an invalid counter.");
  }

  return resultForCount({
    count,
    key,
    now: args.now,
    policy: args.policy,
    resetAt: args.now + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : args.policy.windowMs),
  });
}

export async function checkApiRateLimit(args: {
  identity: ApiRateLimitIdentity;
  now?: number;
  quotaTier?: ApiRateLimitQuotaTier;
  routeClass: ApiRouteClass;
}) {
  const policy = apiRateLimitPolicyForRouteClass(args.routeClass, args.quotaTier);
  const now = args.now ?? Date.now();
  const mode = rateLimitStoreMode();

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
  });
}
