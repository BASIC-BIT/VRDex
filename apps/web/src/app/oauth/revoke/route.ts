import { internal } from "@convex-generated-api";

import { convexAdminHttpClient } from "@/lib/server/convex-http";
import { oauthRateLimitResponse } from "@/lib/server/oauth-route-rate-limit";
import { oauthRevokeResponse } from "@/lib/server/oauth-revoke";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = await oauthRateLimitResponse(request, "oauth_token");

  if (rateLimited !== null) {
    return rateLimited;
  }

  const convex = convexAdminHttpClient();

  return await oauthRevokeResponse(request, {
    mutations: {
      revokeClientAccessToken: async (input) => {
        return await convex.mutation(internal.oauthApps.revokeClientAccessToken, input);
      },
      revokeClientRefreshToken: async (input) => {
        return await convex.mutation(internal.oauthApps.revokeClientRefreshToken, input);
      },
    },
  });
}
