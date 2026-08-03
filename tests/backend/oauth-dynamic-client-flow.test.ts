import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";
import { OAUTH_CONSENT_TRANSACTION_TTL_MS } from "../../packages/api-contracts/src/oauth";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
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

  it("accepts a native client's loopback host and ephemeral port at authorization", async () => {
    const t = convexTest({ schema, modules });
    const clientId = "vrdx_app_89abcdef0123456701234567";
    const registeredRedirectUri = "http://localhost:1455/oauth/callback";
    const requestedRedirectUri = "http://127.0.0.1:8989/oauth/callback";
    const resource = "https://staging.vrdex.net/mcp";

    await t.mutation(internal.oauthApps.createDynamicMcpClient, {
      clientId,
      clientName: "OpenClaw MCP",
      redirectUris: [registeredRedirectUri],
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      tokenEndpointAuthMethod: "none",
      contacts: [],
      allowedScopes: ["mcp:read", "mcp:write", "events:write"],
      allowEventWrites: true,
      resource,
    });

    const resolved = await t.query(internal.oauthApps.resolveAuthorizationClient, {
      clientId,
      redirectUri: requestedRedirectUri,
      requestedScopes: ["mcp:read", "mcp:write", "events:write"],
      resource,
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.redirectUri, requestedRedirectUri);
  });

  it("consumes a bound consent transaction once and denies replay without weakening redirect validation", async () => {
    const t = convexTest({ schema, modules });
    const clientId = "vrdx_app_fedcba987654321001234567";
    const redirectUri = "http://127.0.0.1:8989/oauth/callback";
    const resource = "https://staging.vrdex.net/mcp";
    const scopes = ["mcp:read", "mcp:write", "events:write"] as const;
    const transactionHash = "a".repeat(64);
    const codeChallenge = "b".repeat(43);
    const now = Date.now();

    await t.mutation(internal.oauthApps.createDynamicMcpClient, {
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

    const { transactionId, userId } = await t.run(async (ctx) => {
      const clerkUserId = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId,});
      const transactionId = await ctx.db.insert("oauthConsentTransactions", {
        transactionHash,
        userId,
        clientId,
        redirectUri: "http://127.0.0.1:8989/wrong-path",
        resource,
        scopes: [...scopes],
        codeChallenge,
        codeChallengeMethod: "S256",
        state: "opaque-client-state",
        createdAt: now,
        expiresAt: now + OAUTH_CONSENT_TRANSACTION_TTL_MS,
      });

      return { transactionId, userId };
    });

    const bindingRejected = await t.mutation(internal.oauthApps.completeAuthorizationConsent, {
      transactionHash,
      userId,
      decision: "approve",
      codeHash: "c".repeat(64),
      expiresAt: now + 60_000,
    });

    assert.equal(bindingRejected.ok, false);
    assert.equal(bindingRejected.reason, "invalid_redirect_uri");
    assert.notEqual(await t.run(async (ctx) => await ctx.db.get(transactionId)), null);

    await t.run(async (ctx) => await ctx.db.patch(transactionId, { redirectUri }));

    const approved = await t.mutation(internal.oauthApps.completeAuthorizationConsent, {
      transactionHash,
      userId,
      decision: "approve",
      codeHash: "d".repeat(64),
      expiresAt: now + 60_000,
    });

    assert.equal(approved.ok, true);
    assert.equal(approved.approved, true);
    assert.equal(await t.run(async (ctx) => await ctx.db.get(transactionId)), null);

    const replay = await t.mutation(internal.oauthApps.completeAuthorizationConsent, {
      transactionHash,
      userId,
      decision: "approve",
      codeHash: "e".repeat(64),
      expiresAt: now + 60_000,
    });

    assert.deepEqual(replay, { ok: false, reason: "invalid_transaction" });
    const authorizationCodes = await t.run(async (ctx) => await ctx.db.query("oauthAuthorizationCodes").collect());
    assert.equal(authorizationCodes.length, 1);

    const wrongPort = await t.mutation(internal.oauthApps.consumeAuthorizationCode, {
      clientId,
      codeHash: "d".repeat(64),
      redirectUri: "http://localhost:8990/oauth/callback",
      resource,
      derivedCodeChallenge: codeChallenge,
      tokenId: `vrdx_at_${"1".repeat(32)}`,
      expiresAt: now + 60_000,
      refreshTokenHash: "2".repeat(64),
      refreshTokenExpiresAt: now + 120_000,
    });

    assert.equal(wrongPort.ok, false);
    assert.equal(wrongPort.rejectionReason, "redirect_mismatch");

    const loopbackAlias = await t.mutation(internal.oauthApps.consumeAuthorizationCode, {
      clientId,
      codeHash: "d".repeat(64),
      redirectUri: "http://localhost:8989/oauth/callback",
      resource,
      derivedCodeChallenge: codeChallenge,
      tokenId: `vrdx_at_${"3".repeat(32)}`,
      expiresAt: now + 60_000,
      refreshTokenHash: "4".repeat(64),
      refreshTokenExpiresAt: now + 120_000,
    });

    assert.equal(loopbackAlias.ok, true);
    assert.equal(
      (await t.run(async (ctx) => await ctx.db.query("oauthAuthorizationCodes").unique()))?.status,
      "consumed",
    );

    const protocolSetupValidation = await t.mutation(internal.oauthApps.validateAccessToken, {
      clientId,
      tokenId: `vrdx_at_${"3".repeat(32)}`,
      resource,
      requiredScopes: [],
      routeClass: "authenticated_mcp",
    });

    assert.equal(protocolSetupValidation.ok, true);
  });
});
