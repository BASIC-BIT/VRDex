// Pure payload construction for the vault-to-AWS session transfer.
//
// Kept separate from the transfer script so the "replace only the session
// fields" rule is directly testable: the runbook requires that transferring a
// session never disturbs anything else an operator keeps in that secret.

const SESSION_FIELDS = ["workerApiKey", "authCookie", "twoFactorAuthCookie", "vrchatUserId"];

export function sessionSecretFields() {
  return [...SESSION_FIELDS];
}

/**
 * Merge a validated session and a freshly generated worker key into whatever
 * the secret already holds.
 *
 * Only the session fields are written. `twoFactorAuthCookie` is removed when
 * the session has none, so a stale cookie from a previous account cannot linger
 * and be sent alongside a new session.
 *
 * `vrchatUserId` is recorded so a later transfer can tell which collector
 * account this secret belongs to. It is not a secret, and it is the only thing
 * that catches an alias paired with the wrong `--secret-id`: without it, the
 * session validates against itself and the wrong account's cookies are
 * deployed under an identity Convex and ECS still believe is someone else.
 */
export function buildSessionSecretPayload(existing, { workerApiKey, authCookie, twoFactorAuthCookie, vrchatUserId }) {
  if (typeof workerApiKey !== "string" || workerApiKey.length < 32) {
    throw new Error("workerApiKey must be at least 32 characters.");
  }

  if (typeof authCookie !== "string" || authCookie.length < 8) {
    throw new Error("authCookie is malformed.");
  }

  if (typeof vrchatUserId !== "string" || vrchatUserId.length === 0) {
    throw new Error("vrchatUserId is required.");
  }

  const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
  const next = { ...base, workerApiKey, authCookie, vrchatUserId };

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
