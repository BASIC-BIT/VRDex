import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { mcpWriteToolNameValidator } from "./_apiWriteAuditEvents";
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
    actorUserId: v.optional(v.id("users")),
    idempotencyKeyHash: v.optional(v.string()),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    ownerUserId: v.optional(v.id("users")),
    requestId: v.string(),
    result: mcpToolEventResultValidator,
    targetEventId: v.optional(v.id("events")),
    targetProfileId: v.optional(v.id("profiles")),
    toolName: mcpWriteToolNameValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpToolEvents", {
      toolName: args.toolName,
      routeClass: "authenticated_mcp_write",
      eventType: "tool_invocation",
      result: args.result,
      ...(args.actorUserId === undefined ? {} : { actorUserId: args.actorUserId }),
      ...(args.ownerUserId === undefined ? {} : { ownerUserId: args.ownerUserId }),
      oauthClientId: args.oauthClientId,
      oauthTokenId: args.oauthTokenId,
      requestId: args.requestId,
      ...(args.idempotencyKeyHash === undefined
        ? {}
        : { idempotencyKeyHash: args.idempotencyKeyHash }),
      ...(args.targetEventId === undefined ? {} : { targetEventId: args.targetEventId }),
      ...(args.targetProfileId === undefined ? {} : { targetProfileId: args.targetProfileId }),
      createdAt: Date.now(),
    });

    return { recorded: 1 };
  },
});

export const recordOwnedReadInvocation = internalMutation({
  args: {
    actorUserId: v.id("users"),
    oauthClientId: v.string(),
    oauthTokenId: v.string(),
    requestId: v.string(),
    result: mcpToolEventResultValidator,
    toolName: v.literal("vrdex_list_my_media_submissions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpToolEvents", {
      toolName: args.toolName,
      routeClass: "authenticated_mcp",
      eventType: "tool_invocation",
      result: args.result,
      actorUserId: args.actorUserId,
      oauthClientId: args.oauthClientId,
      oauthTokenId: args.oauthTokenId,
      requestId: args.requestId,
      createdAt: Date.now(),
    });

    return { recorded: 1 };
  },
});
