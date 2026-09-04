import { setTimeout as sleep } from "node:timers/promises";

import { VrchatClient } from "./vrchat-client.mjs";
import { COLLECTOR_PROTOCOL_VERSION, RequestBudget, TelemetryControlClient, boundedProviderCategory, collectorAuthRequiredEvent, collectorLoopFailureEvent, collectorRestartEvent, collectorRuntimeMetadata, collectorShouldRestart, failureDisposition, pollId, randomPollDelayMs, retryDelayMs, sessionCheckDelayMs } from "./runtime.mjs";

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
  // Which VRChat account these cookies belong to. Sent with every control-plane
  // call and compared against the registered collector, so pairing one
  // collector id with another account's secret cannot start a task that reads
  // as A while filing everything under B.
  if (typeof value.vrchatUserId !== "string" || !/^usr_[A-Za-z0-9-]{8,120}$/.test(value.vrchatUserId)) {
    throw new Error("Account secret vrchatUserId is missing or invalid. Re-run the session transfer.");
  }
  return value;
}

if (requiredEnv("VRDEX_GROUP_TELEMETRY_ENABLED") !== "true") {
  throw new Error("Group telemetry collector is disabled by its deployment gate.");
}

const runtimeMetadata = collectorRuntimeMetadata();
const secret = loadSecret();
const control = new TelemetryControlClient({
  endpoint: new URL("/telemetry/worker", requiredEnv("VRDEX_GROUP_TELEMETRY_CONVEX_SITE_URL")).href,
  collectorAccountId: requiredEnv("VRDEX_GROUP_TELEMETRY_COLLECTOR_ACCOUNT_ID"),
  workerApiKey: secret.workerApiKey,
  vrchatUserId: secret.vrchatUserId,
  releaseSha: runtimeMetadata.releaseSha,
  workerId: process.env.VRDEX_GROUP_TELEMETRY_WORKER_ID,
});
const provider = new VrchatClient({ authCookie: secret.authCookie, twoFactorAuthCookie: secret.twoFactorAuthCookie, userAgent: requiredEnv("VRDEX_GROUP_TELEMETRY_USER_AGENT") });
const accountBudget = new RequestBudget(Number(process.env.VRDEX_GROUP_TELEMETRY_REQUESTS_PER_MINUTE ?? 30));
/**
 * Fast local guard for the proof share.
 *
 * Advisory only: this counter is per process, and the supported two-task setup
 * has two of them, each entitled to half. The ceiling that actually holds is
 * the `proof:account:<id>` scope in `reserveProofRequestBudget`, which every
 * replica shares. This just avoids claiming a batch the shared reservation is
 * about to refuse, so it mirrors `proofShareOf` there — including leaving room
 * for an atomic telemetry poll.
 */
const proofBudget = new RequestBudget(
  Math.max(1, Math.min(Math.floor(accountBudget.limit / 2), accountBudget.limit - 2)),
);
const integrationBudgets = new Map();
const attempts = new Map();
let stopping = false;
let controlFailures = 0;
let lastHeartbeatAt = 0;
let nextSessionCheckAt = 0;

function logEvent(event) {
  console.error(JSON.stringify(event));
}

async function heartbeat() {
  const now = Date.now();
  if (lastHeartbeatAt > now - 30_000) return;
  const result = await control.send("heartbeat", {
    ...runtimeMetadata,
    consecutiveControlFailures: controlFailures,
    now,
  });
  if (result?.recorded !== true) throw new Error("Control plane heartbeat was rejected.");
  lastHeartbeatAt = now;
  logEvent({
    event: "collector_heartbeat",
    releaseSha: runtimeMetadata.releaseSha,
    capabilities: runtimeMetadata.capabilities,
  });
}

/**
 * Prove the stored session is still accepted while nothing else exercises it.
 *
 * With no group assigned the only provider traffic is proof checks, so a
 * session that died after the transfer was first noticed by the first real
 * claim, a day later, by the claimant. One request every 8-12 minutes turns
 * that into an `auth_required` alarm within minutes. A dead session takes the
 * same exit as the proof path: report it so the account stops being offered,
 * then stop.
 */
