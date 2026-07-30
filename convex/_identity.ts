import { ConvexError } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const UNAUTHENTICATED_CODE = "UNAUTHENTICATED";

type IdentityCtx = QueryCtx | MutationCtx;

export function isUnauthenticatedError(
  error: unknown,
): error is ConvexError<{ code: string }> {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === UNAUTHENTICATED_CODE
  );
}

/**
 * Clerk is the session authority, so there is no VRDex session record to
 * validate. A token that Convex accepted is by definition unexpired and
 * unrevoked — Clerk refuses to mint a new one for a revoked session, and the
 * `convex` JWT template's one-hour lifetime bounds how long an already-issued
 * token stays usable. `users` remains the identity spine every other table
 * points at, keyed to Clerk by `clerkUserId`.
 */
async function clerkUserIdOrNull(ctx: IdentityCtx) {
  const identity = await ctx.auth.getUserIdentity();

  return identity === null ? null : identity.subject;
}

export async function currentUserOrNull(
  ctx: IdentityCtx,
): Promise<Doc<"users"> | null> {
  const clerkUserId = await clerkUserIdOrNull(ctx);

  if (clerkUserId === null) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("clerkUserId", (query) => query.eq("clerkUserId", clerkUserId))
    .unique();
}

/**
 * Drop-in replacement for the removed `requireActiveAuthSession`. Callers only
 * ever destructured `{ user }` or `{ userId }`, so those are the only fields
 * carried forward.
 */
export async function requireUser(ctx: IdentityCtx) {
  const user = await currentUserOrNull(ctx);

  if (user === null) {
    throw new ConvexError({ code: UNAUTHENTICATED_CODE });
  }

  return { user, userId: user._id };
}

/**
 * Provisioning happens on demand from `users:ensureCurrentUser` rather than a
 * Clerk webhook: no endpoint to expose, no signature to verify, and no replay
 * or retry semantics to get wrong. Idempotent, so a concurrent duplicate call
 * refreshes the row instead of inserting a second one.
 */
export async function ensureUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (identity === null) {
    throw new ConvexError({ code: UNAUTHENTICATED_CODE });
  }

  const existing = await ctx.db
    .query("users")
    .withIndex("clerkUserId", (query) =>
      query.eq("clerkUserId", identity.subject),
    )
    .unique();

  // The schema stores a verification *time* while Clerk asserts a boolean. Keep
  // the original timestamp while the address stays verified, but clear it the
  // moment Clerk stops vouching for the address — a changed primary email
  // arrives unverified, and the claim guards check only that an email and a
  // timestamp exist, so a preserved timestamp would let an unverified address
  // satisfy claim-level verification.
  const emailVerified = identity.emailVerified === true;
  const emailUnchanged =
    existing !== null && existing.email === (identity.email ?? undefined);
  const emailVerificationTime = !emailVerified
    ? undefined
    : emailUnchanged && existing.emailVerificationTime !== undefined
      ? existing.emailVerificationTime
      : Date.now();

  const profile = {
    clerkUserId: identity.subject,
    name: identity.name ?? undefined,
    image: identity.pictureUrl ?? undefined,
    email: identity.email ?? undefined,
    emailVerificationTime,
  };

  if (existing === null) {
    const userId = await ctx.db.insert("users", profile);

    return (await ctx.db.get(userId))!;
  }

  // Called on every authenticated request path, so skip the write when nothing
  // actually changed rather than churning the document.
  const unchanged =
    existing.clerkUserId === profile.clerkUserId &&
    existing.name === profile.name &&
    existing.image === profile.image &&
    existing.email === profile.email &&
    existing.emailVerificationTime === profile.emailVerificationTime;

  if (!unchanged) {
    await ctx.db.patch(existing._id, profile);
  }

  return (await ctx.db.get(existing._id))!;
}
