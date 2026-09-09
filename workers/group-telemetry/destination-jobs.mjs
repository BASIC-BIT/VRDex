/** Process one low-priority metadata lookup without spending unreserved requests. */
export async function checkDestinationMetadata({
  destinationWorkDueAt,
  control, provider, resolve, accountBudget, metadataBudget, heartbeat,
  isStopping, reportDeadSession, pauseWithHeartbeats, logEvent, clock = Date.now,
}) {
  const available = () => !isStopping() && accountBudget.retryAfterMs(1, clock()) === 0
    && metadataBudget.retryAfterMs(1, clock()) === 0;
  if (!Number.isFinite(destinationWorkDueAt) || destinationWorkDueAt > clock() || !available()) return 0;
  const claim = await control.send("destination_claim", { limit: 1 }, { requirePayload: true });
  const { jobs = [] } = claim;
  const job = jobs[0];
  if (!job) return 0;
  const lease = { key: job.key, leaseToken: job.leaseToken };
  const release = () => control.send("destination_release", lease, { requirePayload: true }).catch(() => undefined);
  let result;
  let providerRequests = 0;
  try {
    await heartbeat();
    if (!available()) { await release(); return 0; }
    const reserve = async () => {
      // A short locator can require a second request. Reserve each real GET,
      // rather than guessing a batch cost or bypassing budgets on redirects.
      if (!available()) throw Object.assign(new Error("Metadata budget unavailable."), { category: "metadata_budget" });
      let reservation;
      try { reservation = await control.send("proof_budget", { requestCount: 1, now: clock() }); }
      catch (error) { throw Object.assign(error, { category: "control_plane" }); }
      if (!reservation?.granted) throw Object.assign(new Error("Metadata budget unavailable."), { category: "metadata_budget" });
      accountBudget.tryConsume(1, clock());
      metadataBudget.tryConsume(1, clock());
      providerRequests += 1;
    };
    result = await resolve(job, {
      requestVrchat: async (path) => {
        await reserve();
        return provider.request(path, { maxResponseBytes: 256 * 1024 });
      },
      fetcher: async (url, options) => {
        await reserve();
        return fetch(url, options);
      },
    });
  } catch (error) {
    if (error?.category === "authentication") {
      // End the provider attempt while this collector is still authorized.
      try {
        await control.send("destination_result", {
          ...lease, result: { status: "transient" },
        }, { requirePayload: true });
      } finally {
        logEvent({ event: "collector_destination_lookup", outcome: "auth_required" });
        await reportDeadSession();
      }
      return 1;
    }
    if (error?.category === "rate_limit") {
      const retryAfterMs = Math.min(Math.max(error.retryAfterMs ?? 60_000, 1_000), 5 * 60_000);
      // Publish the account cooldown before ending this failed attempt.
      // Keep the lease for recovery if that shared cooldown cannot be recorded.
      const cooldown = await control.send("proof_rate_limit", { retryAfterMs, now: clock() }).catch(() => null);
      if (cooldown?.recorded === true) {
        await control.send("destination_result", {
          ...lease, result: { status: "transient", retryAfterMs: error.retryAfterMs ?? 60_000 },
        }, { requirePayload: true });
      }
      logEvent({ event: "collector_provider_backoff", category: "rate_limit", retryAfterMs });
      await pauseWithHeartbeats(retryAfterMs);
      return 1;
    }
    if (error?.category === "metadata_budget") {
      if (providerRequests === 0) { await release(); return 0; }
      // A partially attempted lookup ends here; only a later eligible visit retries.
      result = { status: "transient" };
    } else {
      // A control-plane failure must reach the worker restart/backoff policy.
      // The lease expires if the release cannot be acknowledged.
      await release();
      throw error;
    }
  }
  const recorded = await control.send("destination_result", { ...lease, result }, { requirePayload: true });
  logEvent({ event: "collector_destination_lookup", outcome: recorded?.accepted === true ? result.status : "discarded" });
  return 1;
}