async function checkSession() {
  const now = Date.now();
  if (now < nextSessionCheckAt || accountBudget.retryAfterMs(1, now) > 0) return;
  // Reserved against the shared proof share like every other provider request,
  // so two replicas cannot spend an unaccounted slot each. A denial is not a
  // skipped check: the next tick asks again.
  const reservation = await control.send("proof_budget", { requestCount: 1, now });
  if (!reservation?.granted) return;
  nextSessionCheckAt = now + sessionCheckDelayMs();
  accountBudget.tryConsume(1, now);
  try {
    await provider.verifySession({ expectedUserId: secret.vrchatUserId });
    logEvent({ event: "collector_session_check", outcome: "ok" });
  } catch (error) {
    if (error?.category !== "authentication") {
      // Not evidence either way; the next check will tell.
      logEvent({ event: "collector_session_check", outcome: "provider_unavailable", category: boundedProviderCategory(error?.category) });
      return;
    }
    logEvent({ event: "collector_session_check", outcome: "auth_required" });
    logEvent(collectorAuthRequiredEvent());
    await reportDeadSession();
  }
}

/**
 * Tell the control plane the session is dead so the account stops being
 * offered work, then stop. Callers log `collectorAuthRequiredEvent` first and
 * hand back anything they hold: once reported, this worker is rejected.
 */
async function reportDeadSession() {
  try {
    await control.send("proof_auth_failure", { now: Date.now() });
  } catch {
    // Exiting on the 401 matters more than reporting it.
  }
  stopping = true;
}

