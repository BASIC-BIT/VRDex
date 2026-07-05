import { ApiRateLimitUsageResponseSchema } from "@vrdex/api-contracts";

import { apiJson, evaluateOptionalApiBearerRequest, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { listDefaultApiRateLimitPolicies } from "@/lib/server/api-rate-limit";

export const dynamic = "force-dynamic";

function credentialKindForIdentity(identityKind: "api_token" | "ip" | "oauth_client") {
  if (identityKind === "api_token") {
    return "personal_api_token";
  }

  if (identityKind === "oauth_client") {
    return "oauth_client";
  }

  return "anonymous";
}

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateOptionalApiBearerRequest(request);
  if (!evaluation.ok) {
    return evaluation.response;
  }

  const credentialKind = credentialKindForIdentity(evaluation.context.identityKind);

  return apiJson(ApiRateLimitUsageResponseSchema, {
    caller: {
      authenticated: credentialKind !== "anonymous",
      credentialKind,
      routeClass: evaluation.context.routeClass,
    },
    currentWindow: {
      limit: evaluation.context.rateLimit.limit,
      remaining: evaluation.context.rateLimit.remaining,
      resetAt: evaluation.context.rateLimit.resetAt,
      retryAfterSeconds: evaluation.context.rateLimit.retryAfterSeconds,
      routeClass: evaluation.context.routeClass,
      windowMs: evaluation.context.windowMs,
    },
    policies: listDefaultApiRateLimitPolicies(),
  });
}
