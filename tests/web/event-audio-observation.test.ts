import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUDIO_OBSERVATION_FRESHNESS_MS,
  AUDIO_OBSERVATION_INTERVAL_MS,
  AUDIO_SILENCE_THRESHOLD_DBFS,
  clearPlaybackEvidence,
  observeAudio,
  type AudioObservationSample,
} from "../../apps/web/src/lib/event-audio-observation";

function sample(
  observedAt: number,
  overrides: Partial<AudioObservationSample> = {},
): AudioObservationSample {
  return {
    observedAt,
    dbfs: -20,
    progressing: true,
    analysisActive: true,
    paused: false,
    disconnected: false,
    ...overrides,
  };
}

describe("audio observation", () => {
  it("uses the measured settings", () => {
    assert.equal(AUDIO_SILENCE_THRESHOLD_DBFS, -90);
    assert.equal(AUDIO_OBSERVATION_INTERVAL_MS, 100);
    assert.equal(AUDIO_OBSERVATION_FRESHNESS_MS, 500);
  });

  it("accumulates continuous failure at monotonic sample timestamps", () => {
    let evidence = clearPlaybackEvidence(0);
    for (let observedAt = 100; observedAt <= 1_000; observedAt += 100) {
      evidence = observeAudio(evidence, sample(observedAt, { progressing: false }));
    }
    evidence = observeAudio(evidence, sample(1_100, { disconnected: true }));
    assert.equal(evidence.failureSince, 100);
    assert.equal(evidence.silenceSince, undefined);
  });

  it("clears a failure on recovery and starts a fresh timer on relapse", () => {
    let evidence = observeAudio(undefined, sample(100, { disconnected: true }));
    evidence = observeAudio(evidence, sample(900, { progressing: true }));
    assert.equal(evidence.failureSince, undefined);
    evidence = observeAudio(evidence, sample(950, { progressing: false }));
    assert.equal(evidence.failureSince, 950);
  });

  it("tracks continuous source silence only while decoded media progresses", () => {
    let evidence = clearPlaybackEvidence(0);
    for (let observedAt = 100; observedAt <= 1_100; observedAt += 100) {
      evidence = observeAudio(evidence, sample(observedAt, { dbfs: -240 }));
    }
    assert.equal(evidence.silenceSince, 100);
    assert.equal(evidence.failureSince, undefined);
    evidence = observeAudio(evidence, sample(1_200, { dbfs: -89.9 }));
    assert.equal(evidence.silenceSince, undefined);
  });

  it("treats no progress as failure rather than silence", () => {
    const evidence = observeAudio(undefined, sample(100, { dbfs: -240, progressing: false }));
    assert.equal(evidence.failureSince, 100);
    assert.equal(evidence.silenceSince, undefined);
  });

  it("resets on pause or inactive analysis", () => {
    const failing = observeAudio(undefined, sample(100, { disconnected: true }));
    assert.deepEqual(observeAudio(failing, sample(200, { paused: true })), clearPlaybackEvidence(200));
    assert.deepEqual(
      observeAudio(failing, sample(200, { analysisActive: false })),
      clearPlaybackEvidence(200),
    );
  });

  it("resets without accumulating on a gap, backward clock, or invalid timestamp", () => {
    const failing = observeAudio(undefined, sample(100, { disconnected: true }));
    assert.deepEqual(
      observeAudio(failing, sample(601, { disconnected: true })),
      clearPlaybackEvidence(601),
    );
    assert.deepEqual(
      observeAudio(failing, sample(99, { disconnected: true })),
      clearPlaybackEvidence(99),
    );
    assert.deepEqual(
      observeAudio(failing, sample(Number.NaN, { disconnected: true })),
      clearPlaybackEvidence(100),
    );
  });

  it("does not accept viewer mute or volume as observation inputs", () => {
    const keys: readonly (keyof AudioObservationSample)[] = [
      "observedAt",
      "dbfs",
      "progressing",
      "analysisActive",
      "paused",
      "disconnected",
    ];
    assert.equal(keys.includes("muted" as keyof AudioObservationSample), false);
    assert.equal(keys.includes("volume" as keyof AudioObservationSample), false);
  });
});