// A rate-limit backoff can park the loop for minutes, and ECS SIGKILLs 30s
// after SIGTERM by default. Without a signal the flag is not read again until
// the sleep returns, so the process dies mid-sleep instead of draining.
const shutdownSignal = new AbortController();
const stop = () => { stopping = true; shutdownSignal.abort(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

/** `sleep` that returns early on shutdown rather than throwing. */
async function pause(ms) {
  try {
    await sleep(ms, undefined, { signal: shutdownSignal.signal });
  } catch {
    // Aborted by shutdown; the caller re-checks `stopping`.
  }
}

async function pauseWithHeartbeats(ms) {
  const deadline = Date.now() + Math.max(0, ms);
  while (!stopping && Date.now() < deadline) {
    await pause(Math.min(25_000, deadline - Date.now()));
    if (!stopping && Date.now() < deadline) await heartbeat();
  }
}

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
      collectorVersion: COLLECTOR_PROTOCOL_VERSION,
      groupMemberCount: snapshot.group.memberCount,
      instances: snapshot.instances,
      nextPollAt,
    });
    attempts.delete(assignment.integrationId);
  } catch (error) {
    const attempt = (attempts.get(assignment.integrationId) ?? 0) + 1;
    attempts.set(assignment.integrationId, attempt);
    const failure = failureDisposition(error, attempt);
    await control.send("failure", { ...lease, ...failure, collectorVersion: COLLECTOR_PROTOCOL_VERSION, now: Date.now() });
    if (failure.stopAccount) {
      logEvent(collectorAuthRequiredEvent());
      stopping = true;
    }
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
  // Leave the rest of the window for telemetry. Claiming a batch we cannot read
  // would park it in cooldown for nothing.
  if (proofBudget.retryAfterMs(1, claimNow) > 0) return 0;

  const { attempts: pending = [] } = await control.send(
    "proof_claim",
    { limit: 5, now: claimNow },
    { requirePayload: true },
  );
  logEvent({ event: "collector_proof_batch_claimed", count: pending.length });

  for (const attempt of pending) {
    if (stopping) {
      // The only exit that used to skip this. The claim stamped the whole
      // batch, so a SIGTERM mid-batch parked every attempt behind it for the
      // full cooldown — multiplied across replicas on a rolling deploy.
      await releaseUnread(pending, attempt);
      break;
    }
    try {
      await heartbeat();
    } catch (error) {
      // The batch was claimed before this heartbeat. If the control plane is
      // temporarily unavailable, return the current attempt and unread tail so
      // a healthy sibling can meet the first-check SLA instead of waiting for
      // the full claim cooldown.
      await releaseUnread(pending, attempt);
      throw error;
    }
    const now = Date.now();

    // Checked without consuming. The process-local counter is only a fast
    // guard — replicas on the same service account, and restarts mid-window,
    // each start from zero, so the shared reservation is what actually bounds
    // the rate. Spending a local slot before that reservation charged the
    // account for a request that never went out, once per loop, so a run of
    // shared denials could leave it unable to use the window it finally got.
    //
    // Released either way: the claim stamped the whole batch, so leaving
    // without releasing holds unread attempts in cooldown.
    if (accountBudget.retryAfterMs(1, now) > 0 || proofBudget.retryAfterMs(1, now) > 0) {
      await releaseUnread(pending, attempt);
      break;
    }

    let reservation;

    try {
      reservation = await control.send("proof_budget", { requestCount: 1, now });
    } catch (error) {
      // A timeout or a 5xx here still leaves the whole batch stamped by the
      // claim, so walking away parks live attempts for a full cooldown after no
      // provider request was made — and a run of control-plane failures can
      // keep them unpolled until they expire. This attempt goes back too:
      // nothing was read for it.
      await releaseUnread(pending, attempt);
      throw error;
    }

    if (!reservation?.granted) {
      await releaseUnread(pending, attempt);
      // Honour the window the control plane named. Without it the loop's short
      // idle sleep reclaimed the same attempts seconds later and repeated the
      // denied reservation until the minute rolled over — and at a share of
      // zero, forever. `retryAt` is absolute; clamp so a bad value cannot park
      // the worker.
      const retryAfterMs = Math.min(
        Math.max((reservation?.retryAt ?? 0) - Date.now(), 0),
        60_000,
      );

      if (retryAfterMs > 0) {
        await pauseWithHeartbeats(retryAfterMs);
      }

      break;
    }

    accountBudget.tryConsume(1, now);
    proofBudget.tryConsume(1, now);

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
        // Release before reporting, not after. Reporting moves the account to
        // `auth_required` and the control plane then rejects this worker, so a
        // release attempted afterwards cannot succeed and the rest of the batch
        // would sit out its full claim cooldown even though other accounts are
        // healthy. The current attempt goes back too: a dead session says
        // nothing about it.
        await control
          .send("proof_outcome", {
            attemptId: attempt.attemptId,
            outcome: "auth_required",
            now: Date.now(),
          })
          .catch(() => undefined);
        logEvent(collectorAuthRequiredEvent());
        await releaseUnread(pending, attempt);
        await reportDeadSession();
        // Break rather than `continue`: the loop head releases the tail when it
        // sees `stopping`, and this path has already released it. The second
        // call would be a doomed round-trip at best, and at worst would un-stamp
        // an attempt a sibling worker on this account had just re-claimed.
        break;
      }

      // Continuing through the batch during an explicit backoff window sends
      // more requests into a throttle. Stop the batch and honour the delay.
      if (error?.category === "rate_limit") {
        const retryAfterMs = Math.min(Math.max(error.retryAfterMs ?? 60_000, 1_000), 5 * 60_000);
        await control
          .send("proof_outcome", {
            attemptId: attempt.attemptId,
            outcome: "rate_limited",
            now: Date.now(),
          })
          .catch(() => undefined);
        logEvent({
          event: "collector_provider_backoff",
          category: "rate_limit",
          retryAfterMs,
        });

        // Publish the backoff account-wide *before* handing anything back. This
        // worker's sleep is process-local, and the supported two-task setup
        // shares one collector account — so releasing first let the sibling task
        // reclaim these attempts and keep hammering the provider through its own
        // `Retry-After` window. With `cooldownUntil` set, `claimPendingProofChecks`
        // stops serving this account and the work moves to a healthy one.
        const cooldown = await control
          .send("proof_rate_limit", { retryAfterMs, now: Date.now() })
          .catch(() => null);

        // Only release once the shared cooldown is actually recorded. Releasing
        // on a failed publish is worse than not releasing: the tail becomes
        // immediately reclaimable while the account still reads `ready`, so a
        // sibling task picks it straight up and keeps issuing provider requests
        // through the `Retry-After` window. Holding the stamps parks the work
        // for one cooldown instead, which is the lesser harm.
        if (cooldown?.recorded === true) {
          // The rest of the batch is still stamped from the claim, so hand it
          // back. Otherwise a throttle also parks attempts that nobody looked
          // at for the whole cooldown. This attempt keeps its stamp: it already
          // cost a provider request.
          await releaseUnread(pending, attempt, false);
        }
        await pauseWithHeartbeats(retryAfterMs);
        break;
      }

      await control
        .send("proof_outcome", {
          attemptId: attempt.attemptId,
          outcome: "provider_unavailable",
          now: Date.now(),
        })
        .catch(() => undefined);
      logEvent({
        event: "collector_proof_check",
        outcome: "provider_unavailable",
        category: boundedProviderCategory(error?.category),
      });
      continue;
    }

    try {
      await control.send("proof_result", { attemptId: attempt.attemptId, found, now: Date.now() });
      logEvent({
        event: "collector_proof_check",
        outcome: found ? "found" : "not_found",
      });
    } catch (error) {
      // Same reasoning as the budget call: the untouched tail must not sit out
      // a cooldown for a control-plane failure. This attempt keeps its stamp —
      // it already cost a provider request, and re-reading it immediately would
      // spend another for the same answer.
      await releaseUnread(pending, attempt, false);
      throw error;
    }
  }

  return pending.length;
}

