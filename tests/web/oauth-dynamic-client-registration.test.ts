import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dynamicMcpClientRegistrationResponse,
  type DynamicMcpClientMutationInput,
} from "../../apps/web/src/lib/server/oauth-dynamic-client-registration";

const allowedRateLimit = {
  allowed: true,
  key: "test:oauth_dynamic_client_registration:ip:203.0.113.8",
  limit: 10,
  remaining: 9,
  resetAt: 1_700_000_060_000,
  retryAfterSeconds: 60,
};

function registrationRequest(body: unknown) {
  return new Request("https://app.example.test/oauth/register", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.8",
    },
    method: "POST",
  });
}

describe("OAuth dynamic client registration", () => {
  it("normalizes MCP public client metadata and returns OAuth registration metadata", async () => {
    const mutationInputs: DynamicMcpClientMutationInput[] = [];
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "  Claude Desktop  ",
        client_uri: "https://client.example.test",
        contacts: ["mailto:ops@example.test", "mailto:ops@example.test"],
        grant_types: ["authorization_code", "refresh_token"],
        logo_uri: "https://client.example.test/logo.png",
        redirect_uris: ["http://localhost:8765/callback"],
        response_types: ["code"],
        scope: "mcp:read public:read",
        software_id: "claude-desktop",
        software_version: "1.2.3",
        token_endpoint_auth_method: "none",
      }),
      {
        checkRateLimit: async (input) => {
          assert.deepEqual(input, {
            identity: { kind: "ip", value: "203.0.113.8" },
            routeClass: "oauth_dynamic_client_registration",
          });

          return allowedRateLimit;
        },
        createClientId: () => "vrdx_app_0123456789abcdef01234567",
        registerDynamicMcpClient: async (input) => {
          mutationInputs.push(input);

          return {
            ...input,
            createdAt: 1_700_000_000_123,
          };
        },
      },
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.deepEqual(mutationInputs, [
      {
        allowedScopes: ["mcp:read", "public:read"],
        clientId: "vrdx_app_0123456789abcdef01234567",
        clientName: "Claude Desktop",
        clientUri: "https://client.example.test/",
        contacts: ["mailto:ops@example.test"],
        grantTypes: ["authorization_code", "refresh_token"],
        logoUri: "https://client.example.test/logo.png",
        redirectUris: ["http://localhost:8765/callback"],
        resource: "https://app.example.test/mcp",
        responseTypes: ["code"],
        softwareId: "claude-desktop",
        softwareVersion: "1.2.3",
        tokenEndpointAuthMethod: "none",
      },
    ]);
    assert.deepEqual(await response.json(), {
      authorization_server: "https://app.example.test",
      client_id: "vrdx_app_0123456789abcdef01234567",
      client_id_issued_at: 1_700_000_000,
      client_name: "Claude Desktop",
      client_uri: "https://client.example.test/",
      contacts: ["mailto:ops@example.test"],
      grant_types: ["authorization_code", "refresh_token"],
      logo_uri: "https://client.example.test/logo.png",
      redirect_uris: ["http://localhost:8765/callback"],
      resource: "https://app.example.test/mcp",
      response_types: ["code"],
      scope: "mcp:read public:read",
      software_id: "claude-desktop",
      software_version: "1.2.3",
      token_endpoint_auth_method: "none",
    });
  });

  it("rejects invalid dynamic client metadata before registering a client", async () => {
    let mutationCalled = false;
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Bad MCP Client",
        redirect_uris: ["https://client.example.test/callback"],
        scope: "profile:read",
      }),
      {
        checkRateLimit: async () => allowedRateLimit,
        registerDynamicMcpClient: async (input) => {
          mutationCalled = true;

          return {
            ...input,
            createdAt: 1,
          };
        },
      },
    );

    assert.equal(mutationCalled, false);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_client_metadata",
      error_description: "Dynamic MCP clients can only request public:read mcp:read.",
    });
  });

  it("returns OAuth rate-limit metadata when registration is temporarily unavailable", async () => {
    const blockedEvents: unknown[] = [];
    const response = await dynamicMcpClientRegistrationResponse(registrationRequest({}), {
      checkRateLimit: async () => ({
        allowed: false,
        key: "test:oauth_dynamic_client_registration:ip:203.0.113.8",
        limit: 10,
        remaining: 0,
        resetAt: 1_700_000_060_000,
        retryAfterSeconds: 42,
      }),
      recordRateLimitBlockedEvent: async (input) => {
        blockedEvents.push(input);
        return null;
      },
    });

    assert.equal(response.status, 429);
    assert.deepEqual(blockedEvents, [
      {
        identity: { kind: "ip", value: "203.0.113.8" },
        quotaTier: "standard",
        rateLimit: {
          allowed: false,
          key: "test:oauth_dynamic_client_registration:ip:203.0.113.8",
          limit: 10,
          remaining: 0,
          resetAt: 1_700_000_060_000,
          retryAfterSeconds: 42,
        },
        routeClass: "oauth_dynamic_client_registration",
        windowMs: 60_000,
      },
    ]);
    assert.equal(response.headers.get("retry-after"), "42");
    assert.equal(response.headers.get("ratelimit-limit"), "10");
    assert.equal(response.headers.get("ratelimit-remaining"), "0");
    assert.equal(response.headers.get("ratelimit-reset"), "1700000060");
    assert.deepEqual(await response.json(), {
      error: "temporarily_unavailable",
      error_description: "Too many dynamic client registration requests were sent from this network.",
    });
  });

  it("returns a no-store OAuth error when backend registration fails", async () => {
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Claude Desktop",
        redirect_uris: ["http://localhost:8765/callback"],
        scope: "mcp:read public:read",
      }),
      {
        checkRateLimit: async () => allowedRateLimit,
        createClientId: () => "vrdx_app_0123456789abcdef01234567",
        registerDynamicMcpClient: async () => {
          throw new Error("backend unavailable");
        },
      },
    );

    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "server_error",
      error_description: "The server could not register this dynamic OAuth client.",
    });
  });
});
