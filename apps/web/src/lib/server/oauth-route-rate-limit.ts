import type { ApiRouteClass } from "@vrdex/api-contracts";

import {
  apiRateLimitPolicyForRouteClass,
  apiRateLimitResponseHeaders,
  checkApiRateLimit,
  clientIpForRequest,
} from "./api-rate-limit";
import { recordApiRateLimitBlockedEvent } from "./api-rate-limit-events";

type OAuthRateLimitRouteClass = Extract<ApiRouteClass, "oauth_authorize" | "oauth_token">;

export type OAuthRouteRateLimitDependencies = {
  checkRateLimit?: typeof checkApiRateLimit;
  recordRateLimitBlockedEvent?: typeof recordApiRateLimitBlockedEvent;
};

function oauthProblem(
  status: 429 | 500,
  error: "server_error" | "temporarily_unavailable",
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

export async function oauthRateLimitResponse(
  request: Request,
  routeClass: OAuthRateLimitRouteClass,
  dependencies: OAuthRouteRateLimitDependencies = {},
) {
  const checkRateLimit = dependencies.checkRateLimit ?? checkApiRateLimit;
  const recordRateLimitBlockedEvent =
    dependencies.recordRateLimitBlockedEvent ?? recordApiRateLimitBlockedEvent;
  const identity = { kind: "ip" as const, value: clientIpForRequest(request) };
  const policy = apiRateLimitPolicyForRouteClass(routeClass);
  let rateLimit;

  try {
    rateLimit = await checkRateLimit({ identity, routeClass });
  } catch {
    return oauthProblem(
      500,
      "server_error",
      "The OAuth endpoint is not configured with a working rate limiter.",
    );
  }

  if (rateLimit.allowed) {
    return null;
  }

  await recordRateLimitBlockedEvent({
    identity,
    quotaTier: "standard",
    rateLimit,
    routeClass,
    windowMs: policy.windowMs,
  });

  return oauthProblem(
    429,
    "temporarily_unavailable",
    "Too many OAuth requests were sent from this network.",
    apiRateLimitResponseHeaders(rateLimit),
  );
}
