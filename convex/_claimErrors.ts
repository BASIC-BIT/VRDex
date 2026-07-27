import { ConvexError } from "convex/values";

// Convex redacts plain `Error` messages on production deployments, so every
// claim failure previously reached the browser as one generic string. These
// codes travel intact inside `ConvexError` data and are mapped to copy in
// `apps/web/src/lib/claim-errors.ts`.
export const CLAIM_ERROR_CODES = [
  "SIGN_IN_REQUIRED",
  "EMAIL_NOT_VERIFIED",
  "DISCORD_NOT_LINKED",
  "PROFILE_NOT_FOUND",
  "INVALID_PROFILE_SLUG",
  "WRONG_PROFILE_TYPE",
  "PROFILE_ALREADY_OWNED",
  "INVALID_DISCORD_GUILD_ID",
  "INVALID_VRCHAT_TARGET",
  "CONTROL_NOT_VERIFIED",
  "CONTROL_LEVEL_TOO_LOW",
  "PROOF_NOT_FOUND",
  "PROOF_EXPIRED",
  "PROOF_NOT_PENDING",
  "PROOF_NOT_FOUND_YET",
  "LINK_NOT_FOUND",
  "LINK_ALREADY_EXISTS",
  "ADAPTER_NOT_CONFIGURED",
  "ADAPTER_UNAVAILABLE",
  "NOT_PROFILE_OWNER",
  "VERIFICATION_STATE_INVALID",
] as const;

export type ClaimErrorCode = (typeof CLAIM_ERROR_CODES)[number];

/**
 * Throwable structured claim error. `detail` is optional operator-facing
 * context; it must never carry proof codes, tokens, or provider secrets
 * because the data payload is delivered to the browser.
 */
export function claimError(code: ClaimErrorCode, detail?: string): ConvexError<{
  code: ClaimErrorCode;
  detail?: string;
}> {
  return new ConvexError(detail === undefined ? { code } : { code, detail });
}
