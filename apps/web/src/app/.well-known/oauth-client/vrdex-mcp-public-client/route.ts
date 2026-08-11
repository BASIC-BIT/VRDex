import {
  hostedMcpReadScopes,
  hostedMcpWriteScopes,
} from "@/lib/server/hosted-mcp-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const scopes = [...hostedMcpReadScopes, "public:read", ...hostedMcpWriteScopes];

  return Response.json(
    {
      client_id: new URL(request.url).toString(),
      client_name: "VRDex MCP Public Client",
      redirect_uris: ["http://localhost:8765/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: scopes.join(" "),
      software_id: "vrdex-mcp-public-client",
      software_version: "0.0.0",
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
      },
    },
  );
}
