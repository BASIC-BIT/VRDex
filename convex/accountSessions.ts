import {
  getAuthSessionId,
  getAuthUserId,
} from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  deleteAccountSessionRecordAndScheduleCleanup,
  deleteAccountSessionTree,
} from "./_accountSessionLifecycle";
import {
  activeAuthSessionStatusAt,
  requireActiveAuthSession,
  requireRecentAuthSession,
} from "./_authSessionGuard";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const [userId, sessionId] = await Promise.all([
      getAuthUserId(ctx),
      getAuthSessionId(ctx),
    ]);

    if (userId === null || sessionId === null) {
      return {
        state: "anonymous" as const,
        sessions: [],
      };
    }

    const currentSession = await ctx.db.get(sessionId);
    const state = activeAuthSessionStatusAt({
      now: Date.now(),
      session: currentSession,
      userId,
    });

    if (state !== "active") {
      return {
        state: "revoked" as const,
        sessions: [],
      };
    }

    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (sessionQuery) => sessionQuery.eq("userId", userId))
      .collect();
    const now = Date.now();
    const sessionRows = (
      await Promise.all(
        sessions.map(async (session) => {
          if (session.expirationTime <= now) {
            return null;
          }

          const [latestRefreshToken, activeRefreshToken] = await Promise.all([
            ctx.db
              .query("authRefreshTokens")
              .withIndex("sessionId", (refreshQuery) =>
                refreshQuery.eq("sessionId", session._id),
              )
              .order("desc")
              .first(),
            ctx.db
              .query("authRefreshTokens")
              .withIndex(
                "by_sessionId_firstUsedTime_expirationTime",
                (refreshQuery) =>
                  refreshQuery
                    .eq("sessionId", session._id)
                    .eq("firstUsedTime", undefined)
                    .gt("expirationTime", now),
              )
              .first(),
          ]);

          return {
            id: session._id,
            current: session._id === sessionId,
            createdAt: session._creationTime,
            expiresAt: session.expirationTime,
            lastActiveAt:
              latestRefreshToken?._creationTime ?? session._creationTime,
            status:
              activeRefreshToken === null
                ? ("expiring" as const)
                : ("active" as const),
          };
        }),
      )
    ).filter((session) => session !== null);

    sessionRows.sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }

      return right.lastActiveAt - left.lastActiveAt;
    });

    return {
      state: "active" as const,
      sessions: sessionRows,
    };
  },
});

export const revokeMine = mutation({
  args: {
    sessionId: v.id("authSessions"),
  },
  handler: async (ctx, args) => {
    const activeSession = await requireActiveAuthSession(ctx);
    const target = await ctx.db.get(args.sessionId);

    if (target === null || target.userId !== activeSession.userId) {
      return {
        current: false,
        revoked: false,
      };
    }

    if (args.sessionId !== activeSession.sessionId) {
      await requireRecentAuthSession(ctx);
    }

    return {
      current: args.sessionId === activeSession.sessionId,
      revoked: await deleteAccountSessionTree(ctx, args.sessionId),
    };
  },
});

export const ACCOUNT_SESSION_REVOCATION_BATCH_SIZE = 16;

async function revokeOwnedSessionBatch(
  ctx: MutationCtx,
  args: {
    preserveSessionId?: Id<"authSessions">;
    throughCreationTime: number;
    userId: Id<"users">;
  },
) {
  const candidates = await ctx.db
    .query("authSessions")
    .withIndex("userId", (sessionQuery) =>
      sessionQuery
        .eq("userId", args.userId)
        .lte("_creationTime", args.throughCreationTime),
    )
    .take(ACCOUNT_SESSION_REVOCATION_BATCH_SIZE + 2);
  const targets = candidates
    .filter((session) => session._id !== args.preserveSessionId)
    .slice(0, ACCOUNT_SESSION_REVOCATION_BATCH_SIZE);

  for (const target of targets) {
    await deleteAccountSessionRecordAndScheduleCleanup(ctx, target._id);
  }

  if (
    candidates.filter(
      (session) => session._id !== args.preserveSessionId,
    ).length > ACCOUNT_SESSION_REVOCATION_BATCH_SIZE
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.accountSessions.continueOwnedSessionRevocation,
      args,
    );
  }
}

export const continueOwnedSessionRevocation = internalMutation({
  args: {
    preserveSessionId: v.optional(v.id("authSessions")),
    throughCreationTime: v.number(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await revokeOwnedSessionBatch(ctx, args);
  },
});

export const authorizeAndBeginOwnedSessionRevocation = internalMutation({
  args: {
    mode: v.union(v.literal("all"), v.literal("others")),
  },
  handler: async (ctx, args) => {
    const activeSession = await requireRecentAuthSession(ctx);
    const newestOwnedSession = await ctx.db
      .query("authSessions")
      .withIndex("userId", (sessionQuery) =>
        sessionQuery.eq("userId", activeSession.userId),
      )
      .order("desc")
      .first();
    const throughCreationTime =
      newestOwnedSession?._creationTime ??
      activeSession.session._creationTime;
    const preserveSessionId =
      args.mode === "others"
        ? activeSession.sessionId
        : undefined;

    if (preserveSessionId === undefined) {
      await deleteAccountSessionRecordAndScheduleCleanup(
        ctx,
        activeSession.sessionId,
      );
    }

    await revokeOwnedSessionBatch(ctx, {
      preserveSessionId,
      throughCreationTime,
      userId: activeSession.userId,
    });
  },
});

export const revokeOthers = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(
      internal.accountSessions.authorizeAndBeginOwnedSessionRevocation,
      { mode: "others" },
    );
    return null;
  },
});

export const revokeAll = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(
      internal.accountSessions.authorizeAndBeginOwnedSessionRevocation,
      { mode: "all" },
    );
    return null;
  },
});
