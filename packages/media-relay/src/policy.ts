import type { RenditionSnapshot } from "./contracts";

export const RELAY_POLICY = Object.freeze({
  objectRetentionMs: 600000,
  idleGraceMs: 180000,
  sourceRecoveryBudgetMs: 30000,
  grantLifetimeMs: 43200000,
  segmentUrlValidityMs: 300000,
  freshnessFloorMs: 10000,
  freshnessTargetMultiplier: 3,
  targetSegmentDurationSeconds: 2,
  leaseDurationMs: 30000,
  leaseRenewIntervalMs: 10000,
  localWatchdogIntervalMs: 250,
  rollingWindowSegments: 8,
});

/** Cross-process timestamps use server time; watchdog elapsed checks use monotonic time. */
export function isSnapshotFresh(
  snapshot: RenditionSnapshot,
  now: number,
): boolean {
  const age = now - snapshot.generatedAt;
  return (
    Number.isFinite(now) &&
    age >= 0 &&
    age <
      Math.max(
        RELAY_POLICY.freshnessFloorMs,
        RELAY_POLICY.freshnessTargetMultiplier *
          snapshot.targetDurationSeconds *
          1000,
      )
  );
}
