import { PublicClaimStatusResponseSchema, TrustLabelSchema, type z } from "@vrdex/api-contracts";
import { api } from "@convex-generated-api";
import { apiJson, publicNotFoundResponse, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

type TrustLabel = z.infer<typeof TrustLabelSchema>;

function claimStateForTrustLabel(trustLabel: TrustLabel) {
  if (trustLabel === "claimed_verified" || trustLabel === "claimed_unverified") {
    return trustLabel;
  }

  return "unclaimed";
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const { slug } = await context.params;
  const profile = await convexHttpClient().query(api.profiles.getPublicBySlug, { slug, now: Date.now() });

  if (profile === null) {
    return publicNotFoundResponse("Profile");
  }

  return apiJson(PublicClaimStatusResponseSchema, {
    profileType: profile.profileType,
    slug: profile.slug,
    displayName: profile.displayName,
    trustLabel: profile.trustLabel,
    claimState: claimStateForTrustLabel(profile.trustLabel),
  });
}
