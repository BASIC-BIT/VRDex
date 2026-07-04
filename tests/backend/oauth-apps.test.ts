import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeOAuthApplicationDescription,
  normalizeOAuthApplicationName,
  normalizeOAuthAccessTokenId,
  normalizeOAuthClientId,
  normalizeOAuthClientSecretHash,
  normalizeOAuthClientSecretPrefix,
  normalizeOAuthClientType,
  normalizeOAuthGrantTypes,
  normalizeOAuthOptionalUrl,
  normalizeOAuthRedirectUris,
  normalizeOAuthResourceUri,
  normalizeOAuthScopes,
  normalizeOAuthTokenExpiry,
  normalizeOAuthRevokeReason,
} from "../../convex/_oauth";

describe("OAuth application helpers", () => {
  it("normalizes application identity and metadata", () => {
    assert.equal(normalizeOAuthClientId("vrdx_app_0123456789abcdef01234567"), "vrdx_app_0123456789abcdef01234567");
    assert.equal(normalizeOAuthClientType("confidential"), "confidential");
    assert.equal(normalizeOAuthApplicationName("  Local   MCP client  "), "Local MCP client");
    assert.equal(normalizeOAuthApplicationDescription("  Reads public profiles  "), "Reads public profiles");
    assert.equal(normalizeOAuthOptionalUrl("https://example.com/privacy", "Privacy URL"), "https://example.com/privacy");
    assert.equal(normalizeOAuthRevokeReason("  Retired   app  "), "Retired app");
    assert.throws(() => normalizeOAuthClientId("bad"), /client id/);
    assert.throws(() => normalizeOAuthOptionalUrl("http://example.com", "Docs URL"), /HTTPS/);
  });

  it("normalizes redirect URIs, scopes, grants, and secret metadata", () => {
    assert.deepEqual(normalizeOAuthRedirectUris(["http://localhost:3456/callback"]), [
      "http://localhost:3456/callback",
    ]);
    assert.deepEqual(normalizeOAuthScopes(["public:read", "mcp:read", "public:read"]), [
      "public:read",
      "mcp:read",
    ]);
    assert.deepEqual(normalizeOAuthGrantTypes(undefined, "public"), [
      "authorization_code",
      "refresh_token",
    ]);
    assert.deepEqual(normalizeOAuthGrantTypes(undefined, "confidential"), [
      "authorization_code",
      "refresh_token",
      "client_credentials",
    ]);
    assert.equal(normalizeOAuthClientSecretPrefix("vrdx_secret_0123456789abcdef"), "vrdx_secret_0123456789abcdef");
    assert.equal(normalizeOAuthAccessTokenId("vrdx_at_0123456789abcdef0123456789abcdef"), "vrdx_at_0123456789abcdef0123456789abcdef");
    assert.equal(normalizeOAuthResourceUri("http://127.0.0.1:3000/mcp"), "http://127.0.0.1:3000/mcp");
    assert.equal(normalizeOAuthTokenExpiry(2_000, 1_000), 2_000);
    assert.equal(
      normalizeOAuthClientSecretHash("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    assert.throws(() => normalizeOAuthRedirectUris(["http://example.com/callback"]), /HTTPS/);
    assert.throws(() => normalizeOAuthGrantTypes(["client_credentials"], "public"), /Public OAuth clients/);
    assert.throws(() => normalizeOAuthScopes(["admin:everything"]), /Unsupported OAuth scope/);
    assert.throws(() => normalizeOAuthAccessTokenId("bad"), /access token id/);
    assert.throws(() => normalizeOAuthTokenExpiry(1_000, 2_000), /future timestamp/);
  });
});
