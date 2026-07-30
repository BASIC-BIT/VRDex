import { timingSafeEqual } from "node:crypto";

import { verifyLinkage, validateRequest } from "./adapter.mjs";

export const MAX_BODY_BYTES = 16 * 1024;

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
