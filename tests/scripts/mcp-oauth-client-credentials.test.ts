import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  fetchMcpOAuthClientCredentialsToken,
  hasAnyMcpOAuthClientCredentials,
  hostedMcpOAuthCredentialGenerationSourcesFromEnv,
  hostedMcpResourceUrl,
  mcpOAuthCredentialSourcesFromEnv,
  mcpOAuthClientCredentialsFromEnv,
  mcpOAuthClientCredentialsFromOptions,
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

  it("maps hosted smoke option names before checking credential presence", () => {
    const credentials = mcpOAuthClientCredentialsFromOptions({
      hostedOAuthClientId: "client-id",
      hostedOAuthClientSecret: "client-secret",
    });

    assert.deepEqual(credentials, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    assert.equal(hasAnyMcpOAuthClientCredentials(credentials), true);
    assert.equal(hasAnyMcpOAuthClientCredentials(mcpOAuthClientCredentialsFromOptions({})), false);
  });

  it("keeps every client harness on the mapped credential shape", async () => {
    for (const path of [
      "scripts/smoke-openai-mcp-client.ts",
      "scripts/smoke-claude-code-mcp-client.ts",
      "scripts/smoke-gemini-cli-mcp-client.ts",
      "scripts/smoke-mcp-inspector-client.ts",
    ]) {
      const source = await readFile(path, "utf8");

      assert.match(source, /mcpOAuthClientCredentialsFromOptions\(options\)/, path);
      assert.doesNotMatch(source, /hasAnyMcpOAuthClientCredentials\(options\)/, path);
    }
  });

  it("reports OAuth credential source names without exposing values", () => {
    assert.deepEqual(
      mcpOAuthCredentialSourcesFromEnv(
        {
          VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID: "client-specific-id",
          VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET: "client-specific-secret",
          VRDEX_CLAUDE_CODE_OAUTH_TOKEN: "secret-token",
          VRDEX_MCP_OAUTH_CLIENT_ID: "generic-id",
          VRDEX_MCP_OAUTH_CLIENT_SECRET: "generic-secret",
        },
        "CLAUDE_CODE",
        "VRDEX_CLAUDE_CODE_OAUTH_TOKEN",
      ),
      {
        clientIdSource: "VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID",
        clientSecretSource: "VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET",
        hasCompleteClientCredentials: true,
        hasPartialClientCredentials: false,
        hasToken: true,
        tokenSource: "VRDEX_CLAUDE_CODE_OAUTH_TOKEN",
      },
    );

    assert.deepEqual(
      mcpOAuthCredentialSourcesFromEnv(
        {
          VRDEX_MCP_OAUTH_CLIENT_ID: "generic-id",
        },
        "MCP_INSPECTOR",
        "VRDEX_MCP_INSPECTOR_OAUTH_TOKEN",
      ),
      {
        clientIdSource: "VRDEX_MCP_OAUTH_CLIENT_ID",
        clientSecretSource: undefined,
        hasCompleteClientCredentials: false,
        hasPartialClientCredentials: true,
        hasToken: false,
        tokenSource: undefined,
      },
    );
  });

  it("reports hosted workflow OAuth credential-generation inputs without exposing values", () => {
    assert.deepEqual(
      hostedMcpOAuthCredentialGenerationSourcesFromEnv({
        VRDEX_HOSTED_E2E_AUTH_HELPERS: "true",
        VRDEX_HOSTED_E2E_BROWSER_TOKEN: "browser-token",
        VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS: "true",
      }),
      {
        authHelpersSource: "VRDEX_HOSTED_E2E_AUTH_HELPERS",
        browserTokenSource: "VRDEX_HOSTED_E2E_BROWSER_TOKEN",
        canGenerateCredentials: true,
        developerCredentialsSource: "VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS",
        hasAnyInput: true,
        hasAuthHelpers: true,
        hasBrowserToken: true,
        hasDeveloperCredentials: true,
      },
    );

    assert.deepEqual(
      hostedMcpOAuthCredentialGenerationSourcesFromEnv({
        MCP_HOSTED_E2E_AUTH_HELPERS: "true",
        MCP_HOSTED_E2E_BROWSER_TOKEN: "browser-token",
      }),
      {
        authHelpersSource: "MCP_HOSTED_E2E_AUTH_HELPERS",
        browserTokenSource: "MCP_HOSTED_E2E_BROWSER_TOKEN",
        canGenerateCredentials: false,
        developerCredentialsSource: undefined,
        hasAnyInput: true,
        hasAuthHelpers: true,
        hasBrowserToken: true,
        hasDeveloperCredentials: false,
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
