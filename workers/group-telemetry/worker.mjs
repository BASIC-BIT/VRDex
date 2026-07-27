import { setTimeout as sleep } from "node:timers/promises";

import { VrchatClient } from "./vrchat-client.mjs";
import { COLLECTOR_VERSION, RequestBudget, TelemetryControlClient, failureDisposition, pollId, randomPollDelayMs, retryDelayMs } from "./runtime.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function loadSecret() {
  let value;
  try { value = JSON.parse(requiredEnv("VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON")); }
  catch { throw new Error("VRDEX_GROUP_TELEMETRY_ACCOUNT_SECRET_JSON must be valid JSON."); }
  if (typeof value.workerApiKey !== "string" || value.workerApiKey.length < 32) throw new Error("Account secret workerApiKey is invalid.");
  if (typeof value.authCookie !== "string" || value.authCookie.length < 8) throw new Error("Account secret authCookie is invalid.");
  if (value.twoFactorAuthCookie !== undefined && (typeof value.twoFactorAuthCookie !== "string" || value.twoFactorAuthCookie.length < 8)) throw new Error("Account secret twoFactorAuthCookie is invalid.");
  return value;
}

if (requiredEnv("VRDEX_GROUP_TELEMETRY_ENABLED") !== "true") {
  throw new Error("Group telemetry collector is disabled by its deployment gate.");
}

const secret = loadSecret();
const control = new TelemetryControlClient({
  endpoint: new URL("/telemetry/worker", requiredEnv("VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL")).href,
  collectorAccountId: requiredEnv("VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID"),
  workerApiKey: secret.workerApiKey,
  workerId: process.env.VRDEX_GROUP_TELEMETRY_WORKER_ID,
});
const provider = new VrchatClient({ authCookie: secret.authCookie, twoFactorAuthCookie: secret.twoFactorAuthCookie, userAgent: requiredEnv("VRDEX_GROUP_TELEMETRY_USER_AGENT") });
const accountBudget = new RequestBudget(Number(process.env.VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE ?? 30));
const integrationBudgets = new Map();
const attempts = new Map();
let stopping = false;
let controlFailures = 0;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function collect(assignment) {
  const lease = { integrationId: assignment.integrationId, fencingToken: assignment.fencingToken };
  const now = Date.now();
  const requestCost = assignment.state === "active" ? 2 : 4;
  let integrationBudget = integrationBudgets.get(assignment.integrationId);
  if (!integrationBudget || integrationBudget.limit !== assignment.requestsPerMinute) {
    integrationBudget = new RequestBudget(assignment.requestsPerMinute);
    integrationBudgets.set(assignment.integrationId, integrationBudget);
  }
  try {
    const localRetryAfterMs = Math.max(
      accountBudget.retryAfterMs(requestCost, now),
      integrationBudget.retryAfterMs(requestCost, now),
    );
    if (localRetryAfterMs > 0) {
      await control.send("defer", { ...lease, nextPollAt: now + localRetryAfterMs, now });
      return;
    }
    const reservation = await control.send("budget", { ...lease, requestCount: requestCost, now });
    if (!reservation.granted) return;
    accountBudget.tryConsume(requestCost, now);
    integrationBudget.tryConsume(requestCost, now);
    if (assignment.state === "disconnecting") {
      await provider.leaveGroup(assignment.vrchatGroupId);
      await control.send("membership", {
        ...lease,
        state: "disconnected",
        joinPolicy: assignment.joinPolicy,
        groupVisibility: assignment.groupVisibility,
        detail: "service_account_left_group",
        now: Date.now(),
      });
      return;
    }
    if (assignment.state !== "active") {
      const membership = await provider.connectGroup(assignment.vrchatGroupId);
      await control.send("membership", {
        ...lease,
        state: membership.state,
        joinPolicy: membership.joinPolicy,
        groupVisibility: membership.groupVisibility,
        detail: membership.transition,
        now: Date.now(),
      });
      if (membership.state !== "active") return;
    }
    const snapshot = await provider.readAggregateSnapshot(assignment.vrchatGroupId);
    const nextPollAt = snapshot.observedAt + randomPollDelayMs(snapshot.instances.length > 0);
    await control.send("ingest", {
      ...lease,
      pollId: pollId(assignment.integrationId, snapshot.observedAt),
      observedAt: snapshot.observedAt,
      collectorVersion: COLLECTOR_VERSION,
      groupMemberCount: snapshot.group.memberCount,
      instances: snapshot.instances,
      nextPollAt,
    });
    attempts.delete(assignment.integrationId);
  } catch (error) {
    const attempt = (attempts.get(assignment.integrationId) ?? 0) + 1;
    attempts.set(assignment.integrationId, attempt);
    const failure = failureDisposition(error, attempt);
    await control.send("failure", { ...lease, ...failure, collectorVersion: COLLECTOR_VERSION, now: Date.now() });
    if (failure.stopAccount) stopping = true;
  } finally {
    await control.send("release", lease).catch(() => undefined);
  }
}

