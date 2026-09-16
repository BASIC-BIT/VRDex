import type { PlaybackEvidence } from "./event-playback";

export const AUDIO_SILENCE_THRESHOLD_DBFS = -90;
export const AUDIO_SILENCE_DURATION_MS = 1_000;
export const AUDIO_OBSERVATION_INTERVAL_MS = 100;
export const AUDIO_OBSERVATION_FRESHNESS_MS = 500;

/** Values come from decoded playback and an analyser upstream of viewer gain. */
export type AudioObservationSample = {
  observedAt: number;
  dbfs: number;
  progressing: boolean;
  analysisActive: boolean;
  paused: boolean;
  disconnected: boolean;
};

export function clearPlaybackEvidence(observedAt: number): PlaybackEvidence {
  return {
    observedAt: Number.isFinite(observedAt) ? observedAt : 0,
    progressing: false,
    analysisActive: false,
  };
}

function evidenceWithoutTimers(sample: AudioObservationSample): PlaybackEvidence {
  return {
    observedAt: sample.observedAt,
    progressing: sample.progressing,
    analysisActive: sample.analysisActive,
  };
}

/**
 * Accumulates continuous failure or silence evidence. A discontinuity consumes the
 * first resumed sample as a reset, so a fresh interval starts on a later sample.
 */
export function observeAudio(
  previous: PlaybackEvidence | undefined,
  sample: AudioObservationSample,
): PlaybackEvidence {
  const fallbackAt = previous?.observedAt ?? 0;
  if (!Number.isFinite(sample.observedAt)) {
    return clearPlaybackEvidence(fallbackAt);
  }

  if (sample.paused || !sample.analysisActive) {
    return clearPlaybackEvidence(sample.observedAt);
  }

  if (previous !== undefined) {
    if (!previous.analysisActive) {
      return evidenceWithoutTimers(sample);
    }

    const elapsed = sample.observedAt - previous.observedAt;
    if (
      !Number.isFinite(previous.observedAt) ||
      elapsed < 0 ||
      elapsed > AUDIO_OBSERVATION_FRESHNESS_MS
    ) {
      return evidenceWithoutTimers(sample);
    }
  }

  const failure = sample.disconnected || !sample.progressing;
  const silence =
    !failure &&
    Number.isFinite(sample.dbfs) &&
    sample.dbfs < AUDIO_SILENCE_THRESHOLD_DBFS;

  return {
    observedAt: sample.observedAt,
    progressing: sample.progressing,
    analysisActive: sample.analysisActive,
    ...(failure
      ? { failureSince: previous?.failureSince ?? sample.observedAt }
      : {}),
    ...(silence
      ? { silenceSince: previous?.silenceSince ?? sample.observedAt }
      : {}),
  };
}
