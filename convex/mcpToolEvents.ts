import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import {
  mcpToolEventRouteClassValidator,
  mcpToolNameValidator,
} from "./_mcpToolEvents";

const maxRecordedToolInvocationsPerRequest = 50;

export const recordInvocations = internalMutation({
  args: {
    routeClass: mcpToolEventRouteClassValidator,
    toolNames: v.array(mcpToolNameValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const toolNames = args.toolNames.slice(0, maxRecordedToolInvocationsPerRequest);

    for (const toolName of toolNames) {
      await ctx.db.insert("mcpToolEvents", {
        toolName,
        routeClass: args.routeClass,
        eventType: "tool_invocation",
        result: "accepted",
        createdAt: now,
      });
    }

    return { recorded: toolNames.length };
  },
});
