import { v } from "convex/values";

import { internalMutation } from "../../../convex/_generated/server";
import { deleteAccountSessionTree } from "../../../convex/_accountSessionLifecycle";

export const store = internalMutation({
  args: {
    args: v.any(),
  },
  handler: async (ctx, input) => {
    const args = input.args as {
      type: string;
      userId?: string;
      except?: string[];
    };

    if (args.type !== "invalidateSessions" || args.userId === undefined) {
      throw new Error("Unsupported auth store operation in session tests.");
    }

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (query) =>
        query.eq("userId", args.userId as never),
      )
      .collect();
    const except = new Set(args.except ?? []);

    for (const session of sessions) {
      if (!except.has(session._id)) {
        await deleteAccountSessionTree(ctx, session._id);
      }
    }

    return null;
  },
});
