import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCurrentUser, requireCurrentUser } from "./accounts";
import {
  apiRouteClassValidator,
  apiScopeValidator,
  apiTokenValidationEventMetadata,
  apiTokenHashVersion,
  hasRequiredApiScopes,
  normalizeApiTokenExpiry,
  normalizeApiTokenLabel,
  normalizeApiTokenPrefix,
  normalizeApiTokenRevokeReason,
  normalizeApiTokenScopes,
  normalizeApiTokenVerifierHash,
  validateApiTokenRecord,
} from "./_apiTokens";

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(value), max));
}

function toTokenSummary(token: Doc<"apiTokens">) {
  return {
    id: token._id,
    tokenPrefix: token.tokenPrefix,
    ownerKind: token.ownerKind,
    ownerUserId: token.ownerUserId,
    ownerCommunityProfileId: token.ownerCommunityProfileId,
    label: token.label,
    scopes: token.scopes,
    status: token.status,
    trustTier: token.trustTier,
    expiresAt: token.expiresAt,
    createdAt: token.createdAt,
    updatedAt: token.updatedAt,
    lastUsedAt: token.lastUsedAt,
    lastUsedRouteClass: token.lastUsedRouteClass,
    revokedAt: token.revokedAt,
    revokeReason: token.revokeReason,
  };
}

async function listUserOwnedTokenSummaries(
  ctx: QueryCtx,
  args: {
    includeRevoked?: boolean;
    limit?: number;
    ownerUserId: Doc<"users">["_id"];
  },
) {
  const limit = boundedLimit(args.limit, 50, 100);
  const tokens =
    args.includeRevoked === true
      ? await ctx.db
          .query("apiTokens")
          .withIndex("by_ownerKind_ownerUserId_createdAt", (index) =>
            index.eq("ownerKind", "user").eq("ownerUserId", args.ownerUserId),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("apiTokens")
          .withIndex("by_ownerKind_ownerUserId_status_createdAt", (index) =>
            index.eq("ownerKind", "user").eq("ownerUserId", args.ownerUserId).eq("status", "active"),
          )
          .order("desc")
          .take(limit);

  return tokens
    .map(toTokenSummary);
}

async function recordApiTokenEvent(
  ctx: MutationCtx,
  args: {
    token?: Doc<"apiTokens">;
    tokenPrefix?: string;
    routeClass: Doc<"apiTokenEvents">["routeClass"];
    eventType: Doc<"apiTokenEvents">["eventType"];
    result: Doc<"apiTokenEvents">["result"];
    requiredScopes: Doc<"apiTokenEvents">["requiredScopes"];
    grantedScopes?: Doc<"apiTokenEvents">["grantedScopes"];
    statusCodeClass?: Doc<"apiTokenEvents">["statusCodeClass"];
    now: number;
  },
) {
  const tokenPrefix = args.token?.tokenPrefix ?? args.tokenPrefix;

  await ctx.db.insert("apiTokenEvents", {
    ...(args.token === undefined ? {} : { tokenId: args.token._id }),
    ...(tokenPrefix === undefined ? {} : { tokenPrefix }),
    ...(args.token === undefined ? {} : { ownerKind: args.token.ownerKind }),
    ...(args.token === undefined ? {} : { ownerUserId: args.token.ownerUserId }),
    ...(args.token?.ownerCommunityProfileId === undefined
      ? {}
      : { ownerCommunityProfileId: args.token.ownerCommunityProfileId }),
    routeClass: args.routeClass,
    eventType: args.eventType,
    result: args.result,
    requiredScopes: args.requiredScopes,
    ...(args.grantedScopes === undefined ? {} : { grantedScopes: args.grantedScopes }),
    ...(args.statusCodeClass === undefined ? {} : { statusCodeClass: args.statusCodeClass }),
    createdAt: args.now,
  });
}

async function revokeUserOwnedToken(
  ctx: MutationCtx,
  args: {
    ownerUserId: Doc<"users">["_id"];
    reason?: string;
    tokenId: Doc<"apiTokens">["_id"];
  },
) {
  const token = await ctx.db.get(args.tokenId);

  if (token === null || token.ownerKind !== "user" || token.ownerUserId !== args.ownerUserId) {
    return { ok: false as const, reason: "not_found" as const };
  }

  if (token.status === "revoked") {
    return { ok: true as const, token: toTokenSummary(token) };
  }

  const now = Date.now();
  const revokeReason = normalizeApiTokenRevokeReason(args.reason);
  const patch = {
    status: "revoked" as const,
    revokedAt: now,
    revokedByUserId: args.ownerUserId,
    updatedAt: now,
    ...(revokeReason !== undefined ? { revokeReason } : {}),
  };

  await ctx.db.patch(token._id, patch);
  const updatedToken = { ...token, ...patch };

  await recordApiTokenEvent(ctx, {
    token: updatedToken,
    routeClass: "developer_credential_management",
    eventType: "revoked",
    result: "accepted",
    requiredScopes: [],
    grantedScopes: updatedToken.scopes,
    now,
  });

  return { ok: true as const, token: toTokenSummary(updatedToken) };
}

async function createUserOwnedToken(
  ctx: MutationCtx,
  args: {
    expiresAt?: number;
    label: string;
    ownerUserId: Doc<"users">["_id"];
    scopes?: Doc<"apiTokens">["scopes"];
    tokenPrefix: string;
    verifierHash: string;
  },
) {
  const now = Date.now();
  const tokenPrefix = normalizeApiTokenPrefix(args.tokenPrefix);
  const verifierHash = normalizeApiTokenVerifierHash(args.verifierHash);
  const label = normalizeApiTokenLabel(args.label);
  const scopes = normalizeApiTokenScopes(args.scopes);
  const expiresAt = normalizeApiTokenExpiry(args.expiresAt, now);
  const existingToken = await ctx.db
    .query("apiTokens")
    .withIndex("by_tokenPrefix", (index) => index.eq("tokenPrefix", tokenPrefix))
    .unique();

  if (existingToken !== null) {
    throw new Error("API token prefix collision. Generate a new token and retry.");
  }

  const tokenId = await ctx.db.insert("apiTokens", {
    tokenPrefix,
    verifierHash,
    hashVersion: apiTokenHashVersion,
    ownerKind: "user",
    ownerUserId: args.ownerUserId,
    label,
    scopes,
    status: "active",
    trustTier: "personal",
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    createdAt: now,
    updatedAt: now,
  });
  const token = await ctx.db.get(tokenId);

  if (token === null) {
    throw new Error("API token creation failed.");
  }

  await recordApiTokenEvent(ctx, {
    token,
    routeClass: "developer_credential_management",
    eventType: "created",
    result: "accepted",
    requiredScopes: [],
    grantedScopes: scopes,
    now,
  });

  return toTokenSummary(token);
}

export const listPersonalTokens = query({
  args: {
    includeRevoked: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return await listUserOwnedTokenSummaries(ctx, { ...args, ownerUserId: user._id });
  },
});

export const listDeveloperTokensForApiOwner = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    includeRevoked: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await listUserOwnedTokenSummaries(ctx, args);
  },
});

