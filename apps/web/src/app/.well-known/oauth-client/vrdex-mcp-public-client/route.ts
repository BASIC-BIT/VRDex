import { hostedMcpReadScopes } from "@/lib/server/hosted-mcp-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  /**
   * Reads only, deliberately, even though every write scope is now grantable.
   *
   * This is a shared no-secret client that exists to make hosted CIMD smoke
   * tests reproducible, and anyone who can catch its loopback callback can use
   * it. Advertising write scopes here would put a write consent screen in front
   * of every client that picks up VRDex's own document rather than registering
   * its own. A client that wants to write registers through DCR, where the
   * grant is attributable to it.
   */
  const scopes = [...hostedMcpReadScopes, "public:read"];

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
