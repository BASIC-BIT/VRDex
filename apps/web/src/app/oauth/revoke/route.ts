import { internal } from "@convex-generated-api";

import { convexAdminHttpClient } from "@/lib/server/convex-http";
import { oauthRevokeResponse } from "@/lib/server/oauth-revoke";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
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
