import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";

import { createOAuthClientSecretValue } from "../../packages/api-contracts/src/oauth";
import {
  oauthAccessTokenExpiresAt,
  verifyOAuthAccessToken,
} from "../../apps/web/src/lib/server/oauth-jwt";
import { deriveS256CodeChallenge } from "../../apps/web/src/lib/server/oauth-pkce";
import {
  oauthTokenResponse,
  type OAuthTokenMutations,
} from "../../apps/web/src/lib/server/oauth-token";

const now = 1_800_000_000_000;
const tokenId = "vrdx_at_0123456789abcdef0123456789abcdef";
const refreshToken = "vrdx_rt_0123456789abcdef0123456789abcdef0123456789abcdef";
const replacementRefreshToken = "vrdx_rt_fedcba9876543210fedcba9876543210fedcba9876543210";
const clientId = "vrdx_app_0123456789abcdef01234567";
const userId = "user_0123456789abcdef";

function tokenRequest(params: Record<string, string>, headers: HeadersInit = {}) {
  return new Request("https://app.example.test/oauth/token", {
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

function defaultMutations(): OAuthTokenMutations {
  return {
    consumeAuthorizationCode: unexpectedMutation("consumeAuthorizationCode"),
    issueClientCredentialsAccessToken: unexpectedMutation("issueClientCredentialsAccessToken"),
    rotateRefreshToken: unexpectedMutation("rotateRefreshToken"),
  };
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
  process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "token-route-test";
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function jsonBody(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("OAuth token route helper", () => {
  it("issues client credentials access tokens with resource-bound JWT claims", async () => {
    await withOAuthEnv(async () => {
      const secret = createOAuthClientSecretValue();
      let mutationInput: Parameters<OAuthTokenMutations["issueClientCredentialsAccessToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.issueClientCredentialsAccessToken = async (input) => {
        mutationInput = input;

        return {
          ok: true,
          clientId: input.clientId,
          expiresAt: input.expiresAt,
          resource: input.resource,
          scopes: input.requestedScopes,
          tokenId: input.tokenId,
        };
      };

      const response = await oauthTokenResponse(
        tokenRequest(
          {
            grant_type: "client_credentials",
            resource: "https://app.example.test/mcp",
            scope: "public:read mcp:read",
          },
          {
            authorization: `Basic ${Buffer.from(`${clientId}:${secret.secretValue}`).toString("base64")}`,
          },
        ),
        {
          createAccessTokenId: () => tokenId,
          mutations,
          now: () => now,
        },
      );

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("pragma"), "no-cache");
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.equal(mutationInput.secretPrefix, secret.secretPrefix);
      assert.match(mutationInput.verifierHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.verifierHash, secret.secretValue);
      assert.deepEqual(mutationInput.requestedScopes, ["public:read", "mcp:read"]);
      assert.equal(mutationInput.resource, "https://app.example.test/mcp");
      assert.equal(mutationInput.tokenId, tokenId);
      assert.equal(mutationInput.expiresAt, oauthAccessTokenExpiresAt(now));

      const body = await jsonBody(response);
      assert.equal(body.token_type, "Bearer");
      assert.equal(body.expires_in, 3600);
      assert.equal(body.scope, "public:read mcp:read");
      assert.equal(body.refresh_token, undefined);

      const claims = verifyOAuthAccessToken(String(body.access_token), {
        audience: "https://app.example.test/mcp",
        issuer: "https://app.example.test",
        now: now + 1_000,
      });

      assert.equal(claims.client_id, clientId);
      assert.equal(claims.sub, clientId);
      assert.equal(claims.jti, tokenId);
      assert.equal(claims.scope, "public:read mcp:read");
    });
  });

  it("uses an authorization code's bound resource when the token request omits resource", async () => {
    await withOAuthEnv(async () => {
      const code = "vrdx_code_0123456789abcdef0123456789abcdef";
      const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const expectedChallenge = await deriveS256CodeChallenge(codeVerifier);
      let mutationInput: Parameters<OAuthTokenMutations["consumeAuthorizationCode"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.consumeAuthorizationCode = async (input) => {
        mutationInput = input;

        return {
          ok: true,
          clientId: input.clientId,
          expiresAt: input.expiresAt,
          resource: "https://app.example.test/api/v0",
          scopes: ["mcp:read", "public:read"],
          tokenId: input.tokenId,
          userId,
          refreshTokenIssued: true,
        };
      };

      const response = await oauthTokenResponse(
        tokenRequest({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: "http://localhost:8765/callback",
        }),
        {
          createAccessTokenId: () => tokenId,
          createRefreshTokenValue: () => refreshToken,
          mutations,
          now: () => now,
        },
      );

      assert.equal(response.status, 200);
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.match(mutationInput.codeHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.codeHash, code);
      assert.equal(mutationInput.redirectUri, "http://localhost:8765/callback");
      assert.equal(mutationInput.resource, undefined);
      assert.equal(mutationInput.derivedCodeChallenge, expectedChallenge);
      assert.equal(mutationInput.tokenId, tokenId);
      assert.match(mutationInput.refreshTokenHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.refreshTokenHash, refreshToken);
      assert.equal(mutationInput.refreshTokenExpiresAt, now + 30 * 24 * 60 * 60 * 1000);

      const body = await jsonBody(response);
      assert.equal(body.refresh_token, refreshToken);
      assert.equal(body.scope, "mcp:read public:read");

      const claims = verifyOAuthAccessToken(String(body.access_token), {
        audience: "https://app.example.test/api/v0",
        issuer: "https://app.example.test",
        now: now + 1_000,
      });

      assert.equal(claims.client_id, clientId);
      assert.equal(claims.sub, userId);
      assert.equal(claims.jti, tokenId);
    });
  });

  it("omits refresh tokens when an authorization-code client does not allow refresh", async () => {
    await withOAuthEnv(async () => {
      const mutations = defaultMutations();

      mutations.consumeAuthorizationCode = async (input) => ({
        ok: true,
        clientId: input.clientId,
        expiresAt: input.expiresAt,
        resource: "https://app.example.test/api/v0",
        scopes: ["public:read"],
        tokenId: input.tokenId,
        userId,
        refreshTokenIssued: false,
      });

      const response = await oauthTokenResponse(
        tokenRequest({
          client_id: clientId,
          code: "vrdx_code_0123456789abcdef0123456789abcdef",
          code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
          grant_type: "authorization_code",
          redirect_uri: "http://localhost:8765/callback",
        }),
        {
          createAccessTokenId: () => tokenId,
          createRefreshTokenValue: () => refreshToken,
          mutations,
          now: () => now,
        },
      );

      assert.equal(response.status, 200);
      const body = await jsonBody(response);
      assert.equal(body.refresh_token, undefined);
      assert.equal(body.scope, "public:read");
    });
  });

  it("uses a refresh token's bound resource when the refresh request omits resource", async () => {
    await withOAuthEnv(async () => {
      let mutationInput: Parameters<OAuthTokenMutations["rotateRefreshToken"]>[0] | undefined;
      const mutations = defaultMutations();

      mutations.rotateRefreshToken = async (input) => {
        mutationInput = input;

        return {
          ok: true,
          clientId: input.clientId,
          expiresAt: input.expiresAt,
          resource: "https://app.example.test/api/v0",
          scopes: input.requestedScopes ?? ["mcp:read", "public:read"],
          tokenId: input.tokenId,
          userId,
        };
      };

      const response = await oauthTokenResponse(
        tokenRequest({
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "public:read",
        }),
        {
          createAccessTokenId: () => tokenId,
          createRefreshTokenValue: () => replacementRefreshToken,
          mutations,
          now: () => now,
        },
      );

      assert.equal(response.status, 200);
      assert.ok(mutationInput);
      assert.equal(mutationInput.clientId, clientId);
      assert.match(mutationInput.refreshTokenHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.refreshTokenHash, refreshToken);
      assert.match(mutationInput.replacementRefreshTokenHash, /^[0-9a-f]{64}$/);
      assert.notEqual(mutationInput.replacementRefreshTokenHash, replacementRefreshToken);
      assert.deepEqual(mutationInput.requestedScopes, ["public:read"]);
      assert.equal(mutationInput.resource, undefined);

      const body = await jsonBody(response);
      assert.equal(body.refresh_token, replacementRefreshToken);
      assert.equal(body.scope, "public:read");

      const claims = verifyOAuthAccessToken(String(body.access_token), {
        audience: "https://app.example.test/api/v0",
        issuer: "https://app.example.test",
        now: now + 1_000,
      });

      assert.equal(claims.sub, userId);
      assert.equal(claims.scope, "public:read");
    });
  });

  it("returns no-store OAuth errors before unsupported or malformed token exchanges reach Convex", async () => {
    await withOAuthEnv(async () => {
      const mutations = defaultMutations();
      const malformed = await oauthTokenResponse(
        new Request("https://app.example.test/oauth/token", {
          body: JSON.stringify({ grant_type: "client_credentials" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        { mutations },
      );

      assert.equal(malformed.status, 400);
      assert.equal(malformed.headers.get("cache-control"), "no-store");
      assert.deepEqual(await jsonBody(malformed), {
        error: "invalid_request",
        error_description: "OAuth token requests must use application/x-www-form-urlencoded.",
      });

      const unsupported = await oauthTokenResponse(
        tokenRequest({ grant_type: "password" }),
        { mutations },
      );

      assert.equal(unsupported.status, 400);
      assert.equal(unsupported.headers.get("cache-control"), "no-store");
      assert.deepEqual(await jsonBody(unsupported), {
        error: "unsupported_grant_type",
        error_description: "Supported grant types are authorization_code, refresh_token, and client_credentials.",
      });
    });
  });
});
