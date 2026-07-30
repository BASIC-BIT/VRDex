import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

import { currentUserOrNull, requireUser } from "./_identity";
import { toAuthSubject } from "./_communityAuthority";

type BrowserSessionCtx = MutationCtx | QueryCtx;

/**
 * Browser identity for claim-level and account-level code. Clerk is the session
 * authority now, so there is no separate session record to validate: a token
 * Convex accepted is live, and a revoked or expired one produces no identity at
 * all. That collapses the old "revoked" state into "anonymous" and removes the
 * try/catch this file used to need.
 *
 * The exported surface is unchanged so the ~18 modules importing it — claim
 * flows, profiles, events, seeds, short links, telemetry — need no edits.
 */
export async function activeBrowserSessionOrNull(ctx: BrowserSessionCtx) {
  const user = await currentUserOrNull(ctx);

  return user === null ? null : { user, userId: user._id };
}

export async function activeBrowserSessionSubjectOrNull(
  ctx: BrowserSessionCtx,
) {
  const identity = await ctx.auth.getUserIdentity();
  const activeSession = await activeBrowserSessionOrNull(ctx);

  if (identity === null || activeSession === null) {
    return null;
  }

  return { ...activeSession, subject: toAuthSubject(identity) };
}

export async function requireActiveBrowserSessionSubject(
  ctx: BrowserSessionCtx,
) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new Error("A signed-in user is required.");
  }

  return {
    ...(await requireUser(ctx)),
    subject: toAuthSubject(identity),
  };
}

export async function requireActiveVerifiedEmailUser(
  ctx: BrowserSessionCtx,
): Promise<Doc<"users">> {
  const { user } = await requireUser(ctx);

  if (user.email === undefined || user.emailVerificationTime === undefined) {
    throw new Error(
      "A verified email address is required before claim-level actions.",
    );
  }

  return user;
}
