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
    const common = {
      integrationId: body.integrationId as never,
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
      await ctx.runMutation(functions.releaseLease, common as never);
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