/**
 * Hands back attempts that were claimed but never read.
 *
 * `includeFrom` decides whether `from` itself is one of them. It is when the
 * batch stops before spending anything on it (a budget denial), and it is not
 * when the provider already answered for it — releasing a throttled attempt
 * puts it straight back in the pool for the next replica to retry against the
 * same throttle, which is exactly what the backoff is meant to prevent.
 */
async function releaseUnread(batch, from, includeFrom = true) {
  const index = batch.indexOf(from);

  if (index < 0) return;

  const attemptIds = batch.slice(includeFrom ? index : index + 1).map((entry) => entry.attemptId);

  if (attemptIds.length === 0) return;

  await control
    .send("proof_release", { attemptIds, now: Date.now() })
    .catch(() => undefined);
}

/**
 * Look for ownership proof codes on pending VRChat targets.
 *
 * Proof checks are not lease-scoped, so the account budget is the only rate
 * guard here. A provider error leaves the attempt pending rather than failing
 * it: the owner may simply not have posted the code yet, and the attempt
 * expires on its own.
 */
async function checkProofs() {
  const claimNow = Date.now();
  if (accountBudget.retryAfterMs(1, claimNow) > 0) return 0;

  const { attempts: pending = [] } = await control.send("proof_claim", { limit: 5, now: claimNow });

  for (const attempt of pending) {
    if (stopping) break;
    const now = Date.now();

    if (!accountBudget.tryConsume(1, now)) {
      // Same reason as the shared-budget denial below: the claim stamped the
      // whole batch, so leaving without releasing holds unread attempts in
      // cooldown. Telemetry polling can drain the local budget between the
      // initial check and this point.
      await releaseUnread(pending, attempt);
      break;
    }

    // The process-local counter above is only a fast local guard. Replicas on
    // the same service account, and restarts mid-window, each start from zero,
    // so the shared reservation is what actually bounds the account's rate.
    const reservation = await control.send("proof_budget", { requestCount: 1, now });

    if (!reservation?.granted) {
      await releaseUnread(pending, attempt);
      break;
    }

    let found = false;
    try {
      found = await provider.findProofCode(
        attempt.targetType,
        attempt.targetExternalId,
        attempt.proofCode,
      );
    } catch (error) {
      // An expired service-account session must stop the worker, matching the
      // telemetry path's handling of authenticated provider 401s. Report it
      // too: a worker that only had proof checks would otherwise exit silently,
      // leaving the account `ready` for every other replica to rediscover the
      // same dead session one 401 at a time.
      if (error?.category === "authentication") {
        stopping = true;

        try {
          await control.send("proof_auth_failure", { now: Date.now() });
        } catch {
          // Exiting on the 401 matters more than reporting it.
        }
      }

      // Continuing through the batch during an explicit backoff window sends
      // more requests into a throttle. Stop the batch and honour the delay.
      if (error?.category === "rate_limit") {
        // The rest of the batch is still stamped from the claim, so hand it
        // back before sleeping. Otherwise a throttle also parks attempts that
        // nobody looked at for the whole cooldown. This attempt keeps its stamp:
        // it already cost a provider request, and its cooldown is the only thing
        // stopping another replica from immediately retrying into the throttle.
        await releaseUnread(pending, attempt, false);
        await sleep(Math.min(Math.max(error.retryAfterMs ?? 60_000, 1_000), 5 * 60_000));
        break;
      }

      continue;
    }

    await control.send("proof_result", { attemptId: attempt.attemptId, found, now: Date.now() });
  }

  return pending.length;
}

while (!stopping) {
  try {
    const { assignments = [] } = await control.send("claim", { limit: 10, now: Date.now() });
    controlFailures = 0;
    for (const assignment of assignments) {
      if (stopping) break;
      await collect(assignment);
    }
    const proofCount = stopping ? 0 : await checkProofs();
    await sleep(assignments.length > 0 || proofCount > 0 ? 1_000 : 10_000);
  } catch {
    controlFailures += 1;
    await sleep(retryDelayMs(controlFailures));
  }
}
