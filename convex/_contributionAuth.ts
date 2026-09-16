import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { isCurrentEmailVerificationAttestation } from "./_identity";
export const contributionAuthorityArgs = {
  actorUserId: v.id("users"),
  oauthClientId: v.string(),
  oauthTokenId: v.string(),
  emailVerified: v.boolean(),
  emailVerificationAttestedAt: v.number(),
};
export type ContributionAuthority = {
  actorUserId: Id<"users">;
  oauthClientId: string;
  oauthTokenId: string;
  emailVerified: boolean;
  emailVerificationAttestedAt: number;
};
export async function assertLiveContributionToken(
  ctx: QueryCtx | MutationCtx,
  actorUserId: Id<"users">,
  clientId: string,
  tokenId: string,
) {
  const token = await ctx.db
    .query("oauthAccessTokens")
    .withIndex("by_tokenId", (q) => q.eq("tokenId", tokenId))
    .unique();
  if (
    !token ||
    token.userId !== actorUserId ||
    token.subjectType !== "user" ||
    token.clientId !== clientId ||
    token.status !== "active" ||
    token.expiresAt <= Date.now() ||
    !token.scopes.includes("mcp:write") ||
    !token.scopes.includes("assets:contribute")
  )
    throw new ConvexError({ code: "CONTRIBUTION_DELEGATION_DENIED" });
  if (
    token.applicationId &&
    (await ctx.db.get(token.applicationId))?.status !== "active"
  )
    throw new ConvexError({ code: "CONTRIBUTION_DELEGATION_DENIED" });
  if (
    token.dynamicClientId &&
    (await ctx.db.get(token.dynamicClientId))?.status !== "active"
  )
    throw new ConvexError({ code: "CONTRIBUTION_DELEGATION_DENIED" });
}
export async function authorizeContribution(
  ctx: QueryCtx | MutationCtx,
  args: ContributionAuthority,
  write: boolean,
  scope?: "profile:contribute" | "assets:contribute",
  intake = write,
) {
  if (
    intake &&
    (process.env.VRDEX_CONTRIBUTION_BATCHES_ENABLED !== "true" ||
      process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED === "true")
  )
    throw new ConvexError({ code: "BATCH_DISABLED" });
  if (
    !args.emailVerified ||
    !isCurrentEmailVerificationAttestation(args.emailVerificationAttestedAt) ||
    !(await ctx.db.get(args.actorUserId))
  )
    throw new ConvexError({ code: "BATCH_ACTOR_DENIED" });
  const token = await ctx.db
    .query("oauthAccessTokens")
    .withIndex("by_tokenId", (q) => q.eq("tokenId", args.oauthTokenId))
    .unique();
  if (
    !token ||
    token.subjectType !== "user" ||
    token.userId !== args.actorUserId ||
    token.clientId !== args.oauthClientId ||
    token.status !== "active" ||
    token.expiresAt <= Date.now() ||
    !token.scopes.includes(write ? "mcp:write" : "mcp:read") ||
    (scope && !token.scopes.includes(scope))
  )
    throw new ConvexError({ code: "BATCH_DELEGATION_DENIED" });
  if (
    !token.scopes.some(
      (s) =>
        s === "profile:contribute" ||
        s === "assets:contribute" ||
        (!write && s === "assets:review:read"),
    )
  )
    throw new ConvexError({ code: "BATCH_DELEGATION_DENIED" });
  if (
    token.applicationId &&
    (await ctx.db.get(token.applicationId))?.status !== "active"
  )
    throw new ConvexError({ code: "BATCH_DELEGATION_DENIED" });
  if (
    token.dynamicClientId &&
    (await ctx.db.get(token.dynamicClientId))?.status !== "active"
  )
    throw new ConvexError({ code: "BATCH_DELEGATION_DENIED" });
  return token;
}
