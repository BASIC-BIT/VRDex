import { PublicWorldSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { apiJson, publicNotFoundResponse, rejectBearerTokenQuery } from "@/lib/server/api-v0";
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

  const { slug } = await context.params;
  const world = await convexHttpClient().query(api.worlds.getPublicBySlug, { slug, now: Date.now() });

  if (world === null) {
    return publicNotFoundResponse("World");
  }

  return apiJson(PublicWorldSchema, world);
}
