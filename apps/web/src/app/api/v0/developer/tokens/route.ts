import {
  createApiTokenValue,
  DeveloperTokenCreateRequestSchema,
  DeveloperTokenCreateResponseSchema,
  DeveloperTokensResponseSchema,
  hashApiTokenValue,
  normalizeApiTokenLabel,
  normalizeApiTokenScopes,
  parseDeveloperCredentialListQueryParams,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
  apiProblemResponse,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";
import {
  evaluateDeveloperReadRequest,
  evaluateDeveloperWriteRequest,
} from "@/lib/server/api-developer-read";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function apiTokenPepper() {
  const pepper = process.env.VRDEX_API_TOKEN_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_API_TOKEN_PEPPER is required for API token creation.");
  }

  return pepper;
}

function problem(status: 400 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateDeveloperReadRequest(request);
  if (!evaluation.ok) {
    return evaluation.response;
  }

  const url = new URL(request.url);
  const { includeRevoked, limit } = parseDeveloperCredentialListQueryParams(url.searchParams);
  const tokens = await convexAdminHttpClient().query(internal.apiTokens.listDeveloperTokensForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    includeRevoked,
    limit,
  });

  return apiJson(DeveloperTokensResponseSchema, { tokens });
}

export async function POST(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateDeveloperWriteRequest(request);
  if (!evaluation.ok) {
    return evaluation.response;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when creating an API token.");
  }

  const body = DeveloperTokenCreateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid API token request",
      body.error.issues[0]?.message ?? "The API token request is invalid.",
    );
  }

  let label: string;
  let scopes: ReturnType<typeof normalizeApiTokenScopes>;
  let expiresAt: number | undefined;

  try {
    label = normalizeApiTokenLabel(body.data.label);
    scopes = normalizeApiTokenScopes(body.data.scopes);
    expiresAt = body.data.expiresAt;
  } catch (error) {
    return problem(
      400,
      "Invalid API token request",
      error instanceof Error ? error.message : "The API token request is invalid.",
    );
  }

  const token = createApiTokenValue();
  let verifierHash: string;

  try {
    verifierHash = await hashApiTokenValue(token.tokenValue, apiTokenPepper());
  } catch {
    return problem(
      500,
      "API token creation is unavailable",
      "The server is not configured to create API tokens.",
    );
  }

  const savedToken = await convexAdminHttpClient().mutation(internal.apiTokens.createDeveloperTokenForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    tokenPrefix: token.tokenPrefix,
    verifierHash,
    label,
    scopes,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });

  const response = apiJson(DeveloperTokenCreateResponseSchema, {
    token: savedToken,
    tokenValue: token.tokenValue,
  });

  response.headers.set("cache-control", "private, no-store");

  return response;
}
