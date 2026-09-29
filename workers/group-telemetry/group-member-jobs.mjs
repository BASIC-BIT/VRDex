/** Read one public primary group in the worker's existing low-priority metadata share. */
export async function checkGroupMemberSnapshot({
  control, provider, accountBudget, metadataBudget, heartbeat, isStopping,
  reportDeadSession, pauseWithHeartbeats, logEvent, clock = Date.now,
}) {
  const available = () => !isStopping() && accountBudget.retryAfterMs(1, clock()) === 0 &&
    metadataBudget.retryAfterMs(1, clock()) === 0;
  if (!available()) return 0;
  const job = await control.send("group_member_claim", {}, { requirePayload: true });
  if (!job) return 0;
  const lease = { linkId: job.linkId, leaseToken: job.leaseToken };
  const release = () => control.send("group_member_release", lease).catch(() => undefined);
  try {
    await heartbeat();
    if (!available()) { await release(); return 0; }
    const now = clock();
    const reservation = await control.send("proof_budget", { requestCount: 1, now });
    if (!reservation?.granted) { await release(); return 0; }
    accountBudget.tryConsume(1, now);
    metadataBudget.tryConsume(1, now);
  } catch (error) {
    await release();
    throw error;
  }

  let group;
  try {
    group = await provider.getGroup(job.vrchatGroupId);
  } catch (error) {
    let retryAfterMs;
    let canComplete = true;
    if (error?.category === "rate_limit") {
      retryAfterMs = Math.min(Math.max(error.retryAfterMs ?? 60_000, 1_000), 5 * 60_000);
      const cooldown = await control.send("proof_rate_limit", { retryAfterMs, now: clock() }).catch(() => null);
      // Leave the lease to expire if the shared cooldown could not be recorded.
      canComplete = cooldown?.recorded === true;
    }
    // A failed provider read never supplies a count or a zero.
    if (canComplete) await control.send("group_member_complete", { ...lease, observedAt: clock() });
    if (error?.category === "authentication") await reportDeadSession();
    if (retryAfterMs) await pauseWithHeartbeats(retryAfterMs);
    logEvent({ event: "collector_group_member_snapshot", outcome: "provider_unavailable" });
    return 1;
  }
  await control.send("group_member_complete", {
    ...lease, memberCount: group.memberCount,
    ...(group.groupCreatedAt === undefined ? {} : { groupCreatedAt: group.groupCreatedAt }),
    observedAt: clock(),
  });
  logEvent({ event: "collector_group_member_snapshot", outcome: "observed" });
  return 1;
}
