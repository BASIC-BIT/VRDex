import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  dynamicMcpClientRegistrationResponse,
  type DynamicMcpClientMutationInput,
} from "../../apps/web/src/lib/server/oauth-dynamic-client-registration";
import { hashedApiRateLimitIdentityValue } from "../../apps/web/src/lib/server/api-rate-limit";

const allowedRateLimit = {
  allowed: true,
  key: "test:oauth_dynamic_client_registration:ip:203.0.113.8",
  limit: 10,
  remaining: 9,
  resetAt: 1_700_000_060_000,
  retryAfterSeconds: 60,
};

const previousTrustedProxyHeader = process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER;
process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER = "x-test-client-ip";

after(() => {
  if (previousTrustedProxyHeader === undefined) {
    delete process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER;
  } else {
    process.env.VRDEX_TRUSTED_PROXY_CLIENT_IP_HEADER = previousTrustedProxyHeader;
  }
});

function registrationRequest(body: unknown) {
  return new Request("https://app.example.test/oauth/register", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-test-client-ip": "203.0.113.8",
    },
    method: "POST",
  });
}

describe("OAuth dynamic client registration", () => {
  it("normalizes MCP public client metadata and returns OAuth registration metadata", async () => {
    const mutationInputs: DynamicMcpClientMutationInput[] = [];
    const rateLimitInputs: unknown[] = [];
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
          rateLimitInputs.push(input);

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
    assert.deepEqual(rateLimitInputs, [
      {
        identity: { kind: "ip", value: "203.0.113.8" },
        routeClass: "oauth_dynamic_client_registration",
      },
      {
        identity: {
          kind: "oauth_registration_software",
          value: await hashedApiRateLimitIdentityValue("oauth-registration-software", "claude-desktop"),
        },
        limitMultiplier: 10,
        routeClass: "oauth_dynamic_client_registration",
        trackRouteClassRequest: false,
      },
      {
        identity: {
          kind: "oauth_redirect_host",
          value: await hashedApiRateLimitIdentityValue("oauth-redirect-host", "localhost"),
        },
        limitMultiplier: 25,
        routeClass: "oauth_dynamic_client_registration",
        trackRouteClassRequest: false,
      },
    ]);
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

  function registrationHarness(clientId: string) {
    const mutationInputs: DynamicMcpClientMutationInput[] = [];

    return {
      mutationInputs,
      dependencies: {
        checkRateLimit: async () => allowedRateLimit,
        createClientId: () => clientId,
        registerDynamicMcpClient: async (input: DynamicMcpClientMutationInput) => {
          mutationInputs.push(input);
          return { ...input, createdAt: 1_700_000_000_123 };
        },
      },
    };
  }

  it("accepts event-write scopes with no deployment switch in front of them", async () => {
    const harness = registrationHarness("vrdx_app_1123456789abcdef01234567");
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Codex",
        redirect_uris: ["http://localhost:1455/callback"],
        scope: "mcp:read mcp:write events:write",
      }),
      harness.dependencies,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(harness.mutationInputs[0]?.allowedScopes, [
      "mcp:read",
      "mcp:write",
      "events:write",
    ]);
  });

  it("accepts profile writes without dragging event writes along", async () => {
    const harness = registrationHarness("vrdx_app_4123456789abcdef01234567");
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Set Link Agent",
        redirect_uris: ["http://localhost:1455/callback"],
        scope: "mcp:read mcp:write profile:write",
      }),
      harness.dependencies,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(harness.mutationInputs[0]?.allowedScopes, [
      "mcp:read",
      "mcp:write",
      "profile:write",
    ]);
  });

  it("narrows issuer-wide known scopes to the MCP resource during DCR", async () => {
    const harness = registrationHarness("vrdx_app_3123456789abcdef01234567");
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Codex",
        redirect_uris: ["http://localhost:1455/callback"],
        scope: "public:read profile:read events:write mcp:read mcp:write time:parse",
      }),
      harness.dependencies,
    );

    assert.equal(response.status, 201);
    // `time:parse` is dropped and `profile:read` is kept: the first is an
    // issuer-wide scope the MCP resource does not serve, the second is what the
    // owned-inventory read tool asks for.
    assert.deepEqual(harness.mutationInputs[0]?.allowedScopes, [
      "public:read",
      "profile:read",
      "events:write",
      "mcp:read",
      "mcp:write",
    ]);
    assert.equal(
      (await response.json() as { scope: string }).scope,
      "public:read profile:read events:write mcp:read mcp:write",
    );
  });

  it("accepts the exact write-only scope pair advertised by hosted write tools", async () => {
    const harness = registrationHarness("vrdx_app_2123456789abcdef01234567");
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "OpenClaw",
        redirect_uris: ["http://localhost:1455/callback"],
        scope: "mcp:write events:write",
      }),
      harness.dependencies,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(harness.mutationInputs[0]?.allowedScopes, ["mcp:write", "events:write"]);
  });

  it("blocks normalized client metadata before persisting a dynamic registration", async () => {
    let mutationCalled = false;
    const blockedKinds: string[] = [];
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Claude Desktop",
        redirect_uris: ["http://localhost:8765/callback"],
        scope: "mcp:read public:read",
        software_id: "claude-desktop",
      }),
      {
        checkRateLimit: async (input) => ({
          ...allowedRateLimit,
          allowed: input.identity.kind !== "oauth_registration_software",
          remaining: input.identity.kind === "oauth_registration_software" ? 0 : 9,
        }),
        recordRateLimitBlockedEvent: async (input) => {
          blockedKinds.push(input.identity.kind);
          assert.equal(input.identity.value.includes("claude-desktop"), false);
          return null;
        },
        registerDynamicMcpClient: async (input) => {
          mutationCalled = true;
          return { ...input, createdAt: 1 };
        },
      },
    );

    assert.equal(response.status, 429);
    assert.equal(mutationCalled, false);
    assert.deepEqual(blockedKinds, ["oauth_registration_software"]);
  });

  it("rejects invalid dynamic client metadata before registering a client", async () => {
    let mutationCalled = false;
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "Bad MCP Client",
        redirect_uris: ["https://client.example.test/callback"],
        // A real API scope the MCP resource does not serve. It used to be
        // `profile:read`, which a dynamic client may now request for the
        // owned-inventory read tool.
        scope: "developer:write",
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
      error_description: "Dynamic MCP clients can only request public:read mcp:read profile:read mcp:write events:write profile:write profile:contribute.",
    });
  });

  it("refuses a transport write scope with no resource to write", async () => {
    let mutationCalled = false;
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "OpenClaw",
        redirect_uris: ["http://localhost:18789/callback"],
        scope: "mcp:read mcp:write",
      }),
      {
        checkRateLimit: async () => allowedRateLimit,
        registerDynamicMcpClient: async (input) => {
          mutationCalled = true;
          return { ...input, createdAt: 1 };
        },
      },
    );

    assert.equal(response.status, 400);
    assert.equal(mutationCalled, false);
    assert.deepEqual(await response.json(), {
      error: "invalid_client_metadata",
      error_description:
        "Dynamic MCP write clients must request mcp:write and at least one of events:write, profile:write, profile:contribute.",
    });
  });

  it("rejects a scope that is not an API scope at all", async () => {
    let mutationCalled = false;
    const response = await dynamicMcpClientRegistrationResponse(
      registrationRequest({
        client_name: "OpenClaw",
        redirect_uris: ["http://localhost:18789/callback"],
        scope: "mcp:read profiles:writeall",
      }),
      {
        checkRateLimit: async () => allowedRateLimit,
        registerDynamicMcpClient: async (input) => {
          mutationCalled = true;
          return { ...input, createdAt: 1 };
        },
      },
    );

    assert.equal(response.status, 400);
    assert.equal(mutationCalled, false);
    assert.deepEqual(await response.json(), {
      error: "invalid_client_metadata",
      error_description: "Unsupported OAuth scope: profiles:writeall",
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
