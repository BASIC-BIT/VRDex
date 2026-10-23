import assert from "node:assert/strict";
import test from "node:test";
import { programEncoderArguments } from "../../workers/restream/program-renderer.mjs";
import { outputArguments } from "../../workers/restream/output-sender.mjs";
import { resolveDestinationProfile } from "../../workers/restream/broadcast-profiles.mjs";
import {
  parseCapacityArguments,
  validateCapacityReceipt,
} from "../../scripts/event-capacity-contracts.mjs";
const args = [
  "--preset",
  "1080p60",
  "--cpu",
  "4096",
  "--memory",
  "8192",
  "--duration-seconds",
  "300",
  "--simulcast",
  "true",
  "--output-dir",
  "/tmp/event-capacity-test",
];
// Synthetic complete proof facts, never measured allocation evidence.
function receipt() {
  const request = parseCapacityArguments(args);
  return {
    schemaVersion: 1,
    terminal: true,
    request,
    cleanup: { closed: true, liveChildren: 0, liveGroups: 0 },
    steady: {
      durationMs: 300000,
      dualDecodeMs: 300000,
      readinessLosses: 0,
      samples: 300,
      maxSampleGapMs: 1100,
    },
    resources: {
      cpuP95Percent: 70,
      sampleCoverageMs: 300000,
      memoryPeakBytes: 1000000,
    },
    maxCompressedBufferBytes: 3000000,
    maxDecoders: 2,
    maxAcquisitions: 2,
    artifacts: [{ sha256: "a".repeat(64), bytes: 1, complete: true }],
    outputs: ["vrcdn", "twitch"].map((destination) => ({
      destination,
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      fps: 60,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      channels: 2,
      sampleRate: 48000,
      audioKbps: destination === "vrcdn" ? 320 : 160,
      maxGop: destination === "vrcdn" ? 1 : 2,
      maxGap: 0.03,
      monotonic: true,
      identities: ["a", "b", "slate"],
      avDriftMs: 20,
      visualPsnrDb: 35,
      markerCount: 5,
      transitionMarkers: ["a", "b"].map((identity) => ({
        identity,
        complete: true,
        programTick: 30,
        sourcePts: 90000,
        start: 1,
        end: 5,
        pairs: [1, 2, 3].map((v) => ({
          videoPts: v,
          audioPts: v + 0.02,
          audioMinusVideoMs: 20,
        })),
      })),
      internalDelayMs: 100,
    })),
  };
}

