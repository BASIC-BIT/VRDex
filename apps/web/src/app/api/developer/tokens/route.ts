import { convexAuthToken } from "@/lib/server/auth";
import { api } from "@convex-generated-api";
import {
  createApiTokenValue,
  hashApiTokenValue,
  normalizeApiTokenLabel,
  normalizeApiTokenScopes,
} from "@vrdex/api-contracts";

import { apiProblemResponse } from "@/lib/server/api-v0";
import { temporalTokenScopeEligibilityProblem } from "@/lib/server/api-token-errors";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
  unauthenticatedResponse,
  isUnauthenticatedError,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

function apiTokenPepper() {
  const pepper = process.env.VRDEX_API_TOKEN_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_API_TOKEN_PEPPER is required for API token creation.");
  }

  return pepper;
}

function problem(status: 400 | 401 | 403 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

function requestBodyValue(body: unknown) {
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function optionalExpiry(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Token expiry must be a timestamp in milliseconds.");
  }

  return value;
}

export async function POST(request: Request) {
  const authToken = await convexAuthToken();

  if (authToken === undefined) {
    return problem(401, "Sign in required", "A signed-in VRDex account is required to create API tokens.");
  }

  let body: Record<string, unknown>;

  try {
    body = requestBodyValue(await request.json());
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when creating an API token.");
  }

  let label: string;
  let scopes: ReturnType<typeof normalizeApiTokenScopes>;
  let expiresAt: number | undefined;

  try {
    label = normalizeApiTokenLabel(String(body.label ?? ""));
    scopes = normalizeApiTokenScopes(Array.isArray(body.scopes) ? body.scopes : undefined);
    expiresAt = optionalExpiry(body.expiresAt);
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

  const convex = convexHttpClient();

  convex.setAuth(authToken);

  try {
    const savedToken = await convex.mutation(api.apiTokens.createPersonalToken, {
      tokenPrefix: token.tokenPrefix,
      verifierHash,
      label,
      scopes,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });

    return Response.json(
      {
        token: savedToken,
        tokenValue: token.tokenValue,
      },
      {
        headers: {
          "cache-control": "private, no-store",
        },
      },
    );
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return unauthenticatedResponse("/developers/tokens");
    }


    const eligibility = temporalTokenScopeEligibilityProblem(error);
    if (eligibility !== null) {
      return problem(403, eligibility.title, eligibility.detail);
    }
    return problem(
      500,
      "API token creation is unavailable",
      "The server could not create this API token.",
    );
  }
}
