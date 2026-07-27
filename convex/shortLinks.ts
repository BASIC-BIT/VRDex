import { v } from "convex/values";

import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import {
  ensureShortLinkForTarget,
  requireShortLinkReservationPermission,
  resolvePublicShortLinkTarget,
  type ShortLinkTarget,
} from "./_shortLinks";

async function requireAuthenticatedShortLinkActor(ctx: MutationCtx) {
  const { subject, userId } = await requireActiveBrowserSessionSubject(ctx);

  return {
    userId,
    subject,
  };
}

async function ensureAuthorizedShortLink(ctx: MutationCtx, target: ShortLinkTarget) {
  const actor = await requireAuthenticatedShortLinkActor(ctx);

  await requireShortLinkReservationPermission(ctx.db, target, actor);

  return ensureShortLinkForTarget(ctx.db, target, Date.now());
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
    return ensureAuthorizedShortLink(ctx, { targetType: "profile", targetId: args.profileId });
  },
});

export const ensureForWorld = mutation({
  args: {
    worldId: v.id("worlds"),
  },
  handler: async (ctx, args) => {
    return ensureAuthorizedShortLink(ctx, { targetType: "world", targetId: args.worldId });
  },
});

export const ensureForEvent = mutation({
  args: {
    eventId: v.id("events"),
  },
  handler: async (ctx, args) => {
    return ensureAuthorizedShortLink(ctx, { targetType: "event", targetId: args.eventId });
  },
});
