import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import {
  mcpToolEventResultValidator,
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

export const recordWriteInvocation = internalMutation({
  args: {
    idempotencyKeyHash: v.string(),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    ownerUserId: v.id("users"),
    requestId: v.string(),
    result: mcpToolEventResultValidator,
    targetEventId: v.optional(v.id("events")),
    toolName: v.union(
      v.literal("vrdex_event_create"),
      v.literal("vrdex_event_update"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpToolEvents", {
      toolName: args.toolName,
      routeClass: "authenticated_mcp_write",
      eventType: "tool_invocation",
      result: args.result,
      ownerUserId: args.ownerUserId,
      oauthClientId: args.oauthClientId,
      oauthTokenId: args.oauthTokenId,
      requestId: args.requestId,
      idempotencyKeyHash: args.idempotencyKeyHash,
      ...(args.targetEventId === undefined ? {} : { targetEventId: args.targetEventId }),
      createdAt: Date.now(),
    });

    return { recorded: 1 };
  },
});
