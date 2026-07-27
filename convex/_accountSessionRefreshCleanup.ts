import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE = 128;

export async function deleteAuthRefreshTokenBatch(
  ctx: MutationCtx,
  sessionId: Id<"authSessions">,
) {
  const refreshTokens = await ctx.db
    .query("authRefreshTokens")
    .withIndex("sessionIdAndParentRefreshTokenId", (query) =>
      query.eq("sessionId", sessionId),
    )
    .take(AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE);

  for (const refreshToken of refreshTokens) {
    await ctx.db.delete(refreshToken._id);
  }

  return refreshTokens.length === AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE;
}
