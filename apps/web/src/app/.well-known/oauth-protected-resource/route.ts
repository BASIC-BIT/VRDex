import { oauthIssuerUrl, oauthMcpResourceUri } from "@/lib/server/oauth-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const issuer = oauthIssuerUrl(request);
  const resource = oauthMcpResourceUri(request);

  return Response.json(
    {
      resource,
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_documentation: `${issuer}/developers/api`,
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
