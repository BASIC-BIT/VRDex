import { internal } from "@convex-generated-api";

import { convexAdminHttpClient } from "@/lib/server/convex-http";
import { oauthRateLimitResponse } from "@/lib/server/oauth-route-rate-limit";
import { oauthTokenResponse } from "@/lib/server/oauth-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = await oauthRateLimitResponse(request, "oauth_token");

  if (rateLimited !== null) {
    return rateLimited;
  }

  const convex = convexAdminHttpClient();

  return await oauthTokenResponse(request, {
    mutations: {
      consumeAuthorizationCode: (input) => convex.mutation(internal.oauthApps.consumeAuthorizationCode, input),
      issueClientCredentialsAccessToken: (input) => convex.mutation(internal.oauthApps.issueClientCredentialsAccessToken, input),
      rotateRefreshToken: (input) => convex.mutation(internal.oauthApps.rotateRefreshToken, input),
    },
  });
}
