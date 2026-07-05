import {
  createOAuthClientId,
  createOAuthClientSecretValue,
  DeveloperOAuthAppCreateRequestSchema,
  DeveloperOAuthAppCreateResponseSchema,
  DeveloperOAuthAppsResponseSchema,
  hashOAuthClientSecretValue,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
  apiProblemResponse,
  parseBoundedLimit,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";
import {
  evaluateDeveloperReadRequest,
  evaluateDeveloperWriteRequest,
} from "@/lib/server/api-developer-read";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function parseIncludeRevoked(searchParams: URLSearchParams) {
  return searchParams.get("includeRevoked") === "true";
}

function oauthClientSecretPepper() {
  const pepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret creation.");
  }

  return pepper;
}

function problem(status: 400 | 403 | 404 | 500, title: string, detail: string) {
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
  const applications = await convexAdminHttpClient().query(
    internal.oauthApps.listDeveloperApplicationsForApiOwner,
    {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      includeRevoked: parseIncludeRevoked(url.searchParams),
      limit: parseBoundedLimit(url.searchParams, { fallback: 50, max: 100 }),
    },
  );

  return apiJson(DeveloperOAuthAppsResponseSchema, { applications });
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
    return problem(400, "Invalid JSON", "Send a JSON object when creating an OAuth app.");
  }

  const body = DeveloperOAuthAppCreateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid OAuth app request",
      body.error.issues[0]?.message ?? "The OAuth app request is invalid.",
    );
  }

  let clientType: ReturnType<typeof normalizeOAuthClientType>;
  let displayName: string;
  let description: string | undefined;
  let logoUrl: string | undefined;
  let docsUrl: string | undefined;
  let privacyUrl: string | undefined;
  let termsUrl: string | undefined;
  let redirectUris: string[];
  let allowedScopes: ReturnType<typeof normalizeOAuthScopes>;
  let allowedGrants: ReturnType<typeof normalizeOAuthGrantTypes>;

  try {
    clientType = normalizeOAuthClientType(body.data.clientType ?? "public");
    displayName = normalizeOAuthApplicationName(body.data.displayName);
    description = normalizeOAuthApplicationDescription(body.data.description);
    logoUrl = normalizeOAuthOptionalUrl(body.data.logoUrl, "Logo URL");
    docsUrl = normalizeOAuthOptionalUrl(body.data.docsUrl, "Docs URL");
    privacyUrl = normalizeOAuthOptionalUrl(body.data.privacyUrl, "Privacy URL");
    termsUrl = normalizeOAuthOptionalUrl(body.data.termsUrl, "Terms URL");
    redirectUris = normalizeOAuthRedirectUris(body.data.redirectUris);
    allowedScopes = normalizeOAuthScopes(body.data.allowedScopes);
    allowedGrants = normalizeOAuthGrantTypes(body.data.allowedGrants, clientType);
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

  let application: unknown;

  try {
    application = await convexAdminHttpClient().mutation(internal.oauthApps.createDeveloperApplicationForApiOwner, {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      clientId,
      clientType,
      displayName,
      redirectUris,
      allowedGrants,
      allowedScopes,
      ...(description === undefined ? {} : { description }),
      ...(logoUrl === undefined ? {} : { logoUrl }),
      ...(docsUrl === undefined ? {} : { docsUrl }),
      ...(privacyUrl === undefined ? {} : { privacyUrl }),
      ...(termsUrl === undefined ? {} : { termsUrl }),
      ...(body.data.ownerCommunitySlug === undefined ? {} : { ownerCommunitySlug: body.data.ownerCommunitySlug }),
      ...(clientSecret === undefined ? {} : { clientSecretPrefix: clientSecret.secretPrefix }),
      ...(verifierHash === undefined ? {} : { verifierHash }),
    });
  } catch (error) {
    return createFailureResponse(error);
  }

  const response = apiJson(DeveloperOAuthAppCreateResponseSchema, {
    application,
    ...(clientSecret === undefined ? {} : { clientSecretValue: clientSecret.secretValue }),
  });

  response.headers.set("cache-control", "private, no-store");

  return response;
}
