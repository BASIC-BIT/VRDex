import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

import {
  AUTH_SESSION_INVALID_CODE,
  requireActiveAuthSession,
} from "./_authSessionGuard";
import { toAuthSubject } from "./_communityAuthority";

type BrowserSessionCtx = MutationCtx | QueryCtx;

export async function activeBrowserSessionOrNull(ctx: BrowserSessionCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    return null;
  }

  try {
    return await requireActiveAuthSession(ctx);
  } catch (error) {
    if (
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      "code" in error.data &&
      error.data.code === AUTH_SESSION_INVALID_CODE
    ) {
      return null;
    }
    throw error;
  }
}

export async function browserSessionState(ctx: BrowserSessionCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    return "anonymous" as const;
  }

  return (await activeBrowserSessionOrNull(ctx)) === null
    ? ("revoked" as const)
    : ("active" as const);
}

export async function activeBrowserSessionSubjectOrNull(
  ctx: BrowserSessionCtx,
) {
  const activeSession = await activeBrowserSessionOrNull(ctx);
  if (activeSession === null) {
    return null;
  }
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }

  return {
    ...activeSession,
    subject: toAuthSubject(identity),
  };
}

export async function requireActiveBrowserSessionSubject(
  ctx: BrowserSessionCtx,
) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new Error("A signed-in user is required.");
  }

  return {
    ...(await requireActiveAuthSession(ctx)),
    subject: toAuthSubject(identity),
  };
}

export async function requireActiveVerifiedEmailUser(
  ctx: BrowserSessionCtx,
): Promise<Doc<"users">> {
  const { user } = await requireActiveAuthSession(ctx);

  if (user.email === undefined || user.emailVerificationTime === undefined) {
    throw new Error(
      "A verified email address is required before claim-level actions.",
    );
  }

  return user;
}
