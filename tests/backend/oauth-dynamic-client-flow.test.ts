import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_apiTokens.ts": () => import("../../convex/_apiTokens"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/_oauth.ts": () => import("../../convex/_oauth"),
  "../../convex/oauthApps.ts": () => import("../../convex/oauthApps"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

describe("OAuth dynamic client authorization", () => {
  it("resolves the exact loopback redirect returned by registration", async () => {
    const t = convexTest({ schema, modules });
    const clientId = "vrdx_app_0123456789abcdef01234567";
    const redirectUri = "http://127.0.0.1:8989/oauth/callback";
    const resource = "https://staging.vrdex.net/mcp";
    const scopes = ["mcp:read", "mcp:write", "events:write"] as const;

    const registered = await t.mutation(internal.oauthApps.createDynamicMcpClient, {
      clientId,
      clientName: "OpenClaw MCP",
      redirectUris: [redirectUri],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      contacts: [],
      allowedScopes: [...scopes],
      allowEventWrites: true,
      resource,
    });

    assert.deepEqual(registered.redirectUris, [redirectUri]);

    const resolved = await t.query(internal.oauthApps.resolveAuthorizationClient, {
      clientId,
      redirectUri,
      requestedScopes: [...scopes],
      resource,
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.redirectUri, redirectUri);
  });
});
