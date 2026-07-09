import {
  DeveloperOAuthAppResponseSchema,
  DeveloperOAuthAppUpdateRequestSchema,
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthScopes,
  type OAuthGrantType,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
  apiProblemResponse,
  publicNotFoundResponse,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";
import { evaluateDeveloperWriteRequest } from "@/lib/server/api-developer-read";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

type OAuthAppUpdate = {
  allowedGrants?: OAuthGrantType[];
  allowedScopes?: ReturnType<typeof normalizeOAuthScopes>;
  description?: string | null;
  displayName?: string;
  docsUrl?: string | null;
  logoUrl?: string | null;
  privacyUrl?: string | null;
  redirectUris?: string[];
  termsUrl?: string | null;
};

function problem(status: 400, title: string, detail: string) {
  return apiProblemResponse({
    type: "about:blank",
    title,
    status,
    detail,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
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
    return problem(400, "Invalid JSON", "Send a JSON object when updating an OAuth app.");
  }

  const body = DeveloperOAuthAppUpdateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid OAuth app update",
      body.error.issues[0]?.message ?? "The OAuth app update request is invalid.",
    );
  }

  const data = body.data;
  if (Object.keys(data).length === 0) {
    return problem(400, "Invalid OAuth app update", "Send at least one OAuth app field to update.");
  }

  const updates: OAuthAppUpdate = {};

  try {
    if ("displayName" in data) {
      updates.displayName = normalizeOAuthApplicationName(data.displayName ?? "");
    }

    if ("description" in data) {
      updates.description =
        data.description === null ? null : normalizeOAuthApplicationDescription(data.description) ?? null;
    }

    if ("logoUrl" in data) {
      updates.logoUrl = data.logoUrl === null ? null : normalizeOAuthOptionalUrl(data.logoUrl, "Logo URL") ?? null;
    }

    if ("docsUrl" in data) {
      updates.docsUrl = data.docsUrl === null ? null : normalizeOAuthOptionalUrl(data.docsUrl, "Docs URL") ?? null;
    }

    if ("privacyUrl" in data) {
      updates.privacyUrl =
        data.privacyUrl === null ? null : normalizeOAuthOptionalUrl(data.privacyUrl, "Privacy URL") ?? null;
    }

    if ("termsUrl" in data) {
      updates.termsUrl = data.termsUrl === null ? null : normalizeOAuthOptionalUrl(data.termsUrl, "Terms URL") ?? null;
    }

    if ("redirectUris" in data) {
      updates.redirectUris = normalizeOAuthRedirectUris(data.redirectUris ?? []);
    }

    if ("allowedScopes" in data) {
      updates.allowedScopes = normalizeOAuthScopes(data.allowedScopes);
    }

    if ("allowedGrants" in data && data.allowedGrants !== undefined) {
      updates.allowedGrants = data.allowedGrants;
    }
  } catch (error) {
    return problem(
      400,
      "Invalid OAuth app update",
      error instanceof Error ? error.message : "The OAuth app update request is invalid.",
    );
  }

  const { clientId } = await context.params;
  const result = await convexAdminHttpClient().mutation(internal.oauthApps.updateDeveloperApplicationForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    clientId,
    ...updates,
  });

  if (!result.ok) {
    if (result.reason === "invalid_update") {
      return problem(400, "Invalid OAuth app update", result.detail);
    }

    return publicNotFoundResponse("OAuth application");
  }

  return apiJson(DeveloperOAuthAppResponseSchema, { application: result.application });
}

export async function DELETE(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateDeveloperWriteRequest(request);
  if (!evaluation.ok) {
    return evaluation.response;
  }

  const { clientId } = await context.params;
  const result = await convexAdminHttpClient().mutation(
    internal.oauthApps.revokeDeveloperApplicationForApiOwner,
    {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      clientId,
    },
  );

  if (!result.ok) {
    return publicNotFoundResponse("OAuth application");
  }

  return apiJson(DeveloperOAuthAppResponseSchema, { application: result.application });
}
