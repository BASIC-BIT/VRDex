// Complete construction/authority DATA; the whole original is charged.
export const MASS_FRAME_CONSTRUCTION = Object.freeze({
  width: 854,
  height: 480,
  samplesPerFrame: 1600,
  flashFrames: 3,
  defaultSource: "a",
  idleIdentity: "slate",
  defaultSlot: 0,
});
export const TONE_DEFAULTS = Object.freeze({
  source: "a",
  phase: 0,
  foreignPhase: 0,
  placement: 0,
  durationMs: 0,
  jump: 0,
  ratio: 0.25,
  loudSamples: 4800,
});
export const TONE_CONSTRUCTION = Object.freeze({
  sampleRateHz: 48000,
  samplesPerMillisecond: 48,
  amplitude: 0.65,
  hiddenSamples: 5280,
  hiddenForeignSamples: 480,
  unknownFrequencyHz: 1000,
  phaseJumpAt: 2400,
  foreignWindowSamples: 4800,
  foreignCenterSample: 2400,
  mixtureSamples: 1440,
  equalMixtureRatio: 1,
});
export const LITERAL_DEFAULTS = Object.freeze({
  onset: 960,
  tail: 1440,
  rowSamples: 1024,
  noise: "none",
});
export const LITERAL_NOISE = Object.freeze({
  amplitude: 0.12,
});
export const NATIVE_NOISE = Object.freeze({
  seeds: Object.freeze([42, 43]),
  color: "white",
  amplitude: 0.12,
  programRateHz: 48000,
  channelsText: "1",
  sampleFormat: "s16le",
  durationPaddingRateUnits: 1,
});
export const TRAIN_CONSTRUCTION = Object.freeze({
  gapSeed: 42,
});
