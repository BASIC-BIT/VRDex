import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { summarizeApiPlatformEventRows } from "./_apiPlatformObservability";
import { apiRouteClassValues } from "./_apiTokens";
import { internalQuery } from "./_generated/server";
import { mcpToolEventRouteClassValues } from "./_mcpToolEvents";

const defaultWindowMs = 24 * 60 * 60 * 1_000;
const maxWindowMs = 30 * 24 * 60 * 60 * 1_000;

function boundedSince(args: { now: number; since?: number; windowMs?: number }) {
  if (args.since !== undefined && Number.isFinite(args.since)) {
    return Math.floor(args.since);
  }

  const windowMs =
    args.windowMs !== undefined && Number.isFinite(args.windowMs)
      ? Math.max(1_000, Math.min(Math.floor(args.windowMs), maxWindowMs))
      : defaultWindowMs;

  return args.now - windowMs;
}

export const summary = internalQuery({
  args: {
    now: v.optional(v.number()),
    since: v.optional(v.number()),
    windowMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Math.floor(args.now ?? Date.now());
    const since = boundedSince({ now, since: args.since, windowMs: args.windowMs });
    const apiRateLimitEvents: Doc<"apiRateLimitEvents">[] = [];
    const apiTokenEvents: Doc<"apiTokenEvents">[] = [];
    const apiWriteAuditEvents: Doc<"apiWriteAuditEvents">[] = [];
    const oauthClientEvents: Doc<"oauthClientEvents">[] = [];
    const mcpToolEvents: Doc<"mcpToolEvents">[] = [];

    for (const routeClass of apiRouteClassValues) {
      apiRateLimitEvents.push(
        ...(await ctx.db
          .query("apiRateLimitEvents")
          .withIndex("by_routeClass_createdAt", (query) =>
            query.eq("routeClass", routeClass).gte("createdAt", since),
          )
          .collect()),
      );
      apiTokenEvents.push(
        ...(await ctx.db
          .query("apiTokenEvents")
          .withIndex("by_routeClass_createdAt", (query) =>
            query.eq("routeClass", routeClass).gte("createdAt", since),
          )
          .collect()),
      );
      apiWriteAuditEvents.push(
        ...(await ctx.db
          .query("apiWriteAuditEvents")
          .withIndex("by_routeClass_createdAt", (query) =>
            query.eq("routeClass", routeClass).gte("createdAt", since),
          )
          .collect()),
      );
      oauthClientEvents.push(
        ...(await ctx.db
          .query("oauthClientEvents")
          .withIndex("by_routeClass_createdAt", (query) =>
            query.eq("routeClass", routeClass).gte("createdAt", since),
          )
          .collect()),
      );
    }

    for (const routeClass of mcpToolEventRouteClassValues) {
      mcpToolEvents.push(
        ...(await ctx.db
          .query("mcpToolEvents")
          .withIndex("by_routeClass_createdAt", (query) =>
            query.eq("routeClass", routeClass).gte("createdAt", since),
          )
          .collect()),
      );
    }

    return {
      generatedAt: now,
      since,
      ...summarizeApiPlatformEventRows({
        apiRateLimitEvents,
        apiTokenEvents,
        apiWriteAuditEvents,
        mcpToolEvents,
        oauthClientEvents,
      }),
    };
  },
});
