import { PublicSearchResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import {
  apiJson,
  parseBoundedLimit,
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

const searchTypes = new Set(["all", "person", "community", "profile", "world", "event"]);

function parseSearchType(value: string | null) {
  return value !== null && searchTypes.has(value) ? value : "all";
}

function entityTypeForSearchType(type: string) {
  if (type === "world" || type === "event") {
    return type;
  }

  if (type === "person" || type === "community" || type === "profile") {
    return "profile";
  }

  return undefined;
}

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request);
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const type = parseSearchType(url.searchParams.get("type"));
  const limit = parseBoundedLimit(url.searchParams, { fallback: 24, max: 50 });

  if (query.length === 0) {
    return apiJson(PublicSearchResponseSchema, { query, type, results: [] });
  }

  const entityType = entityTypeForSearchType(type);
  const results = await convexHttpClient().query(api.search.searchUniversal, {
    query,
    limit,
    ...(entityType === undefined ? {} : { entityType }),
  });
  const filteredResults =
    type === "person" || type === "community"
      ? results.filter((result) => result.profileType === type)
      : results;

  return apiJson(PublicSearchResponseSchema, {
    query,
    type,
    results: filteredResults.slice(0, limit),
  });
}
