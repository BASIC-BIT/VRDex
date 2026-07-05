import { DeveloperTokensResponseSchema } from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import {
  apiJson,
  parseBoundedLimit,
  rejectBearerTokenQuery,
} from "@/lib/server/api-v0";
import { evaluateDeveloperReadRequest } from "@/lib/server/api-developer-read";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function parseIncludeRevoked(searchParams: URLSearchParams) {
  return searchParams.get("includeRevoked") === "true";
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
  const tokens = await convexAdminHttpClient().query(internal.apiTokens.listDeveloperTokensForApiOwner, {
    ownerUserId: evaluation.ownerUserId as Id<"users">,
    includeRevoked: parseIncludeRevoked(url.searchParams),
    limit: parseBoundedLimit(url.searchParams, { fallback: 50, max: 100 }),
  });

  return apiJson(DeveloperTokensResponseSchema, { tokens });
}
