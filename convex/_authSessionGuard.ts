import {
  getAuthSessionId,
  getAuthUserId,
} from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const MINUTE_MS = 60 * 1_000;

export const RECENT_AUTH_MAX_AGE_MS = 15 * MINUTE_MS;
export const AUTH_SESSION_INVALID_CODE = "AUTH_SESSION_INVALID";
export const RECENT_AUTH_REQUIRED_CODE = "RECENT_AUTH_REQUIRED";

type AuthSessionCtx = QueryCtx | MutationCtx;
type AuthSessionRecord = Pick<
  Doc<"authSessions">,
  "_creationTime" | "_id" | "expirationTime" | "userId"
>;

export type ActiveAuthSessionStatus =
  | "active"
  | "expired"
  | "missing"
  | "user_mismatch";

export function activeAuthSessionStatusAt(args: {
  now: number;
  session: AuthSessionRecord | null;
  userId: Doc<"users">["_id"] | null;
}): ActiveAuthSessionStatus {
  if (args.session === null || args.userId === null) {
    return "missing";
  }

  if (args.session.userId !== args.userId) {
    return "user_mismatch";
  }

  if (args.session.expirationTime <= args.now) {
    return "expired";
  }

  return "active";
}

export function authSessionIsRecentAt(args: {
  maxAgeMs?: number;
  now: number;
  sessionCreatedAt: number;
}) {
  const maxAgeMs = args.maxAgeMs ?? RECENT_AUTH_MAX_AGE_MS;

  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("Recent authentication age must be a non-negative duration.");
  }

  return args.now - args.sessionCreatedAt <= maxAgeMs;
}

export async function requireActiveAuthSession(
  ctx: AuthSessionCtx,
  now = Date.now(),
) {
  const [userId, sessionId] = await Promise.all([
    getAuthUserId(ctx),
    getAuthSessionId(ctx),
  ]);
  const normalizedUserId = typeof userId === "string" ? userId : null;
  const normalizedSessionId = typeof sessionId === "string" ? sessionId : null;
  const session =
    normalizedSessionId === null
      ? null
      : await ctx.db.get(normalizedSessionId);
  const status = activeAuthSessionStatusAt({
    now,
    session,
    userId: normalizedUserId,
  });

  if (
    status !== "active" ||
    normalizedSessionId === null ||
    session === null ||
    normalizedUserId === null
  ) {
    throw new ConvexError({
      code: AUTH_SESSION_INVALID_CODE,
      reason: status,
    });
  }

  const user = await ctx.db.get(normalizedUserId);

  if (user === null) {
    throw new ConvexError({
      code: AUTH_SESSION_INVALID_CODE,
      reason: "missing",
    });
  }

  return {
    session,
    sessionId: normalizedSessionId,
    user,
    userId: normalizedUserId,
  };
}

export async function requireRecentAuthSession(
  ctx: AuthSessionCtx,
  now = Date.now(),
  maxAgeMs = RECENT_AUTH_MAX_AGE_MS,
) {
  const activeSession = await requireActiveAuthSession(ctx, now);
  const completedChallenges = await ctx.db
    .query("recentAuthChallenges")
    .withIndex("by_completedSessionId", (query) =>
      query.eq("completedSessionId", activeSession.sessionId),
    )
    .collect();
  const hasRecentPasswordProof = completedChallenges.some(
    (challenge) =>
      challenge.userId === activeSession.userId &&
      challenge.proofMethod === "password" &&
      challenge.completedAt !== undefined &&
      challenge.completedAt <= now &&
      authSessionIsRecentAt({
        maxAgeMs,
        now,
        sessionCreatedAt: challenge.completedAt,
      }),
  );

  if (!hasRecentPasswordProof) {
    throw new ConvexError({
      code: RECENT_AUTH_REQUIRED_CODE,
    });
  }

  return activeSession;
}
