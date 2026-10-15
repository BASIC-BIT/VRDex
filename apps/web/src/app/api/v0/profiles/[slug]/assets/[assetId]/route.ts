import { PublicProfileMediaDetailsSchema } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { apiJson, publicNotFoundResponse, publicDataUnavailableResponse, rejectBearerTokenQuery, rejectInvalidOrRateLimitedPublicApiRequest } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string; assetId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) return rejected;
  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request);
  if (rejectedBearerToken !== null) return rejectedBearerToken;
  const { slug, assetId } = await context.params;
  try {
    const result = await convexHttpClient().query(api.profileAssets.getPublicAssetDetails, { slug, assetId });
    if (result === null) return publicNotFoundResponse("Profile");
    const response = apiJson(PublicProfileMediaDetailsSchema, result);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return publicDataUnavailableResponse("Profile"); }
}

