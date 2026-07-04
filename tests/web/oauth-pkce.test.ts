import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeOAuthAuthorizationRequest,
  redirectUriWithOAuthResult,
} from "../../apps/web/src/lib/server/oauth-authorization-request";
import {
  createOAuthAuthorizationCodeValue,
  createOAuthRefreshTokenValue,
  deriveS256CodeChallenge,
  hashOAuthAuthorizationCodeValue,
  hashOAuthRefreshTokenValue,
  normalizeOAuthAuthorizationCodeValue,
  normalizeOAuthCodeChallenge,
  normalizeOAuthCodeChallengeMethod,
  normalizeOAuthCodeVerifier,
  normalizeOAuthRefreshTokenValue,
} from "../../apps/web/src/lib/server/oauth-pkce";

describe("OAuth PKCE authorization helpers", () => {
  it("generates hashed authorization codes and derives RFC-compatible S256 challenges", () => {
    const code = createOAuthAuthorizationCodeValue();

    assert.match(code, /^vrdx_code_[0-9a-f]{32}$/);
    assert.equal(normalizeOAuthAuthorizationCodeValue(code), code);
    assert.match(hashOAuthAuthorizationCodeValue(code), /^[0-9a-f]{64}$/);
    const refreshToken = createOAuthRefreshTokenValue();

    assert.match(refreshToken, /^vrdx_rt_[0-9a-f]{48}$/);
    assert.equal(normalizeOAuthRefreshTokenValue(refreshToken), refreshToken);
    assert.match(hashOAuthRefreshTokenValue(refreshToken), /^[0-9a-f]{64}$/);
    assert.equal(
      deriveS256CodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    assert.throws(() => normalizeOAuthAuthorizationCodeValue("bad"), /authorization code/);
    assert.throws(() => normalizeOAuthRefreshTokenValue("bad"), /refresh token/);
    assert.throws(() => normalizeOAuthCodeVerifier("short"), /code_verifier/);
    assert.throws(() => normalizeOAuthCodeChallenge("bad"), /code_challenge/);
    assert.equal(normalizeOAuthCodeChallengeMethod("S256"), "S256");
    assert.throws(() => normalizeOAuthCodeChallengeMethod("plain"), /S256/);
  });

  it("normalizes authorization requests and redirect results", () => {
    const codeChallenge = deriveS256CodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const params = new URLSearchParams({
      client_id: "vrdx_app_0123456789abcdef01234567",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: "http://localhost:3333/callback",
      response_type: "code",
      scope: "mcp:read public:read",
      state: "opaque-state",
    });
    const request = new Request("https://app.example.test/oauth/authorize");
    const normalized = normalizeOAuthAuthorizationRequest(params, request);

    assert.deepEqual(normalized, {
      clientId: "vrdx_app_0123456789abcdef01234567",
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri: "http://localhost:3333/callback",
      requestedScopes: ["mcp:read", "public:read"],
      resource: "https://app.example.test/mcp",
      state: "opaque-state",
    });
    assert.equal(
      redirectUriWithOAuthResult({
        code: "vrdx_code_0123456789abcdef0123456789abcdef",
        redirectUri: "http://localhost:3333/callback",
        state: "opaque-state",
      }),
      "http://localhost:3333/callback?code=vrdx_code_0123456789abcdef0123456789abcdef&state=opaque-state",
    );
    assert.throws(
      () => normalizeOAuthAuthorizationRequest(new URLSearchParams({ response_type: "token" }), request),
      /response_type/,
    );
  });
});
