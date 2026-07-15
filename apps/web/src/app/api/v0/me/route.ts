import { ApiMeResponseSchema, getBearerTokenFromAuthorizationHeader } from "@vrdex/api-contracts";

import {
  apiJson,
  apiProblemResponse,
  evaluateOptionalApiBearerRequest,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";

export const dynamic = "force-dynamic";

function missingBearerResponse() {
  return apiProblemResponse({
    type: "about:blank",
    title: "Bearer token required",
    status: 401,
    detail: "Send a personal API token or API-resource OAuth access token with the Authorization header.",
  });
}

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  if (getBearerTokenFromAuthorizationHeader(request.headers.get("authorization")) === null) {
    return missingBearerResponse();
  }

  const evaluation = await evaluateOptionalApiBearerRequest(request);
  if (!evaluation.ok) {
    return evaluation.response;
  }

  if (evaluation.context.credential.kind === "anonymous") {
    return missingBearerResponse();
  }

  return apiJson(ApiMeResponseSchema, {
    credential: evaluation.context.credential,
    rateLimit: {
      limit: evaluation.context.rateLimit.limit,
      remaining: evaluation.context.rateLimit.remaining,
      resetAt: evaluation.context.rateLimit.resetAt,
      retryAfterSeconds: evaluation.context.rateLimit.retryAfterSeconds,
      routeClass: evaluation.context.routeClass,
      windowMs: evaluation.context.windowMs,
    },
  });
}
