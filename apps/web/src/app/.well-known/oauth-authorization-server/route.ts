import { apiScopes } from "@vrdex/api-contracts";

import { oauthIssuerUrl, oauthMcpResourceUri } from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const issuer = oauthIssuerUrl(request);

  return Response.json(
    {
      issuer,
      token_endpoint: `${issuer}/oauth/token`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      jwks_uri: `${issuer}/oauth/jwks.json`,
      grant_types_supported: ["client_credentials"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      scopes_supported: apiScopes,
      resource_indicators_supported: true,
      protected_resources: [issuer, oauthMcpResourceUri(request)],
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