const presets = [
  ["480p30", 854, 480, 30, 1000, "veryfast"],
  ["480p60", 854, 480, 60, 1500, "veryfast"],
  ["720p30", 1280, 720, 30, 1800, "veryfast"],
  ["720p60", 1280, 720, 60, 2500, "veryfast"],
  ["1080p30", 1920, 1080, 30, 3000, "veryfast"],
  ["1080p60", 1920, 1080, 60, 3500, "superfast"],
];
function option(args, key) {
  assert.equal(args.filter((v) => v === key).length, 1);
  return args[args.indexOf(key) + 1];
}
function encoding(args, { preset, fps, bitrate, audio, gop }) {
  for (const [key, value] of Object.entries({
    "-c:v": "libx264",
    "-threads": "2",
    "-preset": preset,
    "-g": String(fps * gop),
    "-keyint_min": String(fps * gop),
    "-sc_threshold": "0",
    "-bf": "0",
    "-b:v": `${bitrate}k`,
    "-minrate": `${bitrate}k`,
    "-maxrate": `${bitrate}k`,
    "-bufsize": `${bitrate * 2}k`,
    "-x264-params": "nal-hrd=cbr:force-cfr=1",
    "-c:a": "aac",
    "-b:a": `${audio}k`,
  }))
    assert.equal(option(args, key), value, key);
}
test("program encoder reserves faster analysis for 1080p60 without changing media limits", () => {
  for (const [videoPreset, width, height, fps, bitrate, preset] of presets)
    for (const audio of [160, 320]) {
      const a = programEncoderArguments({
        videoPreset,
        audioBitrateKbps: audio,
      });
      encoding(a, { preset, fps, bitrate, audio, gop: 1 });
      assert.equal(option(a, "-video_size"), `${width}x${height}`);
      assert.equal(option(a, "-framerate"), String(fps));
      assert.equal(option(a, "-pixel_format"), "yuv420p");
      assert.equal(option(a, "-tune"), "zerolatency");
      assert.deepEqual(
        a.filter((v, i) => a[i - 1] === "-ar"),
        ["48000", "48000"],
      );
      assert.deepEqual(
        a.filter((v, i) => a[i - 1] === "-ac"),
        ["2", "2"],
      );
    }
});
test("Twitch encoder uses the same 1080p60 policy while primary remains stream copy", () => {
  for (const [videoPreset, width, height, fps, bitrate, preset] of presets)
    for (const audio of [160, 320]) {
      const settings = { videoPreset, audioBitrateKbps: audio },
        target = { key: "synthetic", url: "rtmp://example.test/live" };
      const a = outputArguments(
        "twitch",
        target,
        resolveDestinationProfile({ settings, destination: "twitch" }),
      );
      encoding(a, { preset, fps, bitrate, audio: 160, gop: 2 });
      assert.equal(option(a, "-vf"), `scale=${width}:${height},fps=${fps}`);
      assert.equal(option(a, "-pix_fmt"), "yuv420p");
      assert.equal(option(a, "-ar"), "48000");
      assert.equal(option(a, "-ac"), "2");
      assert.equal(a.includes("-tune"), false);
      const primary = outputArguments(
        "vrcdn",
        target,
        resolveDestinationProfile({ settings, destination: "vrcdn" }),
      );
      assert.equal(option(primary, "-c"), "copy");
      assert.equal(primary.includes("-preset"), false);
    }
});
test("encoding selection still rejects invalid settings and forged destination profiles", () => {
  assert.throws(() =>
    programEncoderArguments({ videoPreset: "1080p61", audioBitrateKbps: 320 }),
  );
  assert.throws(() =>
    programEncoderArguments({
      videoPreset: "1080p60",
      audioBitrateKbps: "320",
    }),
  );
  const p = resolveDestinationProfile({
    settings: { videoPreset: "1080p60", audioBitrateKbps: 320 },
    destination: "twitch",
  });
  for (const bad of [
    { ...p, frameRate: 30 },
    { ...p, videoPreset: "wrong" },
    { ...p, audioBitrateKbps: 320 },
  ])
    assert.throws(() =>
      outputArguments(
        "twitch",
        { key: "synthetic", url: "rtmp://example.test/live" },
        bad,
      ),
    );
});
for (const [field, invalid] of [
  ["fps", [undefined, NaN, Infinity, -Infinity, 0, -1, "60", "unknown", null]],
  ["audioKbps", ["320", undefined, null, NaN, Infinity, -1, 0]],
  ["maxGop", ["1", undefined, null, NaN, Infinity, -1, 0]],
  ["maxGap", ["0.03", undefined, null, NaN, Infinity, -1]],
  ["markerCount", ["5", Infinity, 3.5, undefined, null, NaN, -1, 0]],
])
  test(`receipt rejects malformed numeric ${field} measurements`, () => {
    for (const value of invalid) {
      const r = receipt();
      if (value === undefined) delete r.outputs[0][field];
      else r.outputs[0][field] = value;
      assert.throws(
        () => validateCapacityReceipt(r),
        undefined,
        `${field}: ${String(value)}`,
      );
    }
  });
test("receipt FPS tolerance and valid measured numeric boundaries remain unchanged", () => {
  for (const fps of [59.9991, 60, 60.0009]) {
    const r = receipt();
    r.outputs[0].fps = fps;
    assert.equal(validateCapacityReceipt(r), r);
  }
  for (const fps of [59.9989, 60.0011]) {
    const r = receipt();
    r.outputs[0].fps = fps;
    assert.throws(() => validateCapacityReceipt(r));
  }
  const r = receipt();
  r.outputs[0].maxGap = 0;
  r.outputs[0].markerCount = 3;
  assert.equal(validateCapacityReceipt(r), r);
});
test("receipt compressed buffer requires an actual positive numeric byte count", () => {
  for (const value of ["3000000", undefined, null, NaN, Infinity, -1, 0]) {
    const r = receipt();
    r.maxCompressedBufferBytes = value;
    assert.throws(() => validateCapacityReceipt(r));
  }
});
test("receipt requires the exact unique primary and optional destination set", () => {
  for (const destinations of [
    ["vrcdn", "vrcdn"],
    ["twitch", "twitch"],
    ["vrcdn"],
    [],
    ["vrcdn", "twitch", "twitch"],
    ["vrcdn", "unknown"],
  ]) {
    const r = receipt(),
      original = r.outputs;
    r.outputs = destinations.map((d) => ({
      ...structuredClone(original[d === "twitch" ? 1 : 0]),
      destination: d,
    }));
    assert.throws(() => validateCapacityReceipt(r));
  }
  const r = receipt();
  r.request.simulcastEnabled = false;
  r.outputs = [r.outputs[1]];
  assert.throws(() => validateCapacityReceipt(r));
});
test("receipt destination order is immaterial but primary coverage is mandatory", () => {
  const r = receipt();
  r.outputs.reverse();
  assert.equal(validateCapacityReceipt(r), r);
  const primary = receipt();
  primary.request.simulcastEnabled = false;
  primary.outputs = [primary.outputs[0]];
  assert.equal(validateCapacityReceipt(primary), primary);
});
test("valid complete receipts are accepted without mutation", () => {
  const r = receipt(),
    before = structuredClone(r);
  assert.equal(validateCapacityReceipt(r), r);
  assert.deepEqual(r, before);
});
