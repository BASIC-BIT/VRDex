import {
  getBearerTokenFromAuthorizationHeader,
  ApiProblemSchema,
  createBearerTokenQueryProblem,
  createPublicNotFoundProblem,
  hasBearerTokenInUrl,
  hashApiTokenValue,
  parseApiTokenValue,
  type ApiRouteClass,
  type ApiScope,
} from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { NextResponse } from "next/server";

import {
  checkApiRateLimit,
  clientIpForRequest,
  type ApiRateLimitIdentity,
} from "@/lib/server/api-rate-limit";
import { convexHttpClient } from "@/lib/server/convex-http";

type ApiResponseSchema = {
  parse: (value: unknown) => unknown;
};

export function rejectBearerTokenQuery(request: Request) {
  if (!hasBearerTokenInUrl(request.url)) {
    return null;
  }

  return apiProblemResponse(createBearerTokenQueryProblem());
}

function apiTokenPepper() {
  const pepper = process.env.VRDEX_API_TOKEN_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_API_TOKEN_PEPPER is required for API bearer token verification.");
  }

  return pepper;
}

function apiBearerProblem(status: 401 | 403 | 429 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

function invalidBearerTokenResponse() {
  return apiBearerProblem(
    401,
    "Invalid bearer token",
    "The supplied bearer token is malformed, expired, revoked, or unknown.",
  );
}

async function authenticateOptionalApiBearerToken(
  request: Request,
  options: {
    requiredScopes?: ApiScope[];
    routeClass?: ApiRouteClass;
  } = {},
) {
  const tokenValue = getBearerTokenFromAuthorizationHeader(request.headers.get("authorization"));

  if (tokenValue === null) {
    return {
      ok: true as const,
      identity: { kind: "ip", value: clientIpForRequest(request) } satisfies ApiRateLimitIdentity,
    };
  }

  const parsed = parseApiTokenValue(tokenValue);

  if (parsed === null) {
    return { ok: false as const, response: invalidBearerTokenResponse() };
  }

  let verifierHash: string;

  try {
    verifierHash = await hashApiTokenValue(tokenValue, apiTokenPepper());
  } catch {
    return {
      ok: false as const,
      response: apiBearerProblem(
        500,
        "API bearer token verification is unavailable",
        "The server is not configured to verify API bearer tokens.",
      ),
    };
  }

  const validation = await convexHttpClient().mutation(api.apiTokens.validateBearerTokenHash, {
    tokenPrefix: parsed.tokenPrefix,
    verifierHash,
    requiredScopes: options.requiredScopes ?? ["public:read"],
    routeClass: options.routeClass ?? "authenticated_public_read",
  });

  if (validation.ok) {
    return {
      ok: true as const,
      identity: { kind: "api_token", value: validation.tokenId } satisfies ApiRateLimitIdentity,
    };
  }

  if (validation.reason === "missing_scope") {
    return {
      ok: false as const,
      response: apiBearerProblem(
        403,
        "API token scope is insufficient",
        "The supplied bearer token does not include the required scope for this request.",
      ),
    };
  }

  return { ok: false as const, response: invalidBearerTokenResponse() };
}

export async function rejectInvalidOptionalApiBearerToken(
  request: Request,
  options: {
    requiredScopes?: ApiScope[];
    routeClass?: ApiRouteClass;
  } = {},
) {
  const authentication = await authenticateOptionalApiBearerToken(request, options);

  return authentication.ok ? null : authentication.response;
}

export async function rejectInvalidOrRateLimitedPublicApiRequest(
  request: Request,
  options: {
    requiredScopes?: ApiScope[];
    routeClass?: ApiRouteClass;
  } = {},
) {
  const authentication = await authenticateOptionalApiBearerToken(request, options);

  if (!authentication.ok) {
    return authentication.response;
  }

  const routeClass =
    authentication.identity.kind === "api_token"
      ? options.routeClass ?? "authenticated_public_read"
      : "anonymous_public_read";
  let rateLimit;

  try {
    rateLimit = await checkApiRateLimit({
      identity: authentication.identity,
      routeClass,
    });
  } catch {
    return apiBearerProblem(
      500,
      "API rate limiting is unavailable",
      "The server is not configured to evaluate API rate limits.",
    );
  }

  if (rateLimit.allowed) {
    return null;
  }

  const response = apiBearerProblem(
    429,
    "API rate limit exceeded",
    "This client exceeded the current rate limit for the requested API route class.",
  );

  response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
  response.headers.set("RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1_000)));

  return response;
}

export function apiJson(schema: ApiResponseSchema, value: unknown) {
  return NextResponse.json(schema.parse(value));
}

export function apiProblemResponse(problem: unknown) {
  const parsed = ApiProblemSchema.parse(problem);

  return NextResponse.json(parsed, { status: parsed.status });
}

export function publicNotFoundResponse(resourceName: string) {
  return apiProblemResponse(createPublicNotFoundProblem(resourceName));
}

export function parseBoundedLimit(searchParams: URLSearchParams, options: { fallback: number; max: number }) {
  const rawLimit = searchParams.get("limit");

  if (rawLimit === null || rawLimit.trim() === "") {
    return options.fallback;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit)) {
    return options.fallback;
  }

  return Math.max(1, Math.min(limit, options.max));
}
