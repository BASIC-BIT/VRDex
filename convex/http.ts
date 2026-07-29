import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

const telemetryWorker = httpAction(async (ctx, request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const collectorAccountId = request.headers.get("x-vrdex-collector-account")?.trim();
  const workerKey = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!collectorAccountId || workerKey.length < 32) return json({ error: "unauthorized" }, 401);

  const functions = internal.communityTelemetry;
  const authorizationRecord = await ctx.runQuery(functions.collectorWorkerAuthorization, {
    collectorAccountId: collectorAccountId as never,
  });
  const presentedHash = await sha256Hex(workerKey);
  if (!authorizationRecord || !safeEqual(authorizationRecord.workerKeyHash, presentedHash)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!authorizationRecord.enabled) return json({ error: "collector_disabled" }, 423);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.operation !== "string" || typeof body.workerId !== "string") {
    return json({ error: "invalid_request" }, 400);
  }
  // Re-read after the body, not only before it. The first check happens before
  // an attacker-controlled read of unbounded length, so a request authenticated
  // with a superseded key could hold its body open across a rotation and then
  // act — stamping attempts into cooldown, spending the replacement account's
  // shared budget, releasing claims. This shrinks that window to the gap
  // between here and the dispatch below; the operations that change ownership
  // or account state re-check the digest inside their own transaction, which is
  // the only place it can be closed completely.
  const currentAuthorization = await ctx.runQuery(functions.collectorWorkerAuthorization, {
    collectorAccountId: collectorAccountId as never,
  });
  if (!currentAuthorization || !safeEqual(currentAuthorization.workerKeyHash, presentedHash)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!currentAuthorization.enabled) return json({ error: "collector_disabled" }, 423);

  // The worker reports the VRChat identity recorded in its own secret. Pairing
  // one collector id with another account's secret ARN otherwise started a task
  // that read as A while filing every result under B — the key check cannot see
  // that, because both halves are individually valid.
  // Required, not merely checked when offered. Accepting its absence left the
  // whole mispairing open to any worker that simply did not send it — a stale
  // task mid-rollout, or a custom one — which is the same hole with an easier
  // key. Workers refuse to start without it, so a request without one is not a
  // worker this control plane should be serving.
  if (
    typeof body.vrchatUserId !== "string" ||
    body.vrchatUserId !== currentAuthorization.vrchatUserId
  ) {
    return json({ error: "collector_identity_mismatch" }, 401);
  }
  const now = Date.now();
  try {
    if (body.operation === "claim") {
      const assignments = await ctx.runMutation(functions.claimDueAssignments, {
        collectorAccountId: collectorAccountId as never,
        workerId: body.workerId,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        now,
      });
      return json({ assignments });
    }
    // Proof checks are not lease-scoped: they target verification attempts
    // rather than a community integration, so they are handled before the
    // lease validation below.
    if (body.operation === "proof_claim") {
      const result = await ctx.runMutation(functions.claimPendingProofChecks, {
        collectorAccountId,
        workerId: body.workerId,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        now,
      });
      return json(result);
    }
    if (body.operation === "proof_release") {
      const result = await ctx.runMutation(functions.releaseProofChecks, {
        collectorAccountId,
        attemptIds: Array.isArray(body.attemptIds) ? body.attemptIds : [],
      });
      return json(result);
    }
    if (body.operation === "proof_auth_failure") {
      const result = await ctx.runMutation(functions.recordProofAuthFailure, {
        collectorAccountId,
        // Same reason as `proof_result`: a request authenticated with the old
        // key could otherwise finish after a rotation and quarantine the
        // account an operator has just recovered.
        workerKeyHash: presentedHash,
        now,
      });
      return json(result);
    }
    if (body.operation === "proof_rate_limit") {
      const result = await ctx.runMutation(functions.recordProofRateLimit, {
        collectorAccountId,
        retryAfterMs: typeof body.retryAfterMs === "number" ? body.retryAfterMs : 60_000,
        workerKeyHash: presentedHash,
        now,
      });
      return json(result);
    }
    if (body.operation === "proof_budget") {
      const result = await ctx.runMutation(functions.reserveProofRequestBudget, {
        collectorAccountId,
        requestCount: typeof body.requestCount === "number" ? body.requestCount : 1,
        now,
      });
      return json(result);
    }
    if (body.operation === "proof_result") {
      if (typeof body.attemptId !== "string" || typeof body.found !== "boolean") {
        return json({ error: "invalid_request" }, 400);
      }
      const result = await ctx.runMutation(functions.recordProofCheckResult, {
        collectorAccountId,
        attemptId: body.attemptId as never,
        found: body.found,
        // Checked again inside the mutation: this was authenticated before the
        // body was read, and a rotation in that window must not still grant.
        workerKeyHash: presentedHash,
        now,
      });

      return json(result);
    }
    const common = {
      integrationId: body.integrationId as never,
      collectorAccountId: collectorAccountId as never,
      workerId: body.workerId,
      fencingToken: body.fencingToken,
    };
    if (typeof body.integrationId !== "string" || typeof body.fencingToken !== "number") {
      return json({ error: "invalid_lease" }, 400);
    }
    if (body.operation === "membership") {
      await ctx.runMutation(functions.recordMembershipResult, {
        ...common,
        state: body.state,
        groupVisibility: body.groupVisibility,
        joinPolicy: body.joinPolicy,
        detail: typeof body.detail === "string" ? body.detail : undefined,
        now,
      } as never);
      return json({ ok: true });
    }
    if (body.operation === "budget") {
      const result = await ctx.runMutation(functions.reserveRequestBudget, {
        ...common,
        requestCount: body.requestCount,
        now,
      } as never);
      return json(result);
    }
    if (body.operation === "defer") {
      await ctx.runMutation(functions.deferAssignment, {
        ...common,
        nextPollAt: body.nextPollAt,
        now,
      } as never);
      return json({ ok: true });
    }
    if (body.operation === "ingest") {
      const result = await ctx.runMutation(functions.ingestAggregatePoll, {
        ...common,
        pollId: body.pollId,
        observedAt: body.observedAt,
        collectorVersion: body.collectorVersion,
        source: "first_party",
        groupMemberCount: body.groupMemberCount,
        instances: body.instances,
        nextPollAt: body.nextPollAt,
        now,
      } as never);
      return json(result);
    }
    if (body.operation === "failure") {
      await ctx.runMutation(functions.recordPollFailure, {
        ...common,
        statusClass: body.statusClass,
        coverageState: body.coverageState,
        nextPollAt: body.nextPollAt,
        backoffUntil: body.backoffUntil,
        detail: typeof body.detail === "string" ? body.detail : undefined,
        collectorVersion: body.collectorVersion,
        now,
      } as never);
      return json({ ok: true });
    }
    if (body.operation === "release") {
      await ctx.runMutation(functions.releaseLease, { ...common, now } as never);
      return json({ ok: true });
    }
    return json({ error: "unknown_operation" }, 400);
  } catch (error) {
    const message = error instanceof Error && /stale|unavailable/i.test(error.message) ? "stale_lease" : "operation_failed";
    return json({ error: message }, message === "stale_lease" ? 409 : 500);
  }
});

http.route({ path: "/telemetry/worker", method: "POST", handler: telemetryWorker });

export default http;
