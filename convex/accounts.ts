import { claimError } from "./_claimErrors";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { currentUserOrNull, identityEmail, identityEmailVerified } from "./_identity";

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

  // `appliedAt` is newer than the table. `migrations:backfillDiscordWatermarkAppliedAt`
  // stamps it on rows that predate it and whose `appliedGeneration` proves
  // reconciliation completed, so this fallback only covers the window before that
  // migration runs — without it, an already-verified user would lose person-claim
  // and VRC Linking access until they redid OAuth. The fallback is `updatedAt`,
  // which a failed reservation can move; the migration exists precisely so
  // ranking does not rely on it for long.
  const completedAt = (watermark: (typeof watermarks)[number]) =>
    watermark.appliedAt ??
    (watermark.appliedGeneration > 0 ? watermark.updatedAt : undefined);

  const current = watermarks.reduce<(typeof watermarks)[number] | null>(
    (latest, watermark) => {
      const candidate = completedAt(watermark);

      if (candidate === undefined) {
        return latest;
      }

      return latest === null || candidate > (completedAt(latest) ?? 0)
        ? watermark
        : latest;
    },
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
    //
    // `emailVerified` comes from the token rather than the mirrored column, for
    // the same reason the claim guards do. `ensureUser` runs from the client and
    // can lag — a token refresh after an email change does not re-trigger it —
    // so the column could still say "Verified" for an address Clerk no longer
    // vouches for. Reading the claim makes what the account page displays agree
    // with what the guards enforce.
    const identity = await identityEmail(ctx);

    return {
      user: {
        id: user._id,
        name: user.name,
        email: identity.email ?? user.email,
        emailVerified: identity.emailVerified,
        image: user.image,
      },
    };
  },
});
