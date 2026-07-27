import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { deleteAuthRefreshTokenBatch } from "./_accountSessionRefreshCleanup";

export const deleteRefreshTokenBatch = internalMutation({
  args: {
    sessionId: v.id("authSessions"),
  },
  handler: async (ctx, args) => {
    const hasMore = await deleteAuthRefreshTokenBatch(
      ctx,
      args.sessionId,
    );

    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        internal.accountSessionCleanup.deleteRefreshTokenBatch,
        args,
      );
    }
  },
});
