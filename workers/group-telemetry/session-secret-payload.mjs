// Pure payload construction for the vault-to-AWS session transfer.
//
// Kept separate from the transfer script so the "replace only the session
// fields" rule is directly testable: the runbook requires that transferring a
// session never disturbs anything else an operator keeps in that secret.

const SESSION_FIELDS = ["workerApiKey", "authCookie", "twoFactorAuthCookie"];

export function sessionSecretFields() {
  return [...SESSION_FIELDS];
}

/**
 * Merge a validated session and a freshly generated worker key into whatever
 * the secret already holds.
 *
 * Only `workerApiKey`, `authCookie`, and `twoFactorAuthCookie` are written.
 * `twoFactorAuthCookie` is removed when the session has none, so a stale cookie
 * from a previous account cannot linger and be sent alongside a new session.
 */
export function buildSessionSecretPayload(existing, { workerApiKey, authCookie, twoFactorAuthCookie }) {
  if (typeof workerApiKey !== "string" || workerApiKey.length < 32) {
    throw new Error("workerApiKey must be at least 32 characters.");
  }

  if (typeof authCookie !== "string" || authCookie.length < 8) {
    throw new Error("authCookie is malformed.");
  }

  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const next = { ...base, workerApiKey, authCookie };

  if (typeof twoFactorAuthCookie === "string" && twoFactorAuthCookie.length >= 8) {
    next.twoFactorAuthCookie = twoFactorAuthCookie;
  } else {
    delete next.twoFactorAuthCookie;
  }

  return next;
}

/** Keys the transfer left untouched, for the operator-facing summary. */
export function preservedSecretKeys(existing) {
  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};

  return Object.keys(base).filter((key) => !SESSION_FIELDS.includes(key));
}
