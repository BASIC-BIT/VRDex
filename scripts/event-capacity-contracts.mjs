import {
  parseMediaSettings,
  resolveDestinationProfile,
} from "../workers/restream/broadcast-profiles.mjs";
import { validateShape } from "../workers/restream/worker-allocation.mjs";
export const BENCHMARK_SHAPES = Object.freeze([
  "4096:8192",
  "8192:16384",
  "2048:4096",
  "1024:2048",
]);
export function parseCapacityArguments(args) {
  const options = {};
  const keys = new Set([
    "preset",
    "cpu",
    "memory",
    "duration-seconds",
    "simulcast",
    "output-dir",
    "audio-bitrate",
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2),
      value = args[i + 1];
    if (
      !args[i]?.startsWith("--") ||
      !keys.has(key) ||
      Object.hasOwn(options, key) ||
      !value ||
      value.startsWith("--")
    )
      throw Error("Invalid capacity arguments");
    options[key] = value;
  }
  for (const k of keys)
    if (k !== "audio-bitrate" && !Object.hasOwn(options, k))
      throw Error("Missing capacity argument");
  const settings = parseMediaSettings({
    videoPreset: options.preset,
    audioBitrateKbps: Number(options["audio-bitrate"] ?? 320),
  });
  for (const key of ["cpu", "memory", "duration-seconds"])
    if (!/^\d+$/.test(options[key])) throw Error("Invalid numeric argument");
  const shape = validateShape({
    cpuUnits: Number(options.cpu),
    memoryMiB: Number(options.memory),
  });
  if (!BENCHMARK_SHAPES.includes(`${shape.cpuUnits}:${shape.memoryMiB}`))
    throw Error("Unapproved benchmark shape");
  const durationSeconds = Number(options["duration-seconds"]);
  // This is a declared steady dual-decode interval; startup and transitions are extra.
  if (durationSeconds < 60 || durationSeconds > 1800)
    throw Error("Steady duration must be 60..1800 seconds");
  if (!["true", "false"].includes(options.simulcast))
    throw Error("Invalid simulcast");
  if (
    !/^\/tmp\/event-capacity-[a-zA-Z0-9_-]{1,80}$/.test(options["output-dir"])
  )
    throw Error("Invalid private proof directory");
  return {
    settings,
    ...shape,
    durationSeconds,
    simulcastEnabled: options.simulcast === "true",
    outputDir: options["output-dir"],
  };
}
export function quantile(values, fraction) {
  if (!values.length || values.some((v) => !Number.isFinite(v)))
    throw Error("Incomplete resource samples");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}
