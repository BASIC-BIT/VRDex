import {
  getAuthSessionId,
  getAuthUserId,
} from "@convex-dev/auth/server";
import { v } from "convex/values";

import {
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import type {
  Doc,
  Id,
} from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deleteAccountSessionTree } from "./_accountSessionLifecycle";
import { AUTH_SESSION_TOTAL_DURATION_MS } from "./_authSession";
import {
  RECENT_AUTH_MAX_AGE_MS,
  requireActiveAuthSession,
} from "./_authSessionGuard";
import { activeBrowserSessionOrNull } from "./_browserSessionAuthority";

const CHALLENGE_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_CHALLENGES_PER_SESSION = 8;
const actionClassValidator = v.union(
  v.literal("developer_oauth_application"),
  v.literal("developer_token"),
  v.literal("session_revocation"),
);

async function completedSiblingProtectsSession(
  ctx: MutationCtx,
  challenge: Doc<"recentAuthChallenges">,
  sessionId: Id<"authSessions">,
) {
  const siblings = await ctx.db
    .query("recentAuthChallenges")
    .withIndex("by_originalSessionId", (query) =>
      query.eq("originalSessionId", challenge.originalSessionId),
    )
    .collect();

  return siblings.some(
    (sibling) =>
      sibling._id !== challenge._id &&
      sibling.userId === challenge.userId &&
      sibling.completedAt !== undefined &&
      sibling.completedSessionId === sessionId,
  );
}

async function passwordChallengeForCaller(
  ctx: Parameters<typeof activeBrowserSessionOrNull>[0],
  challengeId: string,
) {
  const [active, presentedSessionId, presentedUserId] =
    await Promise.all([
      activeBrowserSessionOrNull(ctx),
      getAuthSessionId(ctx),
      getAuthUserId(ctx),
    ]);
  const challenge = await ctx.db
    .query("recentAuthChallenges")
    .withIndex("by_challengeId", (query) =>
      query.eq("challengeId", challengeId),
    )
    .unique();
  if (
    challenge === null ||
    challenge.completedAt !== undefined ||
    challenge.expiresAt <= Date.now() ||
    challenge.proofClaimedAt !== undefined
  ) {
    return null;
  }
  const siblings = await ctx.db
    .query("recentAuthChallenges")
    .withIndex("by_originalSessionId", (query) =>
      query.eq("originalSessionId", challenge.originalSessionId),
    )
    .collect();
  const replacementSessionId = siblings.find(
    (sibling) =>
      sibling.userId === challenge.userId &&
      sibling.authenticatedSessionId !== undefined,
  )?.authenticatedSessionId;
  const replacementSession =
    replacementSessionId === undefined
      ? null
      : await ctx.db.get(replacementSessionId);
  const exactActiveOriginal =
    active !== null &&
    active.userId === challenge.userId &&
    active.sessionId === challenge.originalSessionId;
  const convergingSibling =
    replacementSession !== null &&
    replacementSession.userId === challenge.userId &&
    ((active !== null &&
      active.userId === challenge.userId &&
      active.sessionId === replacementSession._id) ||
      (presentedUserId === challenge.userId &&
        presentedSessionId === challenge.originalSessionId));

  if (!exactActiveOriginal && !convergingSibling) {
    return null;
  }
  return {
    active,
    challenge,
    replacementSession,
  };
}

