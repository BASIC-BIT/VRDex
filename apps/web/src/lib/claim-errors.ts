import { ConvexError } from "convex/values";

// Mirrors `CLAIM_ERROR_CODES` in convex/_claimErrors.ts. Convex redacts plain
// `Error` messages on production deployments, so these structured codes are the
// only claim failure detail that survives the trip to the browser.
export type ClaimErrorCode =
  | "SIGN_IN_REQUIRED"
  | "EMAIL_NOT_VERIFIED"
  | "DISCORD_NOT_LINKED"
  | "PROFILE_NOT_FOUND"
  | "INVALID_PROFILE_SLUG"
  | "WRONG_PROFILE_TYPE"
  | "PROFILE_ALREADY_OWNED"
  | "PROFILE_STATE_UNSUPPORTED"
  | "INVALID_DISCORD_GUILD_ID"
  | "INVALID_VRCHAT_TARGET"
  | "CONTROL_NOT_VERIFIED"
  | "CONTROL_LEVEL_TOO_LOW"
  | "PROOF_NOT_FOUND"
  | "PROOF_EXPIRED"
  | "PROOF_NOT_PENDING"
  | "TOO_MANY_OPEN_PROOFS"
  | "ADAPTER_COOLDOWN"
  | "PROOF_NOT_FOUND_YET"
  | "LINK_NOT_FOUND"
  | "LINK_ALREADY_EXISTS"
  | "ADAPTER_NOT_CONFIGURED"
  | "ADAPTER_UNAVAILABLE"
  | "NOT_PROFILE_OWNER"
  | "VERIFICATION_STATE_INVALID"
  | "IDENTITY_SUPPRESSED"
  // Raised by the shared auth-session guard rather than a claim path, and
  // rethrown untouched so session convergence still sees it. Mapped here so a
  // claim surface says what actually happened instead of the generic fallback.
  | "AUTH_SESSION_INVALID";

export type ClaimFailureOutcome =
  | "conflict"
  | "expired"
  | "not_verified"
  | "unavailable"
  | "unknown";

const CLAIM_ERROR_COPY: Record<ClaimErrorCode, string> = {
  SIGN_IN_REQUIRED: "Sign in to continue this claim.",
  EMAIL_NOT_VERIFIED: "Verify your email address before claiming a profile.",
  DISCORD_NOT_LINKED: "Link your Discord account from your account page first.",
  PROFILE_NOT_FOUND: "We could not find that profile.",
  INVALID_PROFILE_SLUG: "We could not find that profile.",
  WRONG_PROFILE_TYPE: "That verification method does not apply to this profile type.",
  PROFILE_ALREADY_OWNED: "This profile already has an active owner.",
  PROFILE_STATE_UNSUPPORTED:
    "This profile is in a state that needs a person to sort out. Contact support rather than claiming again.",
  INVALID_DISCORD_GUILD_ID: "Choose a Discord server from the list.",
  INVALID_VRCHAT_TARGET: "Enter a valid VRChat profile or group URL.",
  CONTROL_NOT_VERIFIED:
    "You have not verified control of that server or group yet. Run the verification step first.",
  CONTROL_LEVEL_TOO_LOW:
    "Your Discord role is not high enough. You need Manage Server, Administrator, or server ownership.",
  PROOF_NOT_FOUND: "We could not find that verification attempt.",
  PROOF_EXPIRED: "This proof code expired. Start again to get a new code.",
  PROOF_NOT_PENDING: "This verification attempt is already resolved.",
  TOO_MANY_OPEN_PROOFS:
    "You already have the maximum number of verification attempts open for this method. Finish or cancel one from its claim page, or wait for it to expire, then try again.",
  ADAPTER_COOLDOWN:
    "You checked VRCLinking very recently. Wait about a minute before starting another check.",
  PROOF_NOT_FOUND_YET:
    "We could not find the proof code yet. Check where you placed it, then try again.",
  LINK_NOT_FOUND: "That connection is no longer attached to this profile.",
  LINK_ALREADY_EXISTS: "That server or group is already connected to this profile.",
  ADAPTER_NOT_CONFIGURED:
    "This verification method is not available yet. Try another method or contact support.",
  ADAPTER_UNAVAILABLE:
    "Verification is temporarily unavailable. Nothing changed; try again shortly.",
  NOT_PROFILE_OWNER: "You need to manage this profile before changing its connections.",
  VERIFICATION_STATE_INVALID: "That verification link expired. Start the check again.",
  IDENTITY_SUPPRESSED: "This profile cannot be created.",
  AUTH_SESSION_INVALID: "Your session is no longer valid. Sign in again to continue.",
};

