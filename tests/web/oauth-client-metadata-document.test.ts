import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchOAuthClientMetadataDocument } from "../../apps/web/src/lib/server/oauth-client-metadata-document";

const clientId = "https://client.example.test/oauth/client.json?app=vrdex";

describe("OAuth client metadata documents", () => {
  it("fetches and normalizes constrained public MCP client metadata", async () => {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const metadata = await fetchOAuthClientMetadataDocument(clientId, {
      fetcher: async (input, init) => {
        requests.push({ input, init });

        return Response.json({
          client_id: clientId,
          client_name: "VRDex Test Client",
          client_uri: "https://client.example.test",
          redirect_uris: ["http://localhost:8765/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "mcp:read public:read",
        });
      },
      resolveHostname: async () => [{ address: "93.184.216.34" }],
    });

    assert.equal(requests[0]?.input, clientId);
    assert.equal(requests[0]?.init?.redirect, "manual");
    assert.deepEqual(metadata, {
      allowedScopes: ["mcp:read", "public:read"],
      clientId,
      clientName: "VRDex Test Client",
      clientType: "public",
      clientUri: "https://client.example.test/",
      contacts: [],
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["http://localhost:8765/callback"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
    });
  });

  it("rejects metadata documents that do not exactly match the client id URL", async () => {
    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        fetcher: async () =>
          Response.json({
            client_id: "https://client.example.test/oauth/other-client.json",
            client_name: "Wrong Client",
            redirect_uris: ["http://localhost:8765/callback"],
          }),
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      }),
      /client_id must match/,
    );
  });

  it("rejects special-use address resolution and oversized metadata", async () => {
    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        fetcher: async () => Response.json({}),
        resolveHostname: async () => [{ address: "127.0.0.1" }],
      }),
      /public address/,
    );

    await assert.rejects(
      fetchOAuthClientMetadataDocument(clientId, {
        fetcher: async () => new Response(JSON.stringify({ padding: "x".repeat(6 * 1024) })),
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      }),
      /too large/,
    );
  });
});
