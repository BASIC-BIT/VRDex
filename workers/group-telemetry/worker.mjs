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

while (!stopping) {
  try {
    const { assignments = [] } = await control.send("claim", { limit: 10, now: Date.now() });
    controlFailures = 0;
    for (const assignment of assignments) {
      if (stopping) break;
      await collect(assignment);
    }
    await sleep(assignments.length > 0 ? 1_000 : 10_000);
  } catch {
    controlFailures += 1;
    await sleep(retryDelayMs(controlFailures));
  }
}
