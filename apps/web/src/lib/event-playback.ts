import { AUDIO_OBSERVATION_FRESHNESS_MS } from "./event-audio-observation";

export const HANDOFF_PREPARE_MS = 120_000;
export const FAILURE_CONFIRMATION_MS = 1_000;

export type PlaybackStream = {
  streamId: string;
  pcUrl: string;
  questUrl: string;
};

export type PlaybackSlot = {
  key: string;
  startAt: number;
  endAt?: number;
  stream?: PlaybackStream;
};

/** Evidence timestamps are from one monotonic clock, such as performance.now(). */
export type PlaybackEvidence = {
  failureSince?: number;
  silenceSince?: number;
  observedAt: number;
  progressing: boolean;
  analysisActive: boolean;
};

/**
 * Schedule timestamps and observation timestamps intentionally use separate clocks.
 * Task 5 should pass Date.now() as scheduleNow and performance.now() as observationNow.
 */
export type HandoffInput = {
  scheduleNow: number;
  observationNow: number;
  eligibleAt: number;
  following: boolean;
  paused: boolean;
  nextReady: boolean;
  evidence: PlaybackEvidence;
  silenceDurationMs: number;
};

function validTimestamp(value: number): boolean {
  return Number.isFinite(value);
}

/** Selects the single slot whose authored half-open interval contains scheduleNow. */
export function joinSlot(
  slots: readonly PlaybackSlot[],
  scheduleNow: number,
): PlaybackSlot | undefined {
  if (!validTimestamp(scheduleNow)) return undefined;

  let match: PlaybackSlot | undefined;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const next = slots[index + 1];
    if (
      !validTimestamp(slot.startAt) ||
      (slot.endAt !== undefined &&
        (!validTimestamp(slot.endAt) || slot.endAt < slot.startAt)) ||
      (next !== undefined &&
        (!validTimestamp(next.startAt) || next.startAt < slot.startAt))
    ) {
      return undefined;
    }

    const effectiveEnd = slot.endAt ?? next?.startAt;
    const active =
      scheduleNow >= slot.startAt &&
      (effectiveEnd === undefined || scheduleNow < effectiveEnd);
    if (!active) continue;
    if (match !== undefined) return undefined;
    match = slot;
  }

  return match;
}

/** Returns the first wall-clock instant at which the next source may be prepared. */
export function handoffEligibleAt(
  current: PlaybackSlot,
  next: PlaybackSlot,
): number {
  const boundary = current.endAt ?? next.startAt;
  if (!validTimestamp(boundary) || !validTimestamp(next.startAt)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(boundary - HANDOFF_PREPARE_MS, next.startAt - HANDOFF_PREPARE_MS);
}

/** Decides a handoff from fresh observed evidence without comparing clock domains. */
export function shouldHandoff(input: HandoffInput): boolean {
  const {
    scheduleNow,
    observationNow,
    eligibleAt,
    following,
    paused,
    nextReady,
    evidence,
    silenceDurationMs,
  } = input;
  if (
    !following ||
    paused ||
    !nextReady ||
    !validTimestamp(scheduleNow) ||
    !validTimestamp(eligibleAt) ||
    scheduleNow < eligibleAt ||
    !validTimestamp(observationNow) ||
    !validTimestamp(evidence.observedAt)
  ) {
    return false;
  }

  const age = observationNow - evidence.observedAt;
  if (age < 0 || age > AUDIO_OBSERVATION_FRESHNESS_MS) return false;

  const failureDuration =
    evidence.failureSince === undefined
      ? -1
      : evidence.observedAt - evidence.failureSince;
  const failureQualified =
    validTimestamp(failureDuration) && failureDuration >= FAILURE_CONFIRMATION_MS;

  const silenceDuration =
    evidence.silenceSince === undefined
      ? -1
      : evidence.observedAt - evidence.silenceSince;
  const silenceQualified =
    Number.isFinite(silenceDurationMs) &&
    silenceDurationMs >= 0 &&
    evidence.progressing &&
    evidence.analysisActive &&
    validTimestamp(silenceDuration) &&
    silenceDuration >= silenceDurationMs;

  return failureQualified || silenceQualified;
}