const OUTCOME_BY_CODE: Record<ClaimErrorCode, ClaimFailureOutcome> = {
  SIGN_IN_REQUIRED: "not_verified",
  EMAIL_NOT_VERIFIED: "not_verified",
  // "conflict", not "unknown": this is a permanent rejection, so the retry
  // affordance an unknown failure offers would be misleading.
  IDENTITY_SUPPRESSED: "conflict",
  DISCORD_NOT_LINKED: "unavailable",
  PROFILE_NOT_FOUND: "unknown",
  INVALID_PROFILE_SLUG: "unknown",
  WRONG_PROFILE_TYPE: "unknown",
  PROFILE_ALREADY_OWNED: "conflict",
  PROFILE_STATE_UNSUPPORTED: "conflict",
  INVALID_DISCORD_GUILD_ID: "unknown",
  INVALID_VRCHAT_TARGET: "unknown",
  CONTROL_NOT_VERIFIED: "not_verified",
  CONTROL_LEVEL_TOO_LOW: "not_verified",
  PROOF_NOT_FOUND: "unknown",
  PROOF_EXPIRED: "expired",
  PROOF_NOT_PENDING: "conflict",
  TOO_MANY_OPEN_PROOFS: "conflict",
  ADAPTER_COOLDOWN: "conflict",
  PROOF_NOT_FOUND_YET: "not_verified",
  LINK_NOT_FOUND: "unknown",
  LINK_ALREADY_EXISTS: "conflict",
  ADAPTER_NOT_CONFIGURED: "unavailable",
  ADAPTER_UNAVAILABLE: "unavailable",
  NOT_PROFILE_OWNER: "conflict",
  VERIFICATION_STATE_INVALID: "expired",
  AUTH_SESSION_INVALID: "not_verified",
};

const FALLBACK_MESSAGE =
  "We could not complete that check. Nothing changed; try again or choose another method.";

export function claimErrorCode(error: unknown): ClaimErrorCode | null {
  const data = error instanceof ConvexError ? (error.data as unknown) : null;

  if (data === null || typeof data !== "object") {
    return null;
  }

  const code = (data as { code?: unknown }).code;

  return typeof code === "string" && code in CLAIM_ERROR_COPY ? (code as ClaimErrorCode) : null;
}

const SECRET_REFERENCE_DETAIL_PREFIX = "vrclinking_credentials_require_secret_reference:";

/** Operator-facing context the backend attached, when it sent any. */
export function claimErrorDetail(error: unknown): string | null {
  const data = error instanceof ConvexError ? (error.data as unknown) : null;

  if (data === null || typeof data !== "object") {
    return null;
  }

  const detail = (data as { detail?: unknown }).detail;

  return typeof detail === "string" ? detail : null;
}

export function claimErrorMessage(error: unknown): string {
  const code = claimErrorCode(error);

  if (code === null) {
    return FALLBACK_MESSAGE;
  }

  // The generic "not available yet" copy is actively misleading for a rejected
  // secret reference: the feature works, the name was wrong, and the backend
  // already said which name it wants. Dropping that detail left the action
  // unreachable for anyone following the UI.
  const detail = claimErrorDetail(error);

  if (code === "ADAPTER_NOT_CONFIGURED" && detail?.startsWith(SECRET_REFERENCE_DETAIL_PREFIX)) {
    const requiredName = detail.slice(SECRET_REFERENCE_DETAIL_PREFIX.length);

    return `That secret reference does not name this server. Use secret://${requiredName}.`;
  }

  return CLAIM_ERROR_COPY[code];
}

export function claimFailureOutcome(error: unknown): ClaimFailureOutcome {
  const code = claimErrorCode(error);

  return code === null ? "unknown" : OUTCOME_BY_CODE[code];
}
