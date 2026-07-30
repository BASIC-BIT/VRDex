import { claimError } from "./_claimErrors";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { activeBrowserSessionOrNull } from "./_browserSessionAuthority";

type AccountCtx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: AccountCtx) {
  return (await activeBrowserSessionOrNull(ctx))?.user ?? null;
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

  if (user.email === undefined || user.emailVerificationTime === undefined) {
    throw claimError("EMAIL_NOT_VERIFIED");
  }

  return user;
}

export async function getLinkedProviderAccount(
  ctx: AccountCtx,
  userId: Id<"users">,
  provider: string,
) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (query) => query.eq("userId", userId).eq("provider", provider))
    .take(1);

  return accounts[0] ?? null;
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    const linkedAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (query) => query.eq("userId", user._id))
      .collect();

    return {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerificationTime !== undefined,
        image: user.image,
      },
      linkedProviders: linkedAccounts.map((account) => ({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        emailVerified: account.emailVerified !== undefined,
      })),
    };
  },
});
