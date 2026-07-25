import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeOAuthAuthorizationRequest,
  redirectUriWithOAuthClientError,
  redirectUriWithOAuthResult,
} from "../../apps/web/src/lib/server/oauth-authorization-request";
import { tokenClientAuthentication } from "../../apps/web/src/lib/server/oauth-token-client-auth";
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
  refreshTokenPepper,
} from "../../apps/web/src/lib/server/oauth-pkce";
import { normalizedOAuthResourceIndicator } from "../../apps/web/src/lib/server/oauth-resource-indicator";
import { createOAuthClientSecretValue } from "../../packages/api-contracts/src/oauth";

describe("OAuth PKCE authorization helpers", () => {
  it("generates hashed authorization codes and derives RFC-compatible S256 challenges", async () => {
    const code = createOAuthAuthorizationCodeValue();

    assert.match(code, /^vrdx_code_[0-9a-f]{32}$/);
    assert.equal(normalizeOAuthAuthorizationCodeValue(code), code);
    assert.match(await hashOAuthAuthorizationCodeValue(code), /^[0-9a-f]{64}$/);
    const refreshToken = createOAuthRefreshTokenValue();

    assert.match(refreshToken, /^vrdx_rt_[0-9a-f]{48}$/);
    assert.equal(normalizeOAuthRefreshTokenValue(refreshToken), refreshToken);
    const refreshTokenHash = await hashOAuthRefreshTokenValue(refreshToken, "refresh-pepper");
    assert.match(refreshTokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(refreshTokenHash, await hashOAuthRefreshTokenValue(refreshToken, "other-pepper"));
    await assert.rejects(() => hashOAuthRefreshTokenValue(refreshToken, " "), /pepper/);
    assert.equal(
      await deriveS256CodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    assert.throws(() => normalizeOAuthAuthorizationCodeValue("bad"), /authorization code/);
    assert.throws(() => normalizeOAuthRefreshTokenValue("bad"), /refresh token/);
    assert.throws(() => normalizeOAuthCodeVerifier("short"), /code_verifier/);
    assert.throws(() => normalizeOAuthCodeChallenge("bad"), /code_challenge/);
    assert.equal(normalizeOAuthCodeChallengeMethod("S256"), "S256");
    assert.throws(() => normalizeOAuthCodeChallengeMethod("plain"), /S256/);
  });

  it("requires an environment pepper for OAuth refresh token hashing", () => {
    const previousPepper = process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER;

    try {
      process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER = " test-refresh-pepper ";

      assert.equal(refreshTokenPepper(), "test-refresh-pepper");

      delete process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER;
      assert.throws(refreshTokenPepper, /VRDEX_OAUTH_REFRESH_TOKEN_PEPPER/);
    } finally {
      if (previousPepper === undefined) {
        delete process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER;
      } else {
        process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER = previousPepper;
      }
    }
  });

  it("normalizes authorization requests and redirect results", async () => {
    const codeChallenge = await deriveS256CodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    const clientId = "https://client.example.test/oauth/client.json?app=vrdex";
    const params = new URLSearchParams({
      client_id: clientId,
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
      clientId,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri: "http://localhost:3333/callback",
      requestedScopes: ["mcp:read", "public:read"],
      resource: "https://app.example.test/mcp",
      state: "opaque-state",
    });

    const codexParams = new URLSearchParams(params);
    codexParams.append("resource", "https://app.example.test/mcp?auth=required");
    codexParams.append("resource", "https://app.example.test/mcp");

    assert.equal(
      normalizeOAuthAuthorizationRequest(codexParams, request).resource,
      "https://app.example.test/mcp",
    );
    const codexTokenForm = new FormData();
    codexTokenForm.append("resource", "https://app.example.test/mcp?auth=required");
    codexTokenForm.append("resource", "https://app.example.test/mcp");
    assert.equal(
      normalizedOAuthResourceIndicator(request, codexTokenForm),
      "https://app.example.test/mcp",
    );

    const bootstrapOnlyParams = new URLSearchParams(params);
    bootstrapOnlyParams.set("resource", "https://app.example.test/mcp?auth=required");
    assert.throws(
      () => normalizeOAuthAuthorizationRequest(bootstrapOnlyParams, request),
      /resource is not supported/,
    );

    const unrelatedDuplicateParams = new URLSearchParams(params);
    unrelatedDuplicateParams.append("resource", "https://app.example.test/mcp");
    unrelatedDuplicateParams.append("resource", "https://app.example.test/mcp?other=value");
    assert.throws(
      () => normalizeOAuthAuthorizationRequest(unrelatedDuplicateParams, request),
      /resource is not supported/,
    );

    const apiParams = new URLSearchParams(params);
    apiParams.set("scope", "profile:write");
    const normalizedApiRequest = normalizeOAuthAuthorizationRequest(apiParams, request);

    assert.deepEqual(normalizedApiRequest, {
      clientId,
      codeChallenge,
      codeChallengeMethod: "S256",
      redirectUri: "http://localhost:3333/callback",
      requestedScopes: ["profile:write"],
      resource: "https://app.example.test",
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
    const clientErrorRedirect = new URL(
      redirectUriWithOAuthClientError({
        reason: "wrong_resource",
        redirectUri: "http://localhost:3333/callback",
        state: "opaque-state",
      }),
    );

    assert.equal(clientErrorRedirect.searchParams.get("error"), "invalid_target");
    assert.equal(clientErrorRedirect.searchParams.get("state"), "opaque-state");
    assert.throws(
      () => normalizeOAuthAuthorizationRequest(new URLSearchParams({ response_type: "token" }), request),
      /response_type/,
    );
  });

  it("parses public and confidential token client authentication", async () => {
    const previousPepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER;
    process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER = "test-pepper";

    try {
      const publicForm = new FormData();
      publicForm.set("client_id", "vrdx_app_0123456789abcdef01234567");

      assert.deepEqual(
        await tokenClientAuthentication(new Request("https://app.example.test/oauth/token"), publicForm),
        {
          ok: true,
          clientId: "vrdx_app_0123456789abcdef01234567",
        },
      );

      const metadataDocumentForm = new FormData();
      metadataDocumentForm.set("client_id", "https://client.example.test/oauth/client.json?app=vrdex");

      assert.deepEqual(
        await tokenClientAuthentication(new Request("https://app.example.test/oauth/token"), metadataDocumentForm),
        {
          ok: true,
          clientId: "https://client.example.test/oauth/client.json?app=vrdex",
        },
      );

      const secret = createOAuthClientSecretValue();
      const confidentialForm = new FormData();
      const confidentialRequest = new Request("https://app.example.test/oauth/token", {
        headers: {
          authorization: `basic ${Buffer.from(`vrdx_app_0123456789abcdef01234567:${secret.secretValue}`).toString("base64")}`,
        },
      });
      const confidential = await tokenClientAuthentication(confidentialRequest, confidentialForm);

      assert.equal(confidential.ok, true);
      if (confidential.ok) {
        assert.equal(confidential.clientId, "vrdx_app_0123456789abcdef01234567");
        assert.equal(confidential.secretPrefix, secret.secretPrefix);
        assert.match(confidential.verifierHash ?? "", /^[0-9a-f]{64}$/);
      }

      const duplicateMethodForm = new FormData();
      duplicateMethodForm.set("client_secret", secret.secretValue);
      const duplicateMethod = await tokenClientAuthentication(confidentialRequest, duplicateMethodForm);

      assert.equal(duplicateMethod.ok, false);
      if (!duplicateMethod.ok) {
        assert.equal(duplicateMethod.response.status, 400);
      }

      const invalidSecretForm = new FormData();
      invalidSecretForm.set("client_id", "vrdx_app_0123456789abcdef01234567");
      invalidSecretForm.set("client_secret", "bad-secret");
      const invalidSecret = await tokenClientAuthentication(
        new Request("https://app.example.test/oauth/token"),
        invalidSecretForm,
      );

      assert.equal(invalidSecret.ok, false);
      if (!invalidSecret.ok) {
        assert.equal(invalidSecret.response.status, 401);
      }
    } finally {
      if (previousPepper === undefined) {
        delete process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER;
      } else {
        process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER = previousPepper;
      }
    }
  });
});
