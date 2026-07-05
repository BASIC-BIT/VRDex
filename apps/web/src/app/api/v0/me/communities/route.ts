import { ApiMeCommunitiesResponseSchema } from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import { apiJson, parseBoundedLimit, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { evaluateApiUserReadRequest } from "@/lib/server/api-user-authority";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateApiUserReadRequest(request, { requiredScope: "community:read" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  const url = new URL(request.url);
  const communities = await convexAdminHttpClient().query(internal.profiles.listProfilesForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    profileType: "community",
    limit: parseBoundedLimit(url.searchParams, { fallback: 50, max: 100 }),
  });

  return apiJson(ApiMeCommunitiesResponseSchema, { communities });
}
