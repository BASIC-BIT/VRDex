import { spawn } from "node:child_process";

const syntheticVariant = process.argv[2] ?? "static-transition";
const liveControlMode = process.argv[3];
const x264Preset = process.argv[4];
const qualityGate = process.argv[5];

const defaultEnv = {
  CONVEX_URL: "https://example.invalid",
  VRDEX_RESTREAM_ARTIFACT_ROOT:
    syntheticVariant === "live-control" ? "artifacts/restream-worker-live-control-benchmark" : "artifacts/restream-worker-benchmark",
  VRDEX_RESTREAM_BENCHMARK_MODE: "dry-run",
  VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER: "/vrdex/restream/hosted-worker/enabled",
  VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS: "1",
  VRDEX_RESTREAM_MAX_SESSION_SECONDS: "120",
  VRDEX_RESTREAM_QUALITY_GATE: "1080p60",
  VRDEX_RESTREAM_SECRET_REF_NAMES: "event-media/vrcdn/local-validation",
  VRDEX_RESTREAM_SYNTHETIC_ONLY: "true",
  VRDEX_RESTREAM_SYNTHETIC_VARIANT: syntheticVariant,
  VRDEX_RESTREAM_HOLD_SLATE_AUDIO_DELAY_MS: "750",
  VRDEX_RESTREAM_TRANSITION_FADE_MS: "500",
};

const child = spawn(process.execPath, ["workers/restream/hosted-worker.mjs"], {
  env: {
    ...defaultEnv,
    ...process.env,
    VRDEX_RESTREAM_SYNTHETIC_VARIANT: syntheticVariant,
    ...(liveControlMode === undefined ? {} : { VRDEX_RESTREAM_LIVE_CONTROL_MODE: liveControlMode }),
    ...(x264Preset === undefined ? {} : { VRDEX_RESTREAM_X264_PRESET: x264Preset }),
    ...(qualityGate === undefined ? {} : { VRDEX_RESTREAM_QUALITY_GATE: qualityGate }),
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

child.on("close", (code) => {
  process.exitCode = code ?? 1;
});
