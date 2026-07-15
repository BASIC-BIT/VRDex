import { internal } from "@convex-generated-api";

import { convexAdminHttpClient } from "@/lib/server/convex-http";
import { issueClientCredentialsAccessToken } from "@/lib/server/oauth-dynamic-client-persistence";
import { oauthRateLimitResponse } from "@/lib/server/oauth-route-rate-limit";
import { oauthTokenResponse } from "@/lib/server/oauth-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = await oauthRateLimitResponse(request, "oauth_token");

  if (rateLimited !== null) {
    return rateLimited;
  }

  return await oauthTokenResponse(request, {
    mutations: {
      consumeAuthorizationCode: (input) =>
        convexAdminHttpClient().mutation(internal.oauthApps.consumeAuthorizationCode, input),
      issueClientCredentialsAccessToken,
      rotateRefreshToken: (input) =>
        convexAdminHttpClient().mutation(internal.oauthApps.rotateRefreshToken, input),
    },
  });
}
