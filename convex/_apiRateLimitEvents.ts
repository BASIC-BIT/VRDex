import { v } from "convex/values";

export const apiRateLimitEventIdentityKindValidator = v.union(
  v.literal("api_token"),
  v.literal("ip"),
  v.literal("oauth_client"),
);

export const apiRateLimitEventQuotaTierValidator = v.union(
  v.literal("standard"),
  v.literal("trusted_partner"),
);

export const apiRateLimitEventTypeValidator = v.literal("rate_limit_blocked");

export type ApiRateLimitEventIdentityKind = "api_token" | "ip" | "oauth_client";
export type ApiRateLimitEventQuotaTier = "standard" | "trusted_partner";
