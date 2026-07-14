import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { seedImportAuthSubjectValidator } from "./_seedImportValidators";

const accountFeatureValidator = v.union(
  v.literal("super_admin"),
  v.literal("view_private_seed_lookup"),
);

function optionalAuditText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 500) : undefined;
}

export const grant = internalMutation({
  args: {
    userId: v.id("users"),
    feature: accountFeatureValidator,
    grantedBy: seedImportAuthSubjectValidator,
    expiresAt: v.optional(v.number()),
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();

    if (await ctx.db.get(args.userId) === null) {
      throw new Error("Account not found.");
    }

    if (args.expiresAt !== undefined && args.expiresAt <= now) {
      throw new Error("Feature grant expiry must be in the future.");
    }

    const activeGrants = await ctx.db
      .query("accountFeatureGrants")
      .withIndex("by_userId_feature_state", (query) =>
        query
          .eq("userId", args.userId)
          .eq("feature", args.feature)
          .eq("state", "active"),
      )
      .collect();
    const existing = activeGrants.find(
      (grant) => grant.expiresAt === undefined || grant.expiresAt > now,
    );

    if (existing !== undefined) {
      return { inserted: false as const, grantId: existing._id };
    }

    const reason = optionalAuditText(args.reason);
    const grantId = await ctx.db.insert("accountFeatureGrants", {
      userId: args.userId,
      feature: args.feature,
      state: "active",
      grantedBy: args.grantedBy,
      grantedAt: now,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      ...(reason !== undefined ? { reason } : {}),
      updatedAt: now,
    });

    return { inserted: true as const, grantId };
  },
});

export const revoke = internalMutation({
  args: {
    userId: v.id("users"),
    feature: accountFeatureValidator,
    revokedBy: seedImportAuthSubjectValidator,
    reason: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const revokeReason = optionalAuditText(args.reason);
    const activeGrants = await ctx.db
      .query("accountFeatureGrants")
      .withIndex("by_userId_feature_state", (query) =>
        query
          .eq("userId", args.userId)
          .eq("feature", args.feature)
          .eq("state", "active"),
      )
      .collect();

    await Promise.all(
      activeGrants.map((grant) =>
        ctx.db.patch(grant._id, {
          state: "revoked",
          revokedBy: args.revokedBy,
          revokedAt: now,
          ...(revokeReason !== undefined ? { revokeReason } : {}),
          updatedAt: now,
        }),
      ),
    );

    return { revokedCount: activeGrants.length };
  },
});
