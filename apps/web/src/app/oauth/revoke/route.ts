import { api } from "@convex-generated-api";

import { convexHttpClient } from "@/lib/server/convex-http";
import { oauthRevokeResponse } from "@/lib/server/oauth-revoke";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const convex = convexHttpClient();

  return await oauthRevokeResponse(request, {
    mutations: {
      revokeClientAccessToken: async (input) => {
        return await convex.mutation(api.oauthApps.revokeClientAccessToken, input);
      },
      revokeClientRefreshToken: async (input) => {
        return await convex.mutation(api.oauthApps.revokeClientRefreshToken, input);
      },
    },
  });
}
