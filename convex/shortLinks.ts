import { v } from "convex/values";

import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  ensureShortLinkForTarget,
  resolvePublicShortLinkTarget,
} from "./_shortLinks";

async function requireAuthenticatedShortLinkWriter(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new Error("Short link generation requires a signed-in user.");
  }
}

export const resolvePublicByCode = query({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => resolvePublicShortLinkTarget(ctx.db, args.code),
});

export const ensureForProfile = mutation({
  args: {
    profileId: v.id("profiles"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedShortLinkWriter(ctx);

    return ensureShortLinkForTarget(
      ctx.db,
      { targetType: "profile", targetId: args.profileId },
      Date.now(),
    );
  },
});

export const ensureForWorld = mutation({
  args: {
    worldId: v.id("worlds"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedShortLinkWriter(ctx);

    return ensureShortLinkForTarget(
      ctx.db,
      { targetType: "world", targetId: args.worldId },
      Date.now(),
    );
  },
});

export const ensureForEvent = mutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    await requireAuthenticatedShortLinkWriter(ctx);

    return ensureShortLinkForTarget(
      ctx.db,
      { targetType: "event", targetId: args.eventId },
      Date.now(),
    );
  },
});