export const createPersonalToken = mutation({
  args: {
    tokenPrefix: v.string(),
    verifierHash: v.string(),
    label: v.string(),
    scopes: v.optional(v.array(apiScopeValidator)),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    return await createUserOwnedToken(ctx, { ...args, ownerUserId: user._id });
  },
});

export const createDeveloperTokenForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    tokenPrefix: v.string(),
    verifierHash: v.string(),
    label: v.string(),
    scopes: v.optional(v.array(apiScopeValidator)),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await createUserOwnedToken(ctx, args);
  },
});

export const revokeDeveloperTokenForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    tokenId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tokenId = ctx.db.normalizeId("apiTokens", args.tokenId);

    if (tokenId === null) {
      return { ok: false as const, reason: "not_found" as const };
    }

    return await revokeUserOwnedToken(ctx, { ...args, tokenId });
  },
});

export const revokePersonalToken = mutation({
  args: {
    tokenId: v.id("apiTokens"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const result = await revokeUserOwnedToken(ctx, {
      ownerUserId: user._id,
      tokenId: args.tokenId,
      reason: args.reason,
    });

    if (!result.ok) {
      throw new Error("API token was not found for the current account.");
    }

    return result.token;
  },
});

export const validateBearerTokenHash = internalMutation({
  args: {
    tokenPrefix: v.string(),
    verifierHash: v.string(),
    requiredScopes: v.optional(v.array(apiScopeValidator)),
    routeClass: apiRouteClassValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenPrefix = normalizeApiTokenPrefix(args.tokenPrefix);
    const verifierHash = normalizeApiTokenVerifierHash(args.verifierHash);
    const requiredScopes = normalizeApiTokenScopes(args.requiredScopes);
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_tokenPrefix", (index) => index.eq("tokenPrefix", tokenPrefix))
      .unique();
    const result = validateApiTokenRecord(token, {
      verifierHash,
      requiredScopes,
      now,
    });
    const eventMetadata = apiTokenValidationEventMetadata(result);

    if (!result.ok) {
      await recordApiTokenEvent(ctx, {
        ...(token !== null && token.tokenPrefix === tokenPrefix ? { token } : { tokenPrefix }),
        routeClass: args.routeClass,
        eventType: eventMetadata.eventType,
        result: eventMetadata.result,
        requiredScopes,
        grantedScopes: token?.scopes,
        statusCodeClass: eventMetadata.statusCodeClass,
        now,
      });

      return result;
    }

    if (!hasRequiredApiScopes(result.scopes, requiredScopes)) {
      throw new Error("API token scope validation mismatch.");
    }

    await ctx.db.patch(result.tokenId, {
      lastUsedAt: now,
      lastUsedRouteClass: args.routeClass,
      updatedAt: now,
    });

    await recordApiTokenEvent(ctx, {
      token: token as Doc<"apiTokens">,
      routeClass: args.routeClass,
      eventType: eventMetadata.eventType,
      result: eventMetadata.result,
      requiredScopes,
      grantedScopes: result.scopes,
      statusCodeClass: eventMetadata.statusCodeClass,
      now,
    });

    return result;
  },
});
