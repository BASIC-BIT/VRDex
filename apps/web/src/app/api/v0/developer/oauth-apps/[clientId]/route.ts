import { DeveloperOAuthAppResponseSchema } from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
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
