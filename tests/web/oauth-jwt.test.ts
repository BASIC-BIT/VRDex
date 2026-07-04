import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import {
  createOAuthAccessTokenId,
  oauthAccessTokenSigningConfigured,
  oauthAccessTokenExpiresAt,
  oauthAccessTokenExpiresInSeconds,
  oauthApiResourceUri,
  oauthScopeString,
  parseOAuthScopeString,
  signOAuthAccessToken,
  verifyOAuthAccessToken,
} from "../../apps/web/src/lib/server/oauth-jwt";

function withSigningKey<T>(callback: () => T) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const previousKey = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;
  const previousKid = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID;

  process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";

  try {
    return callback();
  } finally {
    if (previousKey === undefined) {
      delete process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;
    } else {
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = previousKey;
    }

    if (previousKid === undefined) {
      delete process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID;
    } else {
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = previousKid;
    }
  }
}

describe("OAuth JWT access tokens", () => {
  it("signs audience-bound access tokens and rejects wrong resources", () => {
    withSigningKey(() => {
      const tokenId = createOAuthAccessTokenId();
      const accessToken = signOAuthAccessToken({
        aud: "https://api.example.test",
        client_id: "vrdx_app_0123456789abcdef01234567",
        exp: Math.floor(oauthAccessTokenExpiresAt(1_800_000_000_000) / 1000),
        iat: Math.floor(1_800_000_000_000 / 1000),
        iss: "https://issuer.example.test",
        jti: tokenId,
        scope: oauthScopeString(["public:read", "mcp:read"]),
        sub: "vrdx_app_0123456789abcdef01234567",
      });
      const claims = verifyOAuthAccessToken(accessToken, {
        audience: "https://api.example.test",
        issuer: "https://issuer.example.test",
        now: 1_800_000_001_000,
      });

      assert.equal(claims.jti, tokenId);
      assert.equal(claims.client_id, "vrdx_app_0123456789abcdef01234567");
      assert.equal(claims.scope, "public:read mcp:read");
      assert.throws(
        () =>
          verifyOAuthAccessToken(accessToken, {
            audience: "https://mcp.example.test",
            issuer: "https://issuer.example.test",
            now: 1_800_000_001_000,
          }),
        /audience/,
      );
    });
  });

  it("normalizes scope strings and token lifetimes", () => {
    assert.match(createOAuthAccessTokenId(), /^vrdx_at_[0-9a-f]{32}$/);
    assert.equal(oauthAccessTokenExpiresInSeconds(), 3600);
    assert.deepEqual(parseOAuthScopeString("public:read mcp:read public:read", ["public:read"]), [
      "public:read",
      "mcp:read",
    ]);
    assert.deepEqual(parseOAuthScopeString("", ["public:read"]), ["public:read"]);
    assert.throws(() => parseOAuthScopeString("bad:scope", ["public:read"]), /Unsupported/);
  });

  it("normalizes configured API resources and signing-key availability", () => {
    const previousApiBaseUrl = process.env.VRDEX_PUBLIC_API_BASE_URL;
    const previousSigningKey = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;

    process.env.VRDEX_PUBLIC_API_BASE_URL = "https://api.example.test/api/v0";
    delete process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;

    try {
      assert.equal(oauthApiResourceUri(new Request("https://app.example.test/mcp")), "https://api.example.test");
      assert.equal(oauthAccessTokenSigningConfigured(), false);
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = "key";
      assert.equal(oauthAccessTokenSigningConfigured(), true);
    } finally {
      if (previousApiBaseUrl === undefined) {
        delete process.env.VRDEX_PUBLIC_API_BASE_URL;
      } else {
        process.env.VRDEX_PUBLIC_API_BASE_URL = previousApiBaseUrl;
      }

      if (previousSigningKey === undefined) {
        delete process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;
      } else {
        process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = previousSigningKey;
      }
    }
  });
});
