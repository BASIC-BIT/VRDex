import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { createOAuthClientSecretValue } from "../../packages/api-contracts/src/oauth";
import { signOAuthAccessToken } from "../../apps/web/src/lib/server/oauth-jwt";
import {
  oauthRevokeResponse,
  type OAuthRevokeMutations,
} from "../../apps/web/src/lib/server/oauth-revoke";

const clientId = "vrdx_app_0123456789abcdef01234567";
const tokenId = "vrdx_at_0123456789abcdef0123456789abcdef";
const refreshToken = "vrdx_rt_0123456789abcdef0123456789abcdef0123456789abcdef";

function revokeRequest(params: Record<string, string>, headers: HeadersInit = {}) {
  return new Request("https://app.example.test/oauth/revoke", {
    body: new URLSearchParams(params),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    method: "POST",
  });
}

function unexpectedMutation(name: string) {
  return async () => {
    throw new Error(`Unexpected ${name} mutation.`);
  };
}

function defaultMutations(): OAuthRevokeMutations {
  return {
    revokeClientAccessToken: unexpectedMutation("revokeClientAccessToken"),
    revokeClientRefreshToken: unexpectedMutation("revokeClientRefreshToken"),
  };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withOAuthEnv<T>(callback: () => Promise<T>) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const previousSigningKey = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY;
  const previousSigningKid = process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID;
  const previousAdditionalJwks = process.env.VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS;
  const previousClientSecretPepper = process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER;
  const previousRefreshTokenPepper = process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER;
  const previousApiBaseUrl = process.env.VRDEX_PUBLIC_API_BASE_URL;
  const previousMcpResource = process.env.VRDEX_MCP_RESOURCE_URI;
  const previousIssuer = process.env.VRDEX_OAUTH_ISSUER_URL;

  process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "revoke-route-test";
  process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER = "client-secret-pepper";
  process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER = "refresh-token-pepper";
  delete process.env.VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS;
  delete process.env.VRDEX_PUBLIC_API_BASE_URL;
  delete process.env.VRDEX_MCP_RESOURCE_URI;
  delete process.env.VRDEX_OAUTH_ISSUER_URL;

  try {
    return await callback();
  } finally {
    restoreEnv("VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY", previousSigningKey);
    restoreEnv("VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID", previousSigningKid);
    restoreEnv("VRDEX_OAUTH_ACCESS_TOKEN_ADDITIONAL_PUBLIC_JWKS", previousAdditionalJwks);
    restoreEnv("VRDEX_OAUTH_CLIENT_SECRET_PEPPER", previousClientSecretPepper);
    restoreEnv("VRDEX_OAUTH_REFRESH_TOKEN_PEPPER", previousRefreshTokenPepper);
    restoreEnv("VRDEX_PUBLIC_API_BASE_URL", previousApiBaseUrl);
    restoreEnv("VRDEX_MCP_RESOURCE_URI", previousMcpResource);
    restoreEnv("VRDEX_OAUTH_ISSUER_URL", previousIssuer);
  }
}

function accessToken(audience = "https://app.example.test/mcp") {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return signOAuthAccessToken({
    aud: audience,
    client_id: clientId,
    exp: nowSeconds + 3600,
    iat: nowSeconds,
    iss: "https://app.example.test",
    jti: tokenId,
    scope: "public:read mcp:read",
    sub: "user_0123456789abcdef",
  });
}

describe("OAuth revoke route helper", () => {
  it("revokes JWT access tokens without requiring client credentials", async () => {
    await withOAuthEnv(async () => {
      let mutationInput: Parameters<OAuthRevokeMutations["revokeClientAccessToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.revokeClientAccessToken = async (input) => {
        mutationInput = input;

        return { ok: true };
      };

      const response = await oauthRevokeResponse(
        revokeRequest({
          token: accessToken(),
          token_type_hint: "access_token",
        }),
        { mutations },
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("pragma"), "no-cache");
      assert.equal(await response.text(), "");
      assert.deepEqual(mutationInput, { clientId, tokenId });
    });
  });

  it("revokes public-client refresh tokens by hash and client id", async () => {
    await withOAuthEnv(async () => {
      let mutationInput: Parameters<OAuthRevokeMutations["revokeClientRefreshToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.revokeClientRefreshToken = async (input) => {
        mutationInput = input;

        return { ok: true };
      };

      const response = await oauthRevokeResponse(
        revokeRequest({
          client_id: clientId,
          token: refreshToken,
          token_type_hint: "refresh_token",
        }),
        { mutations },
      );

      assert.equal(response.status, 200);
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.match(mutationInput.refreshTokenHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.refreshTokenHash, refreshToken);
      assert.equal(mutationInput.secretPrefix, undefined);
      assert.equal(mutationInput.verifierHash, undefined);
    });
  });

  it("passes confidential-client authentication metadata for refresh-token revocation", async () => {
    await withOAuthEnv(async () => {
      const secret = createOAuthClientSecretValue();
      let mutationInput: Parameters<OAuthRevokeMutations["revokeClientRefreshToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.revokeClientRefreshToken = async (input) => {
        mutationInput = input;

        return { ok: true };
      };

      const response = await oauthRevokeResponse(
        revokeRequest(
          {
            token: refreshToken,
            token_type_hint: "refresh_token",
          },
          {
            authorization: `Basic ${Buffer.from(`${clientId}:${secret.secretValue}`).toString("base64")}`,
          },
        ),
        { mutations },
      );

      assert.equal(response.status, 200);
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.equal(mutationInput.secretPrefix, secret.secretPrefix);
      assert.match(mutationInput.verifierHash ?? "", /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.verifierHash, secret.secretValue);
    });
  });

  it("falls back to access-token revocation when the hint says refresh token", async () => {
    await withOAuthEnv(async () => {
      let mutationInput: Parameters<OAuthRevokeMutations["revokeClientAccessToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.revokeClientAccessToken = async (input) => {
        mutationInput = input;

        return { ok: true };
      };

      const response = await oauthRevokeResponse(
        revokeRequest({
          token: accessToken(),
          token_type_hint: "refresh_token",
        }),
        { mutations },
      );

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "");
      assert.deepEqual(mutationInput, { clientId, tokenId });
    });
  });

  it("falls back to refresh-token revocation when the hint says access token", async () => {
    await withOAuthEnv(async () => {
      let mutationInput: Parameters<OAuthRevokeMutations["revokeClientRefreshToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.revokeClientRefreshToken = async (input) => {
        mutationInput = input;

        return { ok: true };
      };

      const response = await oauthRevokeResponse(
        revokeRequest({
          client_id: clientId,
          token: refreshToken,
          token_type_hint: "access_token",
        }),
        { mutations },
      );

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "");
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.match(mutationInput.refreshTokenHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.refreshTokenHash, refreshToken);
    });
  });

  it("keeps malformed or unknown revocation requests indistinguishable", async () => {
    await withOAuthEnv(async () => {
      const mutations = defaultMutations();
      const malformedContentType = await oauthRevokeResponse(
        new Request("https://app.example.test/oauth/revoke", {
          body: JSON.stringify({ token: accessToken() }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        { mutations },
      );

      assert.equal(malformedContentType.status, 200);
      assert.equal(await malformedContentType.text(), "");

      const unknownToken = await oauthRevokeResponse(
        revokeRequest({ client_id: clientId, token: "not-a-token" }),
        { mutations },
      );

      assert.equal(unknownToken.status, 200);
      assert.equal(await unknownToken.text(), "");
    });
  });
});
