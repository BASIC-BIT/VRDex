import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchMcpOAuthClientCredentialsToken,
  hostedMcpResourceUrl,
  mcpOAuthClientCredentialsFromEnv,
  oauthTokenEndpointFromHostedUrl,
} from "../../scripts/mcp-oauth-client-credentials";

describe("MCP OAuth client credentials helper", () => {
  it("normalizes hosted MCP resource and token endpoint URLs", () => {
    assert.equal(hostedMcpResourceUrl("https://staging.vrdex.net"), "https://staging.vrdex.net/mcp");
    assert.equal(hostedMcpResourceUrl("https://staging.vrdex.net/mcp/"), "https://staging.vrdex.net/mcp");
    assert.equal(oauthTokenEndpointFromHostedUrl("https://staging.vrdex.net/mcp"), "https://staging.vrdex.net/oauth/token");
  });

  it("prefers client-specific OAuth client credentials and falls back to generic MCP env", () => {
    assert.deepEqual(
      mcpOAuthClientCredentialsFromEnv(
        {
          VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID: "client-specific-id",
          VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET: "client-specific-secret",
          VRDEX_MCP_OAUTH_CLIENT_ID: "generic-id",
          VRDEX_MCP_OAUTH_CLIENT_SECRET: "generic-secret",
        },
        "CLAUDE_CODE",
      ),
      {
        clientId: "client-specific-id",
        clientSecret: "client-specific-secret",
      },
    );

    assert.deepEqual(
      mcpOAuthClientCredentialsFromEnv(
        {
          VRDEX_MCP_OAUTH_CLIENT_ID: "generic-id",
          VRDEX_MCP_OAUTH_CLIENT_SECRET: "generic-secret",
        },
        "MCP_INSPECTOR",
      ),
      {
        clientId: "generic-id",
        clientSecret: "generic-secret",
      },
    );
  });

  it("requests a client-credentials token for the hosted MCP resource without printing secrets", async () => {
    let tokenEndpoint = "";
    let requestBody = "";
    let authorization = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      tokenEndpoint = String(input);
      requestBody = String(init?.body);
      authorization = new Headers(init?.headers).get("authorization") ?? "";

      return Response.json({
        access_token: "mcp-access-token",
        expires_in: 3600,
        scope: "public:read mcp:read",
        token_type: "Bearer",
      });
    };

    const result = await fetchMcpOAuthClientCredentialsToken({
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
      hostedUrl: "https://staging.vrdex.net/mcp",
    });

    assert.equal(result.accessToken, "mcp-access-token");
    assert.equal(result.expiresIn, 3600);
    assert.equal(tokenEndpoint, "https://staging.vrdex.net/oauth/token");
    assert.equal(authorization, `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);

    const params = new URLSearchParams(requestBody);

    assert.equal(params.get("grant_type"), "client_credentials");
    assert.equal(params.get("resource"), "https://staging.vrdex.net/mcp");
    assert.equal(params.get("scope"), "public:read mcp:read");
  });

  it("reports token failures without leaking the client secret", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json(
        {
          error: "invalid_client",
          error_description: "Client authentication failed.",
        },
        { status: 401 },
      );

    await assert.rejects(
      () =>
        fetchMcpOAuthClientCredentialsToken({
          clientId: "client-id",
          clientSecret: "do-not-print-me",
          fetchImpl,
          hostedUrl: "https://staging.vrdex.net/mcp",
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 401/);
        assert.doesNotMatch(error.message, /do-not-print-me/);

        return true;
      },
    );
  });
});
