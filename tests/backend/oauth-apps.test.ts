import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Id } from "../../convex/_generated/dataModel";
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
  validateOAuthAccessTokenRecord,
} from "../../convex/_oauth";

const accessTokenRecordId = "accessToken123" as Id<"oauthAccessTokens">;
const applicationId = "application123" as Id<"oauthApplications">;
type OAuthAccessTokenRecord = NonNullable<Parameters<typeof validateOAuthAccessTokenRecord>[0]>;

function oauthAccessTokenRecord(overrides: Partial<OAuthAccessTokenRecord> = {}): OAuthAccessTokenRecord {
  return {
    _id: accessTokenRecordId,
    tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
    applicationId,
    clientId: "vrdx_app_0123456789abcdef01234567",
    subjectType: "client",
    resource: "https://api.example.test",
    scopes: ["public:read", "mcp:read"],
    status: "active",
    expiresAt: 2_000,
    ...overrides,
  };
}

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

  it("validates OAuth access token records against resource and scopes", () => {
    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord(), {
        clientId: "vrdx_app_0123456789abcdef01234567",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://api.example.test",
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      {
        ok: true,
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        accessTokenRecordId,
        applicationId,
        clientId: "vrdx_app_0123456789abcdef01234567",
        subjectType: "client",
        resource: "https://api.example.test",
        scopes: ["public:read", "mcp:read"],
      },
    );

    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord(), {
        clientId: "vrdx_app_ffffffffffffffffffffffff",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://api.example.test",
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "not_found" },
    );
    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord(), {
        clientId: "vrdx_app_0123456789abcdef01234567",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://mcp.example.test",
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "wrong_resource" },
    );
    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord({ status: "revoked" }), {
        clientId: "vrdx_app_0123456789abcdef01234567",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://api.example.test",
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "revoked" },
    );
    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord({ expiresAt: 1_000 }), {
        clientId: "vrdx_app_0123456789abcdef01234567",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://api.example.test",
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "expired" },
    );
    assert.deepEqual(
      validateOAuthAccessTokenRecord(oauthAccessTokenRecord(), {
        clientId: "vrdx_app_0123456789abcdef01234567",
        tokenId: "vrdx_at_0123456789abcdef0123456789abcdef",
        resource: "https://api.example.test",
        requiredScopes: ["events:write"],
        now: 1_000,
      }),
      { ok: false, reason: "missing_scope" },
    );
  });
});
