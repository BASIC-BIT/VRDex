import { api } from "@convex-generated-api";

import { convexHttpClient } from "@/lib/server/convex-http";
import {
  oauthIssuerUrl,
  oauthSupportedResources,
  verifyOAuthAccessToken,
} from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function formData(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    throw new Error("OAuth revocation requests must use application/x-www-form-urlencoded.");
  }

  return await request.formData();
}

function emptyRevocationResponse() {
  return new Response(null, {
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache",
    },
    status: 200,
  });
}

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await formData(request);
  } catch {
    return emptyRevocationResponse();
  }

  const token = String(form.get("token") ?? "");

  if (!token) {
    return emptyRevocationResponse();
  }

  const issuer = oauthIssuerUrl(request);

  for (const audience of oauthSupportedResources(request)) {
    try {
      const claims = verifyOAuthAccessToken(token, { audience, issuer });

      await convexHttpClient().mutation(api.oauthApps.revokeClientAccessToken, {
        clientId: claims.client_id,
        tokenId: claims.jti,
      });
      break;
    } catch {
      // RFC 7009 intentionally keeps revocation responses indistinguishable.
    }
  }

  return emptyRevocationResponse();
}
