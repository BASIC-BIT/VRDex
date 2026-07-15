import { parsePublicEventsListQueryParams, PublicEventsResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import {
  apiJson,
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

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
  const { limit } = parsePublicEventsListQueryParams(url.searchParams);
  const events = await convexHttpClient().query(api.search.listUpcomingEvents, { now: Date.now(), limit });

  return apiJson(PublicEventsResponseSchema, {
    events,
  });
}
