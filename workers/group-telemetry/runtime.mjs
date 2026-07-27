import { createHash, randomUUID } from "node:crypto";

import { VrchatProviderError } from "./vrchat-client.mjs";

export const COLLECTOR_VERSION = "group-telemetry-v1";

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

export function pollId(integrationId, observedAt) {
  return createHash("sha256").update(`${integrationId}:${observedAt}`).digest("hex");
}

export class TelemetryControlClient {
  constructor({ endpoint, collectorAccountId, workerApiKey, workerId = `collector-${randomUUID()}`, fetcher = fetch }) {
    this.endpoint = endpoint;
    this.collectorAccountId = collectorAccountId;
    this.workerApiKey = workerApiKey;
    this.workerId = workerId;
    this.fetcher = fetcher;
  }
  // Every control-plane call is bounded. Cleanup calls run on the shutdown
  // path, where an unbounded fetch against a wedged control plane outlasts the
  // orchestrator's SIGKILL grace period and strands the work the call was
  // trying to hand back.
  async send(operation, body = {}, { timeoutMs = 15_000 } = {}) {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.workerApiKey}`, "content-type": "application/json", "x-vrdex-collector-account": this.collectorAccountId },
      body: JSON.stringify({ operation, workerId: this.workerId, ...body }),
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
    // A body that could not be read is not an empty result. Swallowing it made
    // an aborted read indistinguishable from "no work available", so a batch the
    // control plane had already stamped was dropped on the floor and sat out its
    // whole cooldown with nobody looking at it. The deadline above makes that a
    // reachable path rather than a theoretical one.
    if (unreadable) throw new Error(`Control plane ${response.status}: response_unreadable`);

    return payload;
  }
}