export const begin = mutation({
  args: {
    actionClass: actionClassValidator,
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const active = await activeBrowserSessionOrNull(ctx);
    if (active === null) {
      return { state: "invalid" as const };
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("recentAuthChallenges")
      .withIndex("by_originalSessionId", (query) =>
        query.eq("originalSessionId", active.sessionId),
      )
      .collect();
    const live = [];
    const prunedChallengeIds: string[] = [];

    for (const challenge of existing) {
      if (challenge.expiresAt <= now) {
        await ctx.db.delete(challenge._id);
      } else {
        live.push(challenge);
      }
    }
    live.sort((left, right) => left._creationTime - right._creationTime);
    while (live.length >= MAX_CHALLENGES_PER_SESSION) {
      const oldest = live.shift();
      if (oldest === undefined) {
        break;
      }
      prunedChallengeIds.push(oldest.challengeId);
      await ctx.db.delete(oldest._id);
    }

    await ctx.db.insert("recentAuthChallenges", {
      actionClass: args.actionClass,
      challengeId: args.challengeId,
      expiresAt: now + CHALLENGE_LIFETIME_MS,
      originalSessionId: active.sessionId,
      userId: active.userId,
    });
    return {
      originalSessionId: active.sessionId,
      prunedChallengeIds,
      state: "created" as const,
      userId: active.userId,
    };
  },
});

export const expireAbandoned = internalMutation({
  args: {},
  handler: async (ctx) => {
    const challenges = await ctx.db
      .query("recentAuthChallenges")
      .withIndex("by_expiresAt", (query) =>
        query.lt("expiresAt", Date.now()),
      )
      .take(256);
    for (const challenge of challenges) {
      await ctx.db.delete(challenge._id);
    }
    return challenges.length;
  },
});

export const cancel = mutation({
  args: {
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const active = await requireActiveAuthSession(ctx);
    const challenge = await ctx.db
      .query("recentAuthChallenges")
      .withIndex("by_challengeId", (query) =>
        query.eq("challengeId", args.challengeId),
      )
      .unique();

    if (
      challenge !== null &&
      challenge.userId === active.userId
    ) {
      await ctx.db.delete(challenge._id);
    }
    return null;
  },
});

export const fail = mutation({
  args: {
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const active = await requireActiveAuthSession(ctx);
    const challenge = await ctx.db
      .query("recentAuthChallenges")
      .withIndex("by_challengeId", (query) =>
        query.eq("challengeId", args.challengeId),
      )
      .unique();

    if (challenge === null) {
      return { clearAuth: false, state: "missing" as const };
    }
    if (challenge.userId !== active.userId) {
      return { clearAuth: false, state: "unrelated" as const };
    }
    if (
      challenge.completedAt !== undefined &&
      challenge.completedSessionId === active.sessionId
    ) {
      return { clearAuth: false, state: "preserved" as const };
    }
    if (
      challenge.authenticatedSessionId === active.sessionId &&
      active.sessionId !== challenge.originalSessionId
    ) {
      await ctx.db.delete(challenge._id);
      if (
        await completedSiblingProtectsSession(
          ctx,
          challenge,
          active.sessionId,
        )
      ) {
        return { clearAuth: false, state: "preserved" as const };
      }
      await deleteAccountSessionTree(ctx, active.sessionId);
      return { clearAuth: true, state: "revoked" as const };
    }
    if (active.sessionId === challenge.originalSessionId) {
      await ctx.db.delete(challenge._id);
      return { clearAuth: false, state: "cancelled" as const };
    }
    return { clearAuth: false, state: "preserved" as const };
  },
});

export const verifyPassword = internalMutation({
  args: {
    challengeId: v.string(),
    proofHash: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const authorized = await passwordChallengeForCaller(
      ctx,
      args.challengeId,
    );
    const challenge = authorized?.challenge ?? null;
    if (
      challenge === null ||
      challenge.userId !== args.userId ||
      !/^[0-9a-f]{64}$/.test(args.proofHash)
    ) {
      return { state: "invalid" as const };
    }
    const proofObservedAt = Math.max(Date.now(), challenge._creationTime);
    await ctx.db.patch(challenge._id, {
      proofMethod: "password",
      proofHash: args.proofHash,
      proofObservedAt,
    });
    return {
      state: "verified" as const,
      userId: challenge.userId,
    };
  },
});

export const validatePasswordVerification = internalQuery({
  args: {
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const authorized = await passwordChallengeForCaller(
      ctx,
      args.challengeId,
    );
    if (authorized === null) {
      return { state: "invalid" as const };
    }
    return {
      state: "valid" as const,
      userId: authorized.challenge.userId,
    };
  },
});

export const claimPasswordProof = internalMutation({
  args: {
    challengeId: v.string(),
    proofHash: v.string(),
  },
  handler: async (ctx, args) => {
    const authorized = await passwordChallengeForCaller(
      ctx,
      args.challengeId,
    );
    const challenge = authorized?.challenge ?? null;
    if (
      challenge === null ||
      challenge.proofMethod !== "password" ||
      typeof challenge.proofObservedAt !== "number" ||
      challenge.proofHash !== args.proofHash
    ) {
      return { state: "invalid" as const };
    }
    const replacementSessionId =
      authorized?.replacementSession?._id ??
      (await ctx.db.insert("authSessions", {
        expirationTime:
          Date.now() + AUTH_SESSION_TOTAL_DURATION_MS,
        userId: challenge.userId,
      }));
    await ctx.db.patch(challenge._id, {
      authenticatedSessionId: replacementSessionId,
      proofClaimedAt: Date.now(),
    });
    if (authorized?.replacementSession === null) {
      await deleteAccountSessionTree(
        ctx,
        challenge.originalSessionId,
      );
    }
    return {
      state: "claimed" as const,
      sessionId: replacementSessionId,
      userId: challenge.userId,
    };
  },
});

export const complete = mutation({
  args: {
    bindingConfirmed: v.boolean(),
    challengeId: v.string(),
  },
  handler: async (ctx, args) => {
    const active = await requireActiveAuthSession(ctx);
    const challenge = await ctx.db
      .query("recentAuthChallenges")
      .withIndex("by_challengeId", (query) =>
        query.eq("challengeId", args.challengeId),
      )
      .unique();

    if (challenge === null) {
      return { clearAuth: false, state: "missing" as const };
    }
    if (
      challenge.completedSessionId === active.sessionId &&
      challenge.userId === active.userId
    ) {
      return {
        clearAuth: false,
        state: "already_completed" as const,
      };
    }
    if (
      !args.bindingConfirmed ||
      challenge.userId !== active.userId
    ) {
      const replacement =
        challenge.authenticatedSessionId === active.sessionId &&
        active.sessionId !== challenge.originalSessionId;
      const protectedReplacement =
        replacement &&
        (await completedSiblingProtectsSession(
          ctx,
          challenge,
          active.sessionId,
        ));
      if (replacement && !protectedReplacement) {
        await deleteAccountSessionTree(ctx, active.sessionId);
      }
      if (challenge.userId !== active.userId) {
        return {
          clearAuth: replacement && !protectedReplacement,
          state: "mismatch" as const,
        };
      }
      return {
        clearAuth: replacement && !protectedReplacement,
        state: "missing" as const,
      };
    }
    const passwordProof =
      challenge.proofMethod === "password" &&
      challenge.authenticatedSessionId === active.sessionId &&
      typeof challenge.proofObservedAt === "number" &&
      challenge.proofObservedAt >= challenge._creationTime;
    if (
      challenge.expiresAt <= Date.now() ||
      !passwordProof
    ) {
      await ctx.db.delete(challenge._id);
      const replacement =
        challenge.authenticatedSessionId === active.sessionId &&
        active.sessionId !== challenge.originalSessionId;
      const protectedReplacement =
        replacement &&
        (await completedSiblingProtectsSession(
          ctx,
          challenge,
          active.sessionId,
        ));
      if (replacement && !protectedReplacement) {
        await deleteAccountSessionTree(ctx, active.sessionId);
      }
      return {
        clearAuth: replacement && !protectedReplacement,
        state: "missing" as const,
      };
    }

    const originalSession = await ctx.db.get(
      challenge.originalSessionId,
    );
    if (
      originalSession !== null &&
      originalSession.userId !== active.userId
    ) {
      await deleteAccountSessionTree(ctx, active.sessionId);
      await ctx.db.delete(challenge._id);
      return { clearAuth: true, state: "missing" as const };
    }

    if (
      originalSession !== null &&
      challenge.originalSessionId !== active.sessionId
    ) {
      await deleteAccountSessionTree(ctx, challenge.originalSessionId);
    }
    const completedAt = Date.now();
    await ctx.db.patch(challenge._id, {
      completedAt,
      completedSessionId: active.sessionId,
      expiresAt: completedAt + RECENT_AUTH_MAX_AGE_MS,
    });

    return {
      actionClass: challenge.actionClass,
      clearAuth: false,
      state: "completed" as const,
    };
  },
});
