import {
  createOAuthClientSecretValue,
  DeveloperOAuthAppSecretCreateRequestSchema,
  DeveloperOAuthAppSecretCreateResponseSchema,
  hashOAuthClientSecretValue,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";

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

function oauthClientSecretPepper() {
  const pepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER?.trim();

  if (!pepper) {
    throw new Error("VRDEX_OAUTH_CLIENT_SECRET_PEPPER is required for OAuth client secret creation.");
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

export async function POST(request: Request, context: RouteContext) {
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
    return problem(400, "Invalid JSON", "Send a JSON object when creating an OAuth app secret.");
  }

  const body = DeveloperOAuthAppSecretCreateRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid OAuth app secret request",
      body.error.issues[0]?.message ?? "The OAuth app secret request is invalid.",
    );
  }

  const clientSecret = createOAuthClientSecretValue();
  let verifierHash: string;

  try {
    verifierHash = await hashOAuthClientSecretValue(clientSecret.secretValue, oauthClientSecretPepper());
  } catch {
    return problem(
      500,
      "OAuth app secret creation is unavailable",
      "The server is not configured to create OAuth client secrets.",
    );
  }

  const { clientId } = await context.params;
  const result = await convexAdminHttpClient().mutation(
    internal.oauthApps.createDeveloperApplicationSecretForApiOwner,
    {
      ownerUserId: evaluation.ownerUserId as Id<"users">,
      clientId,
      secretPrefix: clientSecret.secretPrefix,
      verifierHash,
      ...(body.data.label === undefined ? {} : { label: body.data.label }),
    },
  );

  if (!result.ok) {
    if (result.reason === "not_confidential") {
      return problem(
        400,
        "OAuth app has no client secrets",
        "Only confidential OAuth applications can create client secrets.",
      );
    }

    return publicNotFoundResponse("OAuth application");
  }

  const response = apiJson(DeveloperOAuthAppSecretCreateResponseSchema, {
    application: result.application,
    clientSecretValue: clientSecret.secretValue,
  });

  response.headers.set("cache-control", "private, no-store");

  return response;
}