logEvent({
  event: "collector_started",
  releaseSha: runtimeMetadata.releaseSha,
  collectorVersion: runtimeMetadata.collectorVersion,
  capabilities: runtimeMetadata.capabilities,
});

while (!stopping) {
  let loopPhase = "heartbeat";
  try {
    await heartbeat();
    loopPhase = "session_check";
    if (!stopping) await checkSession();
    loopPhase = "proof_checks";
    // Proofs first, and before the claim rather than merely before `collect()`.
    // Telemetry is continuous and a deferred batch is picked up next window
    // none the worse; a proof attempt expires after 24 hours, so with a low
    // `requests_per_minute` a permanently-due integration could drain every
    // fresh window before proofs were reached.
    //
    // Claiming first would also hold five-minute leases across a proof
    // `Retry-After`, which can sleep for minutes: the fencing tokens go stale
    // while the work sits in hand, so repeated proof throttling would leave
    // those integrations unpolled anyway.
    const proofCount = stopping ? 0 : await checkProofs();
    loopPhase = "assignment_claim";
    const { assignments = [] } = stopping
      ? { assignments: [] }
      : await control.send("claim", { limit: 10, now: Date.now() }, { requirePayload: true });

    for (const assignment of assignments) {
      if (stopping) break;
      await heartbeat();
      loopPhase = "telemetry_collection";
      await collect(assignment);
    }
    controlFailures = 0;
    await pause(assignments.length > 0 || proofCount > 0 ? 1_000 : 10_000);
  } catch (error) {
    controlFailures += 1;
    logEvent(collectorLoopFailureEvent(error, loopPhase, controlFailures));
    if (collectorShouldRestart(controlFailures)) {
      logEvent(collectorRestartEvent(controlFailures));
      process.exitCode = 1;
      break;
    }
    await pause(retryDelayMs(controlFailures));
  }
}

logEvent({ event: "collector_stopped", reason: process.exitCode === 1 ? "restart" : "shutdown" });
