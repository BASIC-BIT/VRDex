import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Id } from "../../convex/_generated/dataModel";
import {
  normalizeApiTokenExpiry,
  normalizeApiTokenLabel,
  normalizeApiTokenPrefix,
  normalizeApiTokenScopes,
  normalizeApiTokenVerifierHash,
  timingSafeEqualString,
  validateApiTokenRecord,
  type ApiScope,
} from "../../convex/_apiTokens";

const tokenId = "token123" as Id<"apiTokens">;
const ownerUserId = "user123" as Id<"users">;
const ownerCommunityProfileId = "community123" as Id<"profiles">;
type TokenRecord = NonNullable<Parameters<typeof validateApiTokenRecord>[0]>;

function tokenRecord(overrides: Partial<TokenRecord> = {}): TokenRecord {
  return {
    _id: tokenId,
    verifierHash: "a".repeat(64),
    ownerKind: "user" as const,
    ownerUserId,
    scopes: ["public:read", "mcp:read"] satisfies ApiScope[],
    status: "active" as const,
    trustTier: "personal" as const,
    ...overrides,
  };
}

describe("API token helpers", () => {
  it("normalizes token metadata without accepting malformed credentials", () => {
    assert.equal(normalizeApiTokenLabel("  Local   MCP token  "), "Local MCP token");
    assert.equal(normalizeApiTokenPrefix(`vrdx_${"b".repeat(24)}`), `vrdx_${"b".repeat(24)}`);
    assert.equal(normalizeApiTokenVerifierHash("c".repeat(64)), "c".repeat(64));
    assert.deepEqual(normalizeApiTokenScopes(undefined), ["public:read"]);
    assert.deepEqual(normalizeApiTokenScopes(["public:read", "mcp:read", "public:read"]), [
      "public:read",
      "mcp:read",
    ]);
    assert.equal(normalizeApiTokenExpiry(2_000, 1_000), 2_000);
    assert.equal(timingSafeEqualString("abc", "abc"), true);
    assert.equal(timingSafeEqualString("abc", "abd"), false);

    assert.throws(() => normalizeApiTokenLabel(""), /label/);
    assert.throws(() => normalizeApiTokenPrefix("vrdx_bad"), /prefix/);
    assert.throws(() => normalizeApiTokenVerifierHash("not-hex"), /verifier hash/);
    assert.throws(() => normalizeApiTokenScopes(["bad:scope"]), /Unsupported/);
    assert.throws(() => normalizeApiTokenExpiry(1_000, 1_000), /future/);
  });

  it("validates active API token records and rejects unsafe states", () => {
    assert.deepEqual(
      validateApiTokenRecord(tokenRecord(), {
        verifierHash: "a".repeat(64),
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      {
        ok: true,
        tokenId,
        ownerKind: "user",
        ownerUserId,
        trustTier: "personal",
        scopes: ["public:read", "mcp:read"],
      },
    );

    assert.deepEqual(
      validateApiTokenRecord(
        tokenRecord({
          ownerKind: "community",
          ownerCommunityProfileId,
          trustTier: "trusted_partner",
        }),
        {
          verifierHash: "a".repeat(64),
          requiredScopes: ["mcp:read"],
          now: 1_000,
        },
      ),
      {
        ok: true,
        tokenId,
        ownerKind: "community",
        ownerUserId,
        ownerCommunityProfileId,
        trustTier: "trusted_partner",
        scopes: ["public:read", "mcp:read"],
      },
    );

    assert.deepEqual(
      validateApiTokenRecord(tokenRecord(), {
        verifierHash: "b".repeat(64),
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "not_found" },
    );
    assert.deepEqual(
      validateApiTokenRecord(tokenRecord({ status: "revoked" }), {
        verifierHash: "a".repeat(64),
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "revoked" },
    );
    assert.deepEqual(
      validateApiTokenRecord(tokenRecord({ expiresAt: 1_000 }), {
        verifierHash: "a".repeat(64),
        requiredScopes: ["public:read"],
        now: 1_000,
      }),
      { ok: false, reason: "expired" },
    );
    assert.deepEqual(
      validateApiTokenRecord(tokenRecord(), {
        verifierHash: "a".repeat(64),
        requiredScopes: ["events:write"],
        now: 1_000,
      }),
      { ok: false, reason: "missing_scope" },
    );
  });
});
