import { parseSearchQueryParams, PublicSearchResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import {
  apiJson,
  publicDataUnavailableResponse,
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";
import { publicSearchBackendFilters } from "@/lib/server/public-search-query";

export const dynamic = "force-dynamic";

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
  const { limit, q: query, type } = parseSearchQueryParams(url.searchParams);

  if (query.length === 0) {
    return apiJson(PublicSearchResponseSchema, { query, type, results: [] });
  }

  const results = await (async () => {
    try {
      return await convexHttpClient().query(api.search.searchUniversal, {
        query,
        limit,
        ...publicSearchBackendFilters(type),
      });
    } catch {
      return null;
    }
  })();

  if (results === null) {
    return publicDataUnavailableResponse("Public search");
  }

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
