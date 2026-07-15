import { PublicProfileLogosResponseSchema } from "@vrdex/api-contracts";
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

  const { slug } = await context.params;
  const result = await convexHttpClient().query(api.profileAssets.listPublicBySlug, { slug });

  if (result === null) {
    return publicNotFoundResponse("Profile");
  }

  return apiJson(PublicProfileLogosResponseSchema, {
    profileType: result.profileType,
    slug: result.slug,
    displayName: result.displayName,
    primaryLogo: result.mediaKit.primaryLogo,
    additionalLogos: result.mediaKit.additionalLogos,
    logos: result.mediaKit.logos,
    logoZipUrl: result.mediaKit.logoZipUrl,
  });
}
