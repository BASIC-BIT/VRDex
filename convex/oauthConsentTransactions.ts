import { v } from "convex/values";
import { OAUTH_CONSENT_TRANSACTION_TTL_MS } from "../packages/api-contracts/src/oauth";

import { apiScopeValidator, type ApiScope } from "./_apiTokens";
import { internalMutation, query } from "./_generated/server";
import {
  normalizeOAuthClientId,
  normalizeOAuthCodeChallenge,
  normalizeOAuthCodeChallengeMethod,
  normalizeOAuthRedirectUris,
  normalizeOAuthResourceUri,
  normalizeOAuthScopes,
  oauthCodeChallengeMethodValidator,
} from "./_oauth";
import {
  normalizeOAuthConsentTransactionHash,
  oauthConsentTransactionDisposition,
} from "./_oauthConsentTransactions";
import { requireUser } from "./_identity";

const transactionArgs = {
  transactionHash: v.string(),
};

function transactionAuthorization(transaction: {
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: ApiScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state?: string;
}) {
  return {
    clientId: transaction.clientId,
    redirectUri: transaction.redirectUri,
    resource: transaction.resource,
    requestedScopes: transaction.scopes,
    codeChallenge: transaction.codeChallenge,
    codeChallengeMethod: transaction.codeChallengeMethod,
    ...(transaction.state === undefined ? {} : { state: transaction.state }),
  };
}

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    transactionHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    resource: v.string(),
    requestedScopes: v.array(apiScopeValidator),
    codeChallenge: v.string(),
    codeChallengeMethod: oauthCodeChallengeMethodValidator,
    state: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const transactionHash = normalizeOAuthConsentTransactionHash(args.transactionHash);

    if (args.expiresAt <= now || args.expiresAt > now + OAUTH_CONSENT_TRANSACTION_TTL_MS) {
      throw new Error("OAuth consent transaction expiry exceeds the configured lifetime.");
    }

    const existing = await ctx.db
      .query("oauthConsentTransactions")
      .withIndex("by_transactionHash", (index) => index.eq("transactionHash", transactionHash))
      .unique();

    if (existing !== null) {
      throw new Error("OAuth consent transaction collision. Generate a new transaction and retry.");
    }

    const expiredTransactions = await ctx.db
      .query("oauthConsentTransactions")
      .withIndex("by_userId_expiresAt", (index) => index.eq("userId", args.userId).lte("expiresAt", now))
      .take(20);

    await Promise.all(expiredTransactions.map(async (transaction) => await ctx.db.delete(transaction._id)));

    const activeTransactions = await ctx.db
      .query("oauthConsentTransactions")
      .withIndex("by_userId_expiresAt", (index) => index.eq("userId", args.userId).gt("expiresAt", now))
      .take(10);

    if (activeTransactions.length >= 10) {
      throw new Error("Too many active OAuth consent transactions exist for this account.");
    }

    await ctx.db.insert("oauthConsentTransactions", {
      transactionHash,
      userId: args.userId,
      clientId: normalizeOAuthClientId(args.clientId),
      redirectUri: normalizeOAuthRedirectUris([args.redirectUri])[0],
      resource: normalizeOAuthResourceUri(args.resource),
      scopes: normalizeOAuthScopes(args.requestedScopes),
      codeChallenge: normalizeOAuthCodeChallenge(args.codeChallenge),
      codeChallengeMethod: normalizeOAuthCodeChallengeMethod(args.codeChallengeMethod),
      ...(args.state === undefined ? {} : { state: args.state.slice(0, 2048) }),
      createdAt: now,
      expiresAt: Math.floor(args.expiresAt),
    });

    return { ok: true as const, expiresAt: Math.floor(args.expiresAt) };
  },
});

export const get = query({
  args: transactionArgs,
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const transactionHash = normalizeOAuthConsentTransactionHash(args.transactionHash);
    const transaction = await ctx.db
      .query("oauthConsentTransactions")
      .withIndex("by_transactionHash", (index) => index.eq("transactionHash", transactionHash))
      .unique();

    if (oauthConsentTransactionDisposition(transaction, user._id) !== "accepted" || transaction === null) {
      return null;
    }

    return transactionAuthorization(transaction);
  },
});
