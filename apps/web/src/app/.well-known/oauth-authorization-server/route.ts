import { apiScopes } from "@vrdex/api-contracts";

import { oauthIssuerUrl, oauthSupportedResources } from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const issuer = oauthIssuerUrl(request);

  return Response.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      jwks_uri: `${issuer}/oauth/jwks.json`,
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      scopes_supported: apiScopes,
      resource_indicators_supported: true,
      client_id_metadata_document_supported: true,
      protected_resources: oauthSupportedResources(request),
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
