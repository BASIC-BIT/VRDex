import { createHash, randomUUID } from "node:crypto";

import { VrchatProviderError } from "./vrchat-client.mjs";

export const COLLECTOR_VERSION = "group-telemetry-v1";
export const COLLECTOR_CAPABILITIES = Object.freeze(["telemetry_v1", "vrchat_proof_v1"]);
export const MAX_CONSECUTIVE_LOOP_FAILURES = 6;
const PROVIDER_CATEGORIES = new Set([
  "authentication",
  "rate_limit",
  "visibility",
  "transient",
  "schema_drift",
  "timeout",
  "provider_error",
]);

export function boundedProviderCategory(value) {
  return typeof value === "string" && PROVIDER_CATEGORIES.has(value)
    ? value
    : "unexpected";
}

export function collectorRuntimeMetadata(environment = process.env) {
  const releaseSha = environment.VRDEX_GROUP_TELEMETRY_RELEASE_SHA?.trim().toLowerCase();
  if (!releaseSha || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(releaseSha)) {
    throw new Error("VRDEX_GROUP_TELEMETRY_RELEASE_SHA must be an exact Git SHA.");
  }
  return {
    releaseSha,
    collectorVersion: COLLECTOR_VERSION,
    capabilities: [...COLLECTOR_CAPABILITIES],
  };
}

export function randomPollDelayMs(active, random = Math.random) {
  const [minimum, maximum] = active ? [60_000, 120_000] : [180_000, 300_000];
  return Math.floor(minimum + random() * (maximum - minimum + 1));
}

export function retryDelayMs(attempt, retryAfterMs, random = Math.random) {
  const exponential = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, Math.min(attempt, 8)));
  return Math.max(retryAfterMs ?? 0, Math.floor(exponential * (0.8 + random() * 0.4)));
}

export class RequestBudget {
  constructor(limit, windowMs = 60_000) {
    this.limit = Math.max(1, Math.floor(limit));
    this.windowMs = windowMs;
    this.requests = [];
  }
  tryConsume(count = 1, now = Date.now()) {
    this.requests = this.requests.filter((timestamp) => timestamp > now - this.windowMs);
    if (this.requests.length + count > this.limit) return false;
    for (let index = 0; index < count; index += 1) this.requests.push(now);
    return true;
  }
  remaining(now = Date.now()) {
    this.requests = this.requests.filter((timestamp) => timestamp > now - this.windowMs);
    return Math.max(0, this.limit - this.requests.length);
  }
  retryAfterMs(count = 1, now = Date.now()) {
    this.requests = this.requests.filter((timestamp) => timestamp > now - this.windowMs);
    if (count > this.limit) return this.windowMs;
    if (this.requests.length + count <= this.limit) return 0;
    const blockingIndex = this.requests.length + count - this.limit - 1;
    return Math.max(1, this.requests[blockingIndex] + this.windowMs - now);
  }
}

export function failureDisposition(error, attempt, now = Date.now(), random = Math.random) {
  const provider = error instanceof VrchatProviderError ? error : new VrchatProviderError("Unexpected collector failure.");
  const delay = retryDelayMs(attempt, provider.retryAfterMs, random);
  return {
    statusClass: provider.status > 0 ? String(provider.status) : provider.category,
    coverageState: provider.category === "visibility" ? "unknown" : "degraded",
    nextPollAt: now + delay,
    backoffUntil: now + delay,
    detail: provider.category,
    stopAccount: provider.category === "authentication",
  };
}

export function collectorLoopFailureEvent(error, phase, attempt) {
  const message = error instanceof Error ? error.message : "";
  const controlPlaneStatus = /^Control plane ([1-5][0-9]{2}):/.exec(message)?.[1];
  const providerStatus = error instanceof VrchatProviderError && error.status > 0
    ? String(error.status)
    : undefined;
  const failureClass = error instanceof VrchatProviderError
    ? "provider"
    : controlPlaneStatus !== undefined
      ? "control_plane_http"
      : error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
        ? "timeout"
        : error instanceof TypeError
          ? "transport"
          : "unexpected";

  return {
    event: "collector_control_plane_failure",
    phase,
    attempt,
    failureClass,
    ...(error instanceof VrchatProviderError
      ? { category: boundedProviderCategory(error.category) }
      : {}),
    ...(controlPlaneStatus === undefined && providerStatus === undefined
      ? {}
      : { status: controlPlaneStatus ?? providerStatus }),
  };
}

export function collectorRestartEvent(attempt) {
  return {
    event: "collector_worker_restart",
    reason: "consecutive_loop_failures",
    attempt,
  };
}

export function collectorAuthRequiredEvent() {
  return { event: "collector_auth_required" };
}

export function collectorShouldRestart(attempt) {
  return attempt >= MAX_CONSECUTIVE_LOOP_FAILURES;
}

export function pollId(integrationId, observedAt) {
  return createHash("sha256").update(`${integrationId}:${observedAt}`).digest("hex");
}

export class TelemetryControlClient {
  constructor({ endpoint, collectorAccountId, workerApiKey, vrchatUserId, workerId = `collector-${randomUUID()}`, fetcher = fetch }) {
    this.endpoint = endpoint;
    this.collectorAccountId = collectorAccountId;
    this.workerApiKey = workerApiKey;
    // The identity recorded in this worker's own secret. The control plane
    // rejects the request when it does not match the collector the account id
    // names, so a mismatched secret/collector pairing cannot do work.
    this.vrchatUserId = vrchatUserId;
    this.workerId = workerId;
    this.fetcher = fetcher;
  }
  // Every control-plane call is bounded. Cleanup calls run on the shutdown
  // path, where an unbounded fetch against a wedged control plane outlasts the
  // orchestrator's SIGKILL grace period and strands the work the call was
  // trying to hand back.
  async send(operation, body = {}, { timeoutMs = 15_000, requirePayload = false } = {}) {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.workerApiKey}`, "content-type": "application/json", "x-vrdex-collector-account": this.collectorAccountId },
      body: JSON.stringify({
        operation,
        workerId: this.workerId,
        ...(this.vrchatUserId === undefined ? {} : { vrchatUserId: this.vrchatUserId }),
        ...body,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let payload = {};
    let unreadable = false;

    try {
      const text = await response.text();
      payload = text.length === 0 ? {} : JSON.parse(text);
    } catch {
      unreadable = true;
    }

    if (!response.ok) throw new Error(`Control plane ${response.status}: ${payload.error ?? "request_failed"}`);
    // A body that could not be read is not an empty result — but only where the
    // caller needs the payload. For `claim` and `proof_claim`, swallowing it made
    // an aborted read indistinguishable from "no work available", so a batch the
    // control plane had already stamped sat out its whole cooldown with nobody
    // looking at it.
    //
    // Write-only operations are the opposite: a 2xx whose body was truncated
    // means the mutation committed. Throwing there routes a succeeded poll into
    // `failureDisposition`, which reports a provider failure, increments
    // `consecutiveFailures`, and marks coverage degraded — blaming VRChat for a
    // control-plane transport fault.
    if (unreadable && requirePayload) {
      throw new Error(`Control plane ${response.status}: response_unreadable`);
    }

    return payload;
  }
}
