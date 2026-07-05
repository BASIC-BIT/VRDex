import { DeveloperTokenResponseSchema } from "@vrdex/api-contracts";
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
    tokenId: string;
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

  const { tokenId } = await context.params;
  const result = await convexAdminHttpClient().mutation(internal.apiTokens.revokeDeveloperTokenForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    tokenId: tokenId as Id<"apiTokens">,
  });

  if (!result.ok) {
    return publicNotFoundResponse("API token");
  }

  return apiJson(DeveloperTokenResponseSchema, { token: result.token });
}
