import type { ApiRouteClass } from "@vrdex/api-contracts";

import type {
  ApiRateLimitIdentity,
  ApiRateLimitQuotaTier,
  ApiRateLimitResult,
} from "./api-rate-limit";

export function apiRateLimitBlockedEventInput(args: {
  identity: ApiRateLimitIdentity;
  quotaTier: ApiRateLimitQuotaTier;
  rateLimit: ApiRateLimitResult;
  routeClass: ApiRouteClass;
  windowMs: number;
}) {
  return {
    identityKind: args.identity.kind,
    limit: args.rateLimit.limit,
    quotaTier: args.quotaTier,
    remaining: args.rateLimit.remaining,
    resetAt: args.rateLimit.resetAt,
    retryAfterSeconds: args.rateLimit.retryAfterSeconds,
    routeClass: args.routeClass,
    windowMs: args.windowMs,
  };
}

export async function recordApiRateLimitBlockedEvent(args: Parameters<typeof apiRateLimitBlockedEventInput>[0]) {
  try {
    const [{ internal }, { convexAdminHttpClient }] = await Promise.all([
      import("@convex-generated-api"),
      import("./convex-http"),
    ]);

    return await convexAdminHttpClient().mutation(
      internal.apiRateLimitEvents.recordBlocked,
      apiRateLimitBlockedEventInput(args),
    );
  } catch {
    return null;
  }
}
