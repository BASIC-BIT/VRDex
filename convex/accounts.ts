import { claimError } from "./_claimErrors";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { currentUserOrNull, identityEmailVerified } from "./_identity";

type AccountCtx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: AccountCtx) {
  return await currentUserOrNull(ctx);
}

// These two guards are the most common claim failures — an expired session and
// an unverified email. Convex redacts plain `Error` messages on production
// deployments, so throwing structured codes is what lets the UI say "sign in"
// or "verify your email" instead of one generic string.
export async function requireCurrentUser(ctx: AccountCtx) {
  const user = await getCurrentUser(ctx);

  if (user === null) {
    throw claimError("SIGN_IN_REQUIRED");
  }

  return user;
}

export async function requireVerifiedEmailUser(ctx: AccountCtx) {
  const user = await requireCurrentUser(ctx);

  // Checks the Clerk claim rather than the mirrored `emailVerificationTime`, so a
  // stale row cannot satisfy this guard. See `identityEmailVerified`.
  if (user.email === undefined || !(await identityEmailVerified(ctx))) {
    throw claimError("EMAIL_NOT_VERIFIED");
  }

  return user;
}

/**
 * Clerk owns which providers a user can sign in with, and that list is not
 * readable from a query or mutation without a network call. Claiming never
 * wanted sign-in provenance anyway — it wants a Discord identity VRDex has
 * itself verified — so this reads VRDex's own verification watermark instead of
 * a provider account table. `providerAccountId` is preserved as the field name
 * because every caller reads only that.
 */
export async function getLinkedProviderAccount(
  ctx: AccountCtx,
  userId: Id<"users">,
  provider: string,
) {
  if (provider !== "discord") {
    return null;
  }

  // One user can verify more than one Discord account, and the verification code
  // keeps a watermark per `(userId, discordUserId)` without marking any of them
  // current. Index order would hand back an arbitrary account, so pick
  // deterministically — and only from verifications that actually completed.
  //
  // Ranking on `updatedAt` is not enough: `reserveGuildVerificationGeneration`
  // bumps it before reading guilds, so an attempt that then failed would outrank
  // a good one. `appliedAt` is written only once reconciliation lands.
  const watermarks = await ctx.db
    .query("discordVerificationWatermarks")
    .withIndex("by_userId_discordUserId", (query) => query.eq("userId", userId))
    .collect();

  const current = watermarks.reduce<(typeof watermarks)[number] | null>(
    (latest, watermark) =>
      watermark.appliedAt === undefined
        ? latest
        : latest === null || watermark.appliedAt > (latest.appliedAt ?? 0)
          ? watermark
          : latest,
    null,
  );

  return current === null
    ? null
    : { providerAccountId: current.discordUserId };
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    // Connected sign-in methods are rendered by Clerk's own account UI, so this
    // no longer reports them.
    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerificationTime !== undefined,
        image: user.image,
      },
    };
  },
});
