import { ApiMeEventsResponseSchema } from "@vrdex/api-contracts";
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

  const evaluation = await evaluateApiUserReadRequest(request, { requiredScope: "events:read" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  const url = new URL(request.url);
  const events = await convexAdminHttpClient().query(internal.events.listCommunityManagedEventsForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    limit: parseBoundedLimit(url.searchParams, { fallback: 50, max: 100 }),
  });

  return apiJson(ApiMeEventsResponseSchema, { events });
}
