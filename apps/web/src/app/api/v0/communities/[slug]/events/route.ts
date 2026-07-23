import { parsePublicEventsListQueryParams, PublicEventsResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import {
  apiJson,
  publicNotFoundResponse,
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request);
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  const url = new URL(request.url);
  const { limit } = parsePublicEventsListQueryParams(url.searchParams, 6);
  const { slug } = await context.params;
  const now = Date.now();
  const profile = await convexHttpClient().query(api.profiles.getPublicBySlug, {
    slug,
    profileType: "community",
    now,
    includeTelemetry: false,
  });

  if (profile === null) {
    return publicNotFoundResponse("Community profile");
  }

  const events = await convexHttpClient().query(api.events.listHostedByCommunitySlug, {
    communitySlug: slug,
    now,
    limit,
  });

  return apiJson(PublicEventsResponseSchema, { events });
}
