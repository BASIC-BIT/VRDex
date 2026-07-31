import { timingSafeEqual } from "node:crypto";

import { DEFAULT_FAN_OUT_BUDGET_MS, verifyLinkage, validateRequest } from "./adapter.mjs";

export const MAX_BODY_BYTES = 16 * 1024;
// Held back from the fan-out so a verdict that was found still has time to be
// serialized and returned.
const RESPONSE_RESERVE_MS = 500;

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The adapter's protocol, with no transport in it.
 *
 * Two things speak it — the local `node:http` server and the Lambda handler —
 * and the parts that are easy to get subtly wrong are the same either way: the
 * constant-time bearer comparison, mapping "could not consult anything" to 503
 * rather than a 200 negative, and never letting provider or secret detail reach
 * the caller. Keeping one copy means a fix lands in both.
 */
export async function handleAdapterRequest({
  method,
  path,
  authorization = "",
  rawBody,
  bearerToken,
  resolveSecret,
  getGuildMemberByDiscordId,
  // How long this transport can still afford to spend, when it knows. The
  // fan-out's own budget assumes a whole invocation is ahead of it, which is
  // false after a cold start has spent part of one resolving secrets — a
  // provider call could then be started that the platform kills before its
  // answer comes back, spending a community's quota and the claimant's reserved
  // cooldown for a verdict nobody receives.
  remainingMs,
}) {
  if (method === "GET" && path === "/healthz") {
    return { status: 200, payload: { status: "ok" } };
  }

  if (method !== "POST") {
    return { status: 405, payload: { error: "method_not_allowed" } };
  }

  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!presented || !safeEqual(presented, bearerToken)) {
    return { status: 401, payload: { error: "unauthorized" } };
  }

  let body;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return { status: 400, payload: { error: "invalid_body" } };
  }

  // Inside the try: `validateRequest` verifies capabilities, and a missing
  // signing key throws from there. Left outside, that killed the process on the
  // node transport rather than answering the request.
  try {
    const validated = validateRequest(body);

    if (!validated.ok) {
      return { status: 400, payload: { error: validated.error } };
    }

    const result = await verifyLinkage({
      request: validated.request,
      resolveSecret,
      getGuildMemberByDiscordId,
      // Whichever is smaller. `RESPONSE_RESERVE_MS` keeps enough of the
      // invocation to serialize and return the verdict — stopping the fan-out
      // exactly at the platform deadline would throw away an answer already
      // paid for.
      deadlineMs:
        remainingMs === undefined
          ? DEFAULT_FAN_OUT_BUDGET_MS
          : Math.max(0, Math.min(DEFAULT_FAN_OUT_BUDGET_MS, remainingMs - RESPONSE_RESERVE_MS)),
    });

    // The control plane treats a non-200 as "adapter unavailable", which is the
    // correct reading when no delegation could be consulted.
    return {
      status: result.unavailable === true ? 503 : 200,
      payload: {
        verified: result.verified,
        evidenceSource: result.evidenceSource,
        evidenceSummary: result.evidenceSummary,
        // Which delegations were actually asked. The control plane stamps its
        // operator-visible "last queried" from this, so dropping it here left
        // every consulted key reporting "Not used yet".
        consultedDelegationIndexes: result.consultedDelegationIndexes ?? [],
        ...(result.matchedGuildId === undefined
          ? {}
          : {
              matchedGuildId: result.matchedGuildId,
              matchedDelegationIndex: result.matchedDelegationIndex,
            }),
      },
    };
  } catch {
    // Never surface provider or secret detail to the caller.
    return { status: 500, payload: { error: "adapter_failed" } };
  }
}
