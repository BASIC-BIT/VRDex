import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { markOpsResolved, reserveOpsAlert } from "./_opsAlerts";

// Action-side paths for notifyOps and resolveOps.
export const reserve = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }): Promise<boolean> => reserveOpsAlert(ctx.db, key, Date.now()),
});

export const resolve = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }): Promise<boolean> => markOpsResolved(ctx.db, key, Date.now()),
});
