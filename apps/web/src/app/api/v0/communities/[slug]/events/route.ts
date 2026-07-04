import { PublicEventsResponseSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { apiJson, parseBoundedLimit, publicNotFoundResponse, rejectBearerTokenQuery } from "@/lib/server/api-v0";
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

  const url = new URL(request.url);
  const limit = parseBoundedLimit(url.searchParams, { fallback: 6, max: 24 });
  const { slug } = await context.params;
  const profile = await convexHttpClient().query(api.profiles.getPublicBySlug, {
    slug,
    profileType: "community",
    now: Date.now(),
  });

  if (profile === null) {
    return publicNotFoundResponse("Community profile");
  }

  return apiJson(PublicEventsResponseSchema, { events: profile.hostedEvents.slice(0, limit) });
}
