import { readFile } from "node:fs/promises";
import path from "node:path";

// Convex stores only a reference to a delegated VRCLinking key; this module is
// the only place a reference becomes a token. Resolved values are never logged
// and never returned to the control plane.

const ARN_PREFIX = "arn:aws:secretsmanager:";
const LOCAL_PREFIX = "secret://";
// Guards the file backend against traversal via a crafted reference.
const LOCAL_NAME_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;

export class SecretResolutionError extends Error {
  constructor(message, { reason = "resolution_failed" } = {}) {
    super(message);
    this.name = "SecretResolutionError";
    this.reason = reason;
  }
}

/**
 * VRCLinking keys may be stored as a plain string or as JSON with a `token`
 * field. Accept both so operators are not forced into one layout.
 */
export function extractToken(rawSecret) {
  if (typeof rawSecret !== "string" || rawSecret.trim().length === 0) {
    throw new SecretResolutionError("Secret payload is empty.", { reason: "empty_secret" });
  }

  const trimmed = rawSecret.trim();

  if (!trimmed.startsWith("{")) {
    return trimmed;
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new SecretResolutionError("Secret payload is not valid JSON.", {
      reason: "malformed_secret",
    });
  }

  const token = parsed?.token ?? parsed?.apiKey ?? parsed?.vrclinkingToken;

  if (typeof token !== "string" || token.trim().length === 0) {
    throw new SecretResolutionError("Secret JSON has no token field.", {
      reason: "malformed_secret",
    });
  }

  return token.trim();
}

export function classifySecretRef(secretRef) {
  if (typeof secretRef !== "string") {
    return { kind: "invalid" };
  }

  const trimmed = secretRef.trim();

  if (trimmed.startsWith(ARN_PREFIX)) {
    return { kind: "aws", id: trimmed };
  }

  if (trimmed.startsWith(LOCAL_PREFIX)) {
    const name = trimmed.slice(LOCAL_PREFIX.length);

    return LOCAL_NAME_PATTERN.test(name) && !name.includes("..")
      ? { kind: "local", id: name }
      : { kind: "invalid" };
  }

  return { kind: "invalid" };
}

/**
 * Resolve a secret reference to a VRCLinking token.
 *
 * `arn:aws:secretsmanager:…` always uses Secrets Manager through the task role.
 * `secret://<name>` reads `<name>` from `secretDir` when one is configured,
 * which keeps local and test runs off AWS entirely, and otherwise resolves the
 * same name through Secrets Manager.
 */
export function createSecretResolver({ secretDir, awsClient, cacheTtlMs = 300_000, clock = Date.now } = {}) {
  const cache = new Map();

  /**
   * Drop a cached token the provider has rejected.
   *
   * Without this, a community that rotates its key keeps getting
   * `credential_rejected` for the rest of the TTL while the adapter replays the
   * old token — and every one of those attempts burns the claimant's cooldown.
   */
  resolveSecret.invalidate = function invalidate(secretRef, generation) {
    const classified = classifySecretRef(secretRef);

    if (classified.kind !== "invalid") {
      cache.delete(cacheKey(classified.id, generation));
    }
  };

  return resolveSecret;

  // Keyed by reference *and* generation. A community replacing its key keeps the
  // same guild-derived reference — the reference is a pure function of the guild
  // id — so a reference-only key let a warm container answer a claim reserved
  // against the *new* credential row with the token it had cached for the old
  // one. That verdict then passed both the row-id and reference rechecks and was
  // attributed to the replacement. The generation is a cache key, not a
  // credential: forging one costs a cache miss and a fresh read, nothing more.
  function cacheKey(id, generation) {
    return generation === undefined ? id : `${id}#${generation}`;
  }

  async function resolveSecret(secretRef, generation) {
    const classified = classifySecretRef(secretRef);

    if (classified.kind === "invalid") {
      throw new SecretResolutionError("Unsupported secret reference.", {
        reason: "unsupported_reference",
      });
    }

    const key = cacheKey(classified.id, generation);
    const cached = cache.get(key);
    if (cached !== undefined && cached.expiresAt > clock()) {
      return cached.token;
    }

    let raw;

    // `secret://<name>` names a secret; it does not pick a backend. With a
    // secret directory it is a file, and on AWS it is a Secrets Manager name,
    // which `GetSecretValue` accepts wherever it accepts an ARN. Treating the
    // named form as file-only made every community that registered one — the
    // form the account UI and `docs/backend/vrclinking-api.md` both document —
    // unresolvable on Lambda, where there is no secret directory.
    if (classified.kind === "local" && secretDir) {
      const resolvedPath = path.resolve(secretDir, classified.id);

      // Defence in depth alongside the reference pattern check.
      if (!resolvedPath.startsWith(path.resolve(secretDir) + path.sep)) {
        throw new SecretResolutionError("Secret reference escapes the secret directory.", {
          reason: "unsupported_reference",
        });
      }

      try {
        raw = await readFile(resolvedPath, "utf8");
      } catch {
        throw new SecretResolutionError("Secret is not available.", { reason: "not_found" });
      }
    } else {
      if (!awsClient) {
        throw new SecretResolutionError("No secret backend can resolve this reference.", {
          reason: "unsupported_reference",
        });
      }

      try {
        const result = await awsClient.getSecretValue(classified.id);
        raw = result?.SecretString;
      } catch {
        throw new SecretResolutionError("Secret is not available.", { reason: "not_found" });
      }
    }

    const token = extractToken(raw);
    cache.set(key, { token, expiresAt: clock() + cacheTtlMs });

    return token;
  }
}
