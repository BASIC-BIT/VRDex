import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteAuthRefreshTokenBatch } from "./_accountSessionRefreshCleanup";

export async function deleteAccountSessionTree(
  ctx: MutationCtx,
  sessionId: Id<"authSessions">,
) {
  const session = await ctx.db.get(sessionId);

  if (session === null) {
    return false;
  }

  await ctx.db.delete(sessionId);
  const hasMore = await deleteAuthRefreshTokenBatch(ctx, sessionId);

  if (hasMore) {
    await ctx.scheduler.runAfter(
      0,
      internal.accountSessionCleanup.deleteRefreshTokenBatch,
      { sessionId },
    );
  }

  return true;
}

export async function deleteAccountSessionRecordAndScheduleCleanup(
  ctx: MutationCtx,
  sessionId: Id<"authSessions">,
) {
  const session = await ctx.db.get(sessionId);

  if (session === null) {
    return false;
  }

  await ctx.db.delete(sessionId);
  await ctx.scheduler.runAfter(
    0,
    internal.accountSessionCleanup.deleteRefreshTokenBatch,
    { sessionId },
  );
  return true;
}
