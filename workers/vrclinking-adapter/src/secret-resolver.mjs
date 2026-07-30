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
 * `arn:aws:secretsmanager:…` uses Secrets Manager through the task role.
 * `secret://<name>` reads `<name>` from `secretDir`, which keeps local and test
 * runs off AWS entirely.
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
  resolveSecret.invalidate = function invalidate(secretRef) {
    const classified = classifySecretRef(secretRef);

    if (classified.kind !== "invalid") {
      cache.delete(classified.id);
    }
  };

  return resolveSecret;

  async function resolveSecret(secretRef) {
    const classified = classifySecretRef(secretRef);

    if (classified.kind === "invalid") {
      throw new SecretResolutionError("Unsupported secret reference.", {
        reason: "unsupported_reference",
      });
    }

    const cached = cache.get(classified.id);
    if (cached !== undefined && cached.expiresAt > clock()) {
      return cached.token;
    }

    let raw;

    if (classified.kind === "local") {
      if (!secretDir) {
        throw new SecretResolutionError("No local secret directory is configured.", {
          reason: "unsupported_reference",
        });
      }

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
        throw new SecretResolutionError("No Secrets Manager client is configured.", {
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
    cache.set(classified.id, { token, expiresAt: clock() + cacheTtlMs });

    return token;
  }
}
