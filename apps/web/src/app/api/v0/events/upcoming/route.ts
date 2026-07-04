import { PublicEventsResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { apiJson, parseBoundedLimit, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const url = new URL(request.url);
  const limit = parseBoundedLimit(url.searchParams, { fallback: 8, max: 24 });
  const discovery = await convexHttpClient().query(api.search.listDiscovery, { now: Date.now() });

  return apiJson(PublicEventsResponseSchema, {
    events: discovery.upcomingEvents.slice(0, limit),
  });
}