export function validateOutputFacts(facts, settings, destination) {
  const p = resolveDestinationProfile({ settings, destination });
  if (
    facts.videoCodec !== "h264" ||
    facts.width !== p.width ||
    facts.height !== p.height ||
    !Number.isFinite(facts.fps) ||
    facts.fps <= 0 ||
    Math.abs(facts.fps - p.frameRate) > 0.001 ||
    facts.pixelFormat !== "yuv420p" ||
    facts.audioCodec !== "aac" ||
    facts.channels !== 2 ||
    facts.sampleRate !== 48000 ||
    !(
      Number.isFinite(facts.audioKbps) &&
      facts.audioKbps >= p.audioBitrateKbps * 0.75 &&
      facts.audioKbps <= p.audioBitrateKbps * 1.25
    ) ||
    !(
      Number.isFinite(facts.maxGop) &&
      facts.maxGop > 0 &&
      facts.maxGop <= p.keyframeIntervalSeconds + 0.05
    ) ||
    !(
      Number.isFinite(facts.maxGap) &&
      facts.maxGap >= 0 &&
      facts.maxGap < 0.2
    ) ||
    facts.monotonic !== true
  )
    throw Error("Output format/packet contract failed");
  const transitionValid =
    Array.isArray(facts.transitionMarkers) &&
    facts.transitionMarkers.map((r) => r.identity).join(",") === "a,b" &&
    facts.transitionMarkers.every(
      (r) =>
        r.complete === true &&
        Number.isSafeInteger(r.programTick) &&
        r.programTick >= 0 &&
        Number.isSafeInteger(r.sourcePts) &&
        Number.isFinite(r.start) &&
        Number.isFinite(r.end) &&
        Math.abs(r.end - r.start - 4) < 0.0001 &&
        Array.isArray(r.pairs) &&
        r.pairs.length >= 3 &&
        r.pairs.every(
          (pair) =>
            Number.isFinite(pair.videoPts) &&
            Number.isFinite(pair.audioPts) &&
            Number.isFinite(pair.audioMinusVideoMs) &&
            Math.abs(
              pair.audioMinusVideoMs - (pair.audioPts - pair.videoPts) * 1000,
            ) < 0.0001 &&
            Math.abs(pair.audioMinusVideoMs) <= 100 &&
            Math.abs(pair.audioMinusVideoMs) <= facts.avDriftMs + 0.0001,
        ),
    );
  if (
    !transitionValid ||
    facts.identities?.join(",") !== "a,b,slate" ||
    !(
      Number.isFinite(facts.avDriftMs) &&
      facts.avDriftMs >= 0 &&
      facts.avDriftMs <= 100
    ) ||
    !(Number.isFinite(facts.visualPsnrDb) && facts.visualPsnrDb >= 28) ||
    !(Number.isSafeInteger(facts.markerCount) && facts.markerCount >= 3) ||
    !(
      Number.isFinite(facts.internalDelayMs) &&
      facts.internalDelayMs >= 0 &&
      facts.internalDelayMs < 2000
    )
  )
    throw Error("Output identity/quality/timing contract failed");
  return facts;
}
export function validateCapacityReceipt(r) {
  const positive = (value) =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const nonnegative = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    !r?.request ||
    !positive(r.request.durationSeconds) ||
    !positive(r.request.memoryMiB) ||
    typeof r.request.simulcastEnabled !== "boolean"
  )
    throw Error("Invalid receipt request");
  parseMediaSettings(r.request.settings);
  validateShape(r.request);
  if (
    !["durationMs", "dualDecodeMs", "samples", "maxSampleGapMs"].every((key) =>
      positive(r.steady?.[key]),
    ) ||
    !Number.isInteger(r.steady.samples) ||
    !nonnegative(r.steady.readinessLosses)
  )
    throw Error("Missing steady measurement");
  if (
    !nonnegative(r.resources?.cpuP95Percent) ||
    !positive(r.resources?.sampleCoverageMs) ||
    !positive(r.resources?.memoryPeakBytes)
  )
    throw Error("Missing resource measurement");
  if (
    r.schemaVersion !== 1 ||
    r.terminal !== true ||
    r.cleanup?.closed !== true ||
    r.cleanup?.liveChildren !== 0 ||
    r.cleanup?.liveGroups !== 0
  )
    throw Error("Missing terminal cleanup");
  if (
    r.steady?.durationMs < r.request.durationSeconds * 1000 ||
    r.steady?.dualDecodeMs < r.request.durationSeconds * 1000 ||
    r.steady?.readinessLosses !== 0 ||
    r.steady?.samples < Math.floor(r.request.durationSeconds) ||
    r.steady?.maxSampleGapMs > 1500
  )
    throw Error("Incomplete healthy dual interval");
  if (
    !(r.resources?.cpuP95Percent < 80) ||
    !Number.isFinite(r.resources?.cpuP95Percent) ||
    r.resources?.sampleCoverageMs < r.request.durationSeconds * 1000 ||
    !(r.resources?.memoryPeakBytes > 0) ||
    r.resources?.memoryPeakBytes > r.request.memoryMiB * 1048576
  )
    throw Error("Capacity contract failed");
  if (
    !positive(r.maxCompressedBufferBytes) ||
    r.maxCompressedBufferBytes > 4194304 ||
    r.maxDecoders !== 2 ||
    r.maxAcquisitions !== 2
  )
    throw Error("Input bounds failed");
  const destinations = r.request.simulcastEnabled
    ? ["vrcdn", "twitch"]
    : ["vrcdn"];
  if (
    !Array.isArray(r.outputs) ||
    r.outputs.length !== destinations.length ||
    !destinations.every(
      (destination) =>
        r.outputs.filter((output) => output?.destination === destination)
          .length === 1,
    )
  )
    throw Error("Missing or duplicate output destination");
  for (const output of r.outputs)
    validateOutputFacts(output, r.request.settings, output.destination);
  if (
    !r.artifacts?.length ||
    r.artifacts.some(
      (a) =>
        typeof a.sha256 !== "string" ||
        !/^([0-9a-f]{64})$/.test(a.sha256) ||
        !positive(a.bytes) ||
        a.complete !== true,
    )
  )
    throw Error("Incomplete evidence artifacts");
  return r;
}
