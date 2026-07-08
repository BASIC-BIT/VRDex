import { v } from "convex/values";

import { apiRouteClassValidator } from "./_apiTokens";
import {
  apiRateLimitEventIdentityKindValidator,
  apiRateLimitEventQuotaTierValidator,
} from "./_apiRateLimitEvents";
import { internalMutation } from "./_generated/server";

export const recordBlocked = internalMutation({
  args: {
    identityKind: apiRateLimitEventIdentityKindValidator,
    limit: v.number(),
    quotaTier: apiRateLimitEventQuotaTierValidator,
    remaining: v.number(),
    resetAt: v.number(),
    retryAfterSeconds: v.number(),
    routeClass: apiRouteClassValidator,
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("apiRateLimitEvents", {
      routeClass: args.routeClass,
      identityKind: args.identityKind,
      quotaTier: args.quotaTier,
      eventType: "rate_limit_blocked",
      limit: args.limit,
      remaining: args.remaining,
      retryAfterSeconds: args.retryAfterSeconds,
      resetAt: args.resetAt,
      windowMs: args.windowMs,
      createdAt: Date.now(),
    });
  },
});
