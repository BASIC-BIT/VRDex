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
  playableWindowTargetMultiplier: 3,
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

/** A native live client needs a complete playable window, not merely a fresh fragment. */
export function hasPlayableWindow(snapshot: RenditionSnapshot): boolean {
  return snapshot.segments.reduce((seconds, segment) => seconds + segment.durationSeconds, 0) >=
    RELAY_POLICY.playableWindowTargetMultiplier * snapshot.targetDurationSeconds;
}

export function areRenditionsPlayable(
  snapshots: Partial<Record<"video" | "audio", RenditionSnapshot>>,
  now: number,
  epoch: number | undefined,
): boolean {
  const { video, audio } = snapshots;
  return Boolean(video && audio && epoch !== undefined &&
    video.epoch === epoch && audio.epoch === epoch && video.streamKey === audio.streamKey &&
    video.rendition === "video" && audio.rendition === "audio" &&
    isSnapshotFresh(video, now) && isSnapshotFresh(audio, now) &&
    hasPlayableWindow(video) && hasPlayableWindow(audio) &&
    new Set([...video.segments, ...audio.segments].map(segment =>
      segment.objectKey.slice(0, segment.objectKey.lastIndexOf("/")))).size === 1);
}
