import { ConvexError } from "convex/values";

import { claimError } from "./_claimErrors";
import { identityEmailVerified } from "./_identity";
import {
  activeBrowserSessionOrNull,
  requireActiveBrowserSessionSubject,
} from "./_browserSessionAuthority";

type ClaimSessionCtx = Parameters<typeof requireActiveBrowserSessionSubject>[0];

/**
 * The active browser session for a claim-level action, with claim-shaped errors.
 *
 * `_browserSessionAuthority` is the reviewed home for browser identity and stays
 * the only thing that reads it. What it does not do is report failures in a form
 * the claim UI can act on: Convex redacts plain `Error` messages on production
 * deployments, so "A signed-in user is required." reaches the browser as one
 * generic string — which is the failure that made claiming undiagnosable in the
 * first place.
 *
 * A `ConvexError` from the guard is rethrown untouched. That is the
 * `AUTH_SESSION_INVALID` signal the web app converges sessions on, and
 * flattening it into a claim code would break re-authentication.
 */
export async function requireClaimSession(ctx: ClaimSessionCtx) {
  try {
    return await requireActiveBrowserSessionSubject(ctx);
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }

    throw claimError("SIGN_IN_REQUIRED");
  }
}

/** As above, plus the verified-email bar every claim-level action requires. */
export async function requireVerifiedActiveBrowserSession(ctx: ClaimSessionCtx) {
  const activeSession = await requireClaimSession(ctx);

  // Reads the Clerk claim, not the mirrored `emailVerificationTime`. This is the
  // guard `profileClaims`, `profileConnections`, `discordVerification`, and
  // `vrclinkingCredentials` all go through, so a stale row must not satisfy it.
  if (
    activeSession.user.email === undefined ||
    !(await identityEmailVerified(ctx))
  ) {
    throw claimError("EMAIL_NOT_VERIFIED");
  }

  return activeSession;
}

/** Viewer-shaped read for surfaces that render for signed-out visitors too. */
export async function claimSessionUserOrNull(ctx: ClaimSessionCtx) {
  return (await activeBrowserSessionOrNull(ctx))?.user ?? null;
}
