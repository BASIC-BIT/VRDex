/** A lease proves authority; the separate observation proves recent media state. */
export function eventBroadcastObservationFresh({
  serverNow,
  elapsedMs,
  leaseExpiresAt,
  observedAt,
  status,
}: {
  serverNow: number;
  elapsedMs: number;
  leaseExpiresAt?: number;
  observedAt?: number;
  status?: string;
}): boolean {
  const now = serverNow + elapsedMs;
  return (
    status !== undefined &&
    !["ended", "error"].includes(status) &&
    Number.isFinite(now) &&
    elapsedMs >= 0 &&
    leaseExpiresAt !== undefined &&
    Number.isFinite(leaseExpiresAt) &&
    leaseExpiresAt > now &&
    observedAt !== undefined &&
    Number.isFinite(observedAt) &&
    observedAt <= now &&
    now - observedAt < 15000
  );
}
