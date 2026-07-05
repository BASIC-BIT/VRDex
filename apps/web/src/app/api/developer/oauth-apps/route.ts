import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@convex-generated-api";
import {
  createOAuthClientId,
  createOAuthClientSecretValue,
  hashOAuthClientSecretValue,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
} from "@vrdex/api-contracts";

import { apiProblemResponse } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function oauthClientSecretPepper() {
  const pepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret creation.");
  }

  return pepper;
}

function problem(status: 400 | 401 | 403 | 404 | 500, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

function createFailureResponse(error: unknown) {
  const detail = error instanceof Error ? error.message : "The OAuth app could not be created.";

  if (detail.includes("not found")) {
    return problem(404, "Community profile not found", detail);
  }

  if (detail.includes("permission") || detail.includes("Only the community owner")) {
    return problem(403, "OAuth app owner is not manageable", detail);
  }

  return problem(400, "Invalid OAuth app request", detail);
}

function requestBodyValue(body: unknown) {
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export async function POST(request: Request) {
  const authToken = await convexAuthNextjsToken();

  if (authToken === undefined) {
    return problem(401, "Sign in required", "A signed-in VRDex account is required to create OAuth apps.");
  }

  let body: Record<string, unknown>;

  try {
    body = requestBodyValue(await request.json());
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when creating an OAuth app.");
  }

  let clientType: ReturnType<typeof normalizeOAuthClientType>;
  let displayName: string;
  let description: string | undefined;
  let docsUrl: string | undefined;
  let privacyUrl: string | undefined;
  let ownerCommunitySlug: string | undefined;
  let redirectUris: string[];
  let allowedScopes: ReturnType<typeof normalizeOAuthScopes>;
  let allowedGrants: ReturnType<typeof normalizeOAuthGrantTypes>;

  try {
    clientType = normalizeOAuthClientType(String(body.clientType ?? "public"));
    displayName = normalizeOAuthApplicationName(String(body.displayName ?? ""));
    description = normalizeOAuthApplicationDescription(optionalString(body.description));
    docsUrl = normalizeOAuthOptionalUrl(optionalString(body.docsUrl), "Docs URL");
    privacyUrl = normalizeOAuthOptionalUrl(optionalString(body.privacyUrl), "Privacy URL");
    ownerCommunitySlug = optionalString(body.ownerCommunitySlug);
    redirectUris = normalizeOAuthRedirectUris(stringList(body.redirectUris));
    allowedScopes = normalizeOAuthScopes(stringList(body.allowedScopes));
    allowedGrants = normalizeOAuthGrantTypes(stringList(body.allowedGrants), clientType);
  } catch (error) {
    return problem(
      400,
      "Invalid OAuth app request",
      error instanceof Error ? error.message : "The OAuth app request is invalid.",
    );
  }

  const clientId = createOAuthClientId();
  const clientSecret = clientType === "confidential" ? createOAuthClientSecretValue() : undefined;
  let verifierHash: string | undefined;

  try {
    verifierHash =
      clientSecret === undefined
        ? undefined
        : await hashOAuthClientSecretValue(clientSecret.secretValue, oauthClientSecretPepper());
  } catch {
    return problem(
      500,
      "OAuth app creation is unavailable",
      "The server is not configured to create OAuth client secrets.",
    );
  }

  const convex = convexHttpClient();

  convex.setAuth(authToken);

  let application: unknown;

  try {
    application = await convex.mutation(api.oauthApps.createPersonalApplication, {
      clientId,
      clientType,
      displayName,
      redirectUris,
      allowedGrants,
      allowedScopes,
      ...(description === undefined ? {} : { description }),
      ...(docsUrl === undefined ? {} : { docsUrl }),
      ...(privacyUrl === undefined ? {} : { privacyUrl }),
      ...(ownerCommunitySlug === undefined ? {} : { ownerCommunitySlug }),
      ...(clientSecret === undefined ? {} : { clientSecretPrefix: clientSecret.secretPrefix }),
      ...(verifierHash === undefined ? {} : { verifierHash }),
    });
  } catch (error) {
    return createFailureResponse(error);
  }

  return Response.json(
    {
      application,
      ...(clientSecret === undefined ? {} : { clientSecretValue: clientSecret.secretValue }),
    },
    {
      headers: {
        "cache-control": "private, no-store",
      },
    },
  );
}
