import { api } from "@convex-generated-api";

import { convexHttpClient } from "@/lib/server/convex-http";
import { oauthTokenResponse } from "@/lib/server/oauth-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const convex = convexHttpClient();

  return await oauthTokenResponse(request, {
    mutations: {
      consumeAuthorizationCode: (input) => convex.mutation(api.oauthApps.consumeAuthorizationCode, input),
      issueClientCredentialsAccessToken: (input) => convex.mutation(api.oauthApps.issueClientCredentialsAccessToken, input),
      rotateRefreshToken: (input) => convex.mutation(api.oauthApps.rotateRefreshToken, input),
    },
  });
}
