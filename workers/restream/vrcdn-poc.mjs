import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { ProgramController, ZmqCommandClient, sleep } from "./live-control.mjs";

const QUALITY_PROFILES = {
  "1080p60": { width: 1920, height: 1080, frameRate: 60, videoBitrateKbps: 3500 },
  "1080p30": { width: 1920, height: 1080, frameRate: 30, videoBitrateKbps: 3000 },
  "720p60": { width: 1280, height: 720, frameRate: 60, videoBitrateKbps: 2500 },
  "720p30": { width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 1800 },
};
const POC_MODES = new Set(["source-pusher", "output-restream", "single-output-smoke"]);
const SOURCE_KEYS = new Set(["source-a", "source-b"]);
const X264_PRESETS = new Set(["ultrafast", "superfast", "veryfast", "faster", "fast"]);
const DEFAULT_DURATION_SECONDS = 600;
const DEFAULT_STARTUP_TIMEOUT_SECONDS = 60;
const DEFAULT_ARTIFACT_ROOT = process.env.AWS_EXECUTION_ENV ? "/tmp/vrdex-vrcdn-poc" : "artifacts/restream-vrcdn-poc";
const DEFAULT_ZMQ_PORT = 5555;

function requiredEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];

  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return value.trim();
}

function requiredIntegerEnv(name, defaultValue, min, max) {
  const value = optionalEnv(name) ?? String(defaultValue);

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return parsed;
}

function publicPlaybackUrlEnv(name) {
  const value = requiredEnv(name);
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid public playback URL.`);
  }

  if (!new Set(["https:", "http:", "rtspt:", "rtsp:"]).has(url.protocol.toLowerCase())) {
    throw new Error(`${name} must use http, https, rtsp, or rtspt.`);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a stable public playback URL, not a signed URL or credential-bearing URL.`);
  }

  return url.href;
}

function validateRtmpUrl(name, value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid RTMP or RTMPS ingest URL.`);
  }

  if (!new Set(["rtmp:", "rtmps:"]).has(url.protocol.toLowerCase())) {
    throw new Error(`${name} must use rtmp or rtmps.`);
  }

  return value;
}

function rtmpAppFromUrl(name, rtmpUrl) {
  const url = new URL(rtmpUrl);
  const app = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

  if (app === "") {
    throw new Error(`${name} must include the RTMP app path.`);
  }

  return app;
}

function ingestTargetFromDirectUrl(name, value) {
  return { url: validateRtmpUrl(name, value), outputOptions: [], redactValues: [value] };
}

function ingestTargetFromSplitSecretJson(name, rtmpUrl, streamKey) {
  if (typeof rtmpUrl !== "string" || typeof streamKey !== "string") {
    throw new Error("Ingest secret JSON must include string rtmpUrl and streamKey fields, or an ingestUrl field.");
  }

  if (streamKey.trim() === "" || streamKey.includes("://") || /\s/.test(streamKey)) {
    throw new Error("Ingest secret JSON streamKey must be a non-empty stream key, not a URL.");
  }

  const url = validateRtmpUrl(`${name}.rtmpUrl`, rtmpUrl);
  const app = rtmpAppFromUrl(`${name}.rtmpUrl`, url);

  return {
    url,
    outputOptions: ["-rtmp_app", app, "-rtmp_playpath", streamKey],
    redactValues: [streamKey, `${url.replace(/\/+$/, "")}/${streamKey}`],
  };
}

function ingestUrlFromSecretJson(name, value) {
  let parsed;

  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be JSON with ingestUrl or rtmpUrl and streamKey fields.`);
  }

  if (typeof parsed.ingestUrl === "string") {
    return ingestTargetFromDirectUrl(`${name}.ingestUrl`, parsed.ingestUrl);
  }

  return ingestTargetFromSplitSecretJson(name, parsed.rtmpUrl, parsed.streamKey);
}

function ingestTargetEnv(urlName, secretJsonName) {
  const value = optionalEnv(urlName);
  const secretJson = optionalEnv(secretJsonName);

  if (value === undefined && secretJson === undefined) {
    throw new Error(`${urlName} or ${secretJsonName} is required.`);
  }

  if (value !== undefined && secretJson !== undefined) {
    throw new Error(`${urlName} and ${secretJsonName} must not both be set.`);
  }

  return value === undefined ? ingestUrlFromSecretJson(secretJsonName, secretJson) : ingestTargetFromDirectUrl(urlName, value);
}

function assertAllowed(value, allowed, message) {
  if (!allowed.has(value)) {
    throw new Error(message);
  }

  return value;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with ${code}${stderr ? `\n${sanitizeLog(stderr, options.redactValues)}` : ""}`));
    });
  });
}

function sanitizeLog(value, redactValues = []) {
  let sanitized = value;

  for (const secret of redactValues) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }

  return sanitized;
}

function scalePixels(value, total) {
  return Math.round(value * total);
}

async function writePocSlate(imagePath, profile) {
  const titleSize = Math.max(52, Math.round(profile.height * 0.085));
  const bodySize = Math.max(26, Math.round(profile.height * 0.036));

  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x020617:size=${profile.width}x${profile.height}:rate=1`,
    "-vf",
    [
      "format=rgba",
      `drawbox=x=${scalePixels(0.1, profile.width)}:y=${scalePixels(0.16, profile.height)}:w=${scalePixels(0.8, profile.width)}:h=${scalePixels(0.68, profile.height)}:color=0x0f172a@0.94:t=fill`,
      `drawbox=x=${scalePixels(0.14, profile.width)}:y=${scalePixels(0.23, profile.height)}:w=${scalePixels(0.72, profile.width)}:h=${scalePixels(0.5, profile.height)}:color=0x38bdf8@0.18:t=8`,
      `drawtext=text='VRDex POC Hold':fontcolor=white:fontsize=${titleSize}:x=(w-text_w)/2:y=${scalePixels(0.41, profile.height)}`,
      `drawtext=text='Switching live source':fontcolor=0xcbd5e1:fontsize=${bodySize}:x=(w-text_w)/2:y=${scalePixels(0.54, profile.height)}`,
      "format=rgb24",
    ].join(","),
    "-frames:v",
    "1",
    "-update",
    "1",
    imagePath,
  ]);
}

function sourceVisual(sourceKey, profile) {
  const title = sourceKey === "source-a" ? "VRDex Source A" : "VRDex Source B";
  const color = sourceKey === "source-a" ? "0x2563eb" : "0xf97316";
  const titleSize = Math.max(48, Math.round(profile.height * 0.08));

  return [
    `drawbox=x=0:y=0:w=iw:h=ih:color=${color}@0.22:t=fill`,
    `drawbox=x=${scalePixels(0.06, profile.width)}:y=${scalePixels(0.08, profile.height)}:w=${scalePixels(0.88, profile.width)}:h=${scalePixels(0.18, profile.height)}:color=0x020617@0.66:t=fill`,
    `drawtext=text='${title}':fontcolor=white:fontsize=${titleSize}:x=(w-text_w)/2:y=${scalePixels(0.13, profile.height)}`,
  ].join(",");
}

function videoNormalize(label, profile) {
  return `[${label}:v]scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease,pad=w=${profile.width}:h=${profile.height}:x=(ow-iw)/2:y=(oh-ih)/2:color=black,fps=${profile.frameRate},format=yuv420p,setsar=1`;
}

function buildExternalHardSwitchGraph(profile) {
  return [
    `${videoNormalize("0", profile)}[v0]`,
    `[1:v]fps=${profile.frameRate},format=yuv420p,setsar=1[v1]`,
    `${videoNormalize("2", profile)}[v2]`,
    "[v0][v1][v2]streamselect@video-source=inputs=3:map=0,zmq[v]",
    "[0:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0]",
    "[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a1]",
    "[2:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a2]",
    "[a0][a1][a2]astreamselect@audio-source=inputs=3:map=0,aresample=48000[a]",
  ].join(";");
}

function buildSingleOutputSmokeGraph(profile) {
  return [
    `[0:v]format=yuv420p,${sourceVisual("source-a", profile)},setsar=1,split=2[v0a][v0b]`,
    `[1:v]fps=${profile.frameRate},format=yuv420p,setsar=1[v1]`,
    "[v0a][v1][v0b]streamselect@video-source=inputs=3:map=0,zmq[v]",
    "[2:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS,asplit=2[a0a][a0b]",
    "[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a1]",
    "[a0a][a1][a0b]astreamselect@audio-source=inputs=3:map=0,aresample=48000[a]",
  ].join(";");
}

function sourcePusherArgs(config) {
  const profile = config.qualityProfile;
  const visualSource = config.sourceKey === "source-a" ? "testsrc2" : "smptebars";
  const tone = config.sourceKey === "source-a" ? 440 : 880;

  return [
    "-hide_banner",
    "-nostats",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `${visualSource}=size=${profile.width}x${profile.height}:rate=${profile.frameRate}:duration=${config.durationSeconds}`,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${tone}:sample_rate=48000:duration=${config.durationSeconds}`,
    "-filter_complex",
    `[0:v]format=yuv420p,${sourceVisual(config.sourceKey, profile)}[v];[1:a]pan=stereo|c0=c0|c1=c0[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    config.x264Preset,
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(profile.frameRate),
    "-g",
    String(profile.frameRate * 2),
    "-keyint_min",
    String(profile.frameRate * 2),
    "-sc_threshold",
    "0",
    "-b:v",
    `${profile.videoBitrateKbps}k`,
    "-maxrate",
    `${profile.videoBitrateKbps}k`,
    "-bufsize",
    `${profile.videoBitrateKbps * 2}k`,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "flv",
    ...config.ingestTarget.outputOptions,
    config.ingestTarget.url,
  ];
}

function outputRestreamArgs(config, holdSlateImage) {
  const profile = config.qualityProfile;

  return [
    "-hide_banner",
    "-nostats",
    "-stats_period",
    "0.5",
    "-progress",
    "pipe:1",
    "-thread_queue_size",
    "1024",
    "-i",
    config.sourceAPlaybackUrl,
    "-re",
    "-loop",
    "1",
    "-framerate",
    String(profile.frameRate),
    "-i",
    holdSlateImage,
    "-thread_queue_size",
    "1024",
    "-i",
    config.sourceBPlaybackUrl,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:sample_rate=48000:duration=${config.durationSeconds}`,
    "-filter_complex",
    buildExternalHardSwitchGraph(profile),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    String(config.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    config.x264Preset,
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(profile.frameRate),
    "-g",
    String(profile.frameRate * 2),
    "-keyint_min",
    String(profile.frameRate * 2),
    "-sc_threshold",
    "0",
    "-b:v",
    `${profile.videoBitrateKbps}k`,
    "-maxrate",
    `${profile.videoBitrateKbps}k`,
    "-bufsize",
    `${profile.videoBitrateKbps * 2}k`,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    ...config.outputIngestTarget.outputOptions,
    "-f",
    "flv",
    config.outputIngestTarget.url,
  ];
}

function singleOutputSmokeArgs(config, holdSlateImage) {
  const profile = config.qualityProfile;

  return [
    "-hide_banner",
    "-nostats",
    "-stats_period",
    "0.5",
    "-progress",
    "pipe:1",
    "-re",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${profile.width}x${profile.height}:rate=${profile.frameRate}:duration=${config.durationSeconds}`,
    "-re",
    "-loop",
    "1",
    "-framerate",
    String(profile.frameRate),
    "-i",
    holdSlateImage,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${config.durationSeconds}`,
    "-re",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:sample_rate=48000:duration=${config.durationSeconds}`,
    "-filter_complex",
    buildSingleOutputSmokeGraph(profile),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    String(config.durationSeconds),
    "-c:v",
    "libx264",
    "-preset",
    config.x264Preset,
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(profile.frameRate),
    "-g",
    String(profile.frameRate * 2),
    "-keyint_min",
    String(profile.frameRate * 2),
    "-sc_threshold",
    "0",
    "-b:v",
    `${profile.videoBitrateKbps}k`,
    "-maxrate",
    `${profile.videoBitrateKbps}k`,
    "-bufsize",
    `${profile.videoBitrateKbps * 2}k`,
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    ...config.outputIngestTarget.outputOptions,
    "-f",
    "flv",
    config.outputIngestTarget.url,
  ];
}

class SafeFfmpegProcess {
  constructor(args, options = {}) {
    this.args = args;
    this.redactValues = options.redactValues ?? [];
    this.startedAt = performance.now();
    this.progressMs = 0;
    this.progressBuffer = "";
    this.progressSamples = [];
    this.stderr = "";
    this.child = spawn(options.command ?? "ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

    this.child.stdout.on("data", (chunk) => this.readProgress(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += sanitizeLog(String(chunk), this.redactValues);
    });
  }

  readProgress(chunk) {
    this.progressBuffer += chunk;
    const lines = this.progressBuffer.split(/\r?\n/);
    this.progressBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const match = line.match(/^out_time_ms=(\d+)$/);

      if (match) {
        const outputMs = Number(match[1]) / 1000;

        if (outputMs > this.progressMs) {
          const wallElapsedMs = performance.now() - this.startedAt;
          this.progressMs = outputMs;
          this.progressSamples.push({
            wallElapsedMs: Number(wallElapsedMs.toFixed(3)),
            outputMs: Number(outputMs.toFixed(3)),
            delayMs: Number((wallElapsedMs - outputMs).toFixed(3)),
          });
        }
      }
    }
  }

  getProgressMs() {
    return this.progressMs;
  }

  wait() {
    return new Promise((resolvePromise, reject) => {
      this.child.on("error", reject);
      this.child.on("close", (code) => {
        if (code === 0) {
          resolvePromise();
          return;
        }

        reject(new Error(`ffmpeg exited with ${code}${this.stderr ? `\n${this.stderr}` : ""}`));
      });
    });
  }

  stop(signal = "SIGTERM") {
    this.child.kill(signal);
  }
}

async function uploadArtifactDirectory(outputDir, s3Uri) {
  if (s3Uri === undefined) {
    return undefined;
  }

  if (!s3Uri.startsWith("s3://")) {
    throw new Error("VRDEX_RESTREAM_ARTIFACT_S3_URI must start with s3://.");
  }

  const destination = `${s3Uri.replace(/\/+$/, "")}/${basename(outputDir)}/`;
  await run("aws", ["s3", "sync", outputDir, destination, "--no-progress"]);

  return destination;
}

function loadConfig() {
  const mode = assertAllowed(
    requiredEnv("VRDEX_VRCDN_POC_MODE"),
    POC_MODES,
      "VRDEX_VRCDN_POC_MODE must be source-pusher, output-restream, or single-output-smoke.",
  );
  const qualityGate = requiredEnv("VRDEX_RESTREAM_QUALITY_GATE");
  const qualityProfile = QUALITY_PROFILES[qualityGate];

  if (qualityProfile === undefined) {
    throw new Error("VRDEX_RESTREAM_QUALITY_GATE must be 1080p60, 1080p30, 720p60, or 720p30.");
  }

  const x264Preset = assertAllowed(
    optionalEnv("VRDEX_RESTREAM_X264_PRESET") ?? "ultrafast",
    X264_PRESETS,
    "VRDEX_RESTREAM_X264_PRESET must be ultrafast, superfast, veryfast, faster, or fast.",
  );
  const durationSeconds = requiredIntegerEnv("VRDEX_VRCDN_POC_DURATION_SECONDS", DEFAULT_DURATION_SECONDS, 60, 43200);
  const baseConfig = {
    mode,
    qualityGate,
    qualityProfile,
    x264Preset,
    durationSeconds,
    startupTimeoutSeconds: requiredIntegerEnv(
      "VRDEX_VRCDN_POC_STARTUP_TIMEOUT_SECONDS",
      DEFAULT_STARTUP_TIMEOUT_SECONDS,
      10,
      300,
    ),
    artifactRoot: optionalEnv("VRDEX_RESTREAM_ARTIFACT_ROOT") ?? DEFAULT_ARTIFACT_ROOT,
    artifactS3Uri: optionalEnv("VRDEX_RESTREAM_ARTIFACT_S3_URI"),
  };

  if (mode === "source-pusher") {
    return {
      ...baseConfig,
      sourceKey: assertAllowed(
        requiredEnv("VRDEX_VRCDN_POC_SOURCE_KEY"),
        SOURCE_KEYS,
        "VRDEX_VRCDN_POC_SOURCE_KEY must be source-a or source-b.",
      ),
      ingestTarget: ingestTargetEnv("VRDEX_VRCDN_POC_INGEST_URL", "VRDEX_VRCDN_POC_INGEST_SECRET_JSON"),
    };
  }

  if (mode === "single-output-smoke") {
    return {
      ...baseConfig,
      outputWatchUrl: publicPlaybackUrlEnv("VRDEX_VRCDN_POC_OUTPUT_WATCH_URL"),
      outputIngestTarget: ingestTargetEnv("VRDEX_VRCDN_POC_OUTPUT_INGEST_URL", "VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON"),
    };
  }

  return {
    ...baseConfig,
    sourceAPlaybackUrl: publicPlaybackUrlEnv("VRDEX_VRCDN_POC_SOURCE_A_PLAYBACK_URL"),
    sourceBPlaybackUrl: publicPlaybackUrlEnv("VRDEX_VRCDN_POC_SOURCE_B_PLAYBACK_URL"),
    outputWatchUrl: publicPlaybackUrlEnv("VRDEX_VRCDN_POC_OUTPUT_WATCH_URL"),
    outputIngestTarget: ingestTargetEnv("VRDEX_VRCDN_POC_OUTPUT_INGEST_URL", "VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON"),
  };
}

async function runSourcePusher(config) {
  console.log(
    JSON.stringify({
      event: "vrcdn_poc_source_pusher_started",
      sourceKey: config.sourceKey,
      qualityGate: config.qualityGate,
      durationSeconds: config.durationSeconds,
      x264Preset: config.x264Preset,
    }),
  );
  const started = performance.now();
  await run("ffmpeg", sourcePusherArgs(config), { redactValues: config.ingestTarget.redactValues });

  console.log(
    JSON.stringify({
      event: "vrcdn_poc_source_pusher_completed",
      sourceKey: config.sourceKey,
      elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    }),
  );
}

async function runOutputRestream(config) {
  const outputDir = resolve(config.artifactRoot, timestamp());
  const framesDir = join(outputDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  const holdSlateImage = join(framesDir, "hold-slate-input.png");
  await writePocSlate(holdSlateImage, config.qualityProfile);

  if (!existsSync(holdSlateImage)) {
    throw new Error("Failed to create POC hold slate image.");
  }

  const args = config.mode === "single-output-smoke" ? singleOutputSmokeArgs(config, holdSlateImage) : outputRestreamArgs(config, holdSlateImage);
  const ffmpeg = new SafeFfmpegProcess(args, { redactValues: config.outputIngestTarget.redactValues });
  const startupDeadline = performance.now() + config.startupTimeoutSeconds * 1000;

  while (ffmpeg.getProgressMs() === 0 && performance.now() < startupDeadline) {
    await sleep(500);
  }

  if (ffmpeg.getProgressMs() === 0) {
    ffmpeg.stop();
    throw new Error(
      "VRCDN POC output did not produce FFmpeg progress before the startup timeout. Check provider ingest readiness and RTMP URL/key formatting.",
    );
  }

  const commandClient = new ZmqCommandClient(DEFAULT_ZMQ_PORT);
  const commandLog = [];
  const controller = new ProgramController(commandClient, {
    commandLog,
    preset: { controlMode: "hard-switch", controlPort: DEFAULT_ZMQ_PORT },
    startedAt: ffmpeg.startedAt,
    waitUntil: async (elapsedMs) => {
      while (ffmpeg.getProgressMs() < elapsedMs) {
        await sleep(100);
      }
    },
  });
  const started = performance.now();

  console.log(
    JSON.stringify({
      event: "vrcdn_poc_output_restream_started",
      mode: config.mode,
      qualityGate: config.qualityGate,
      durationSeconds: config.durationSeconds,
      x264Preset: config.x264Preset,
      controlMode: "hard-switch",
    }),
  );

  try {
    await Promise.all([
      controller.runProofTimeline({
        holdAtMs: (config.durationSeconds * 1000) / 3,
        sourceAtMs: (config.durationSeconds * 2000) / 3,
      }),
      ffmpeg.wait(),
    ]);
  } catch (error) {
    ffmpeg.stop();
    throw error;
  } finally {
    commandClient.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: config.mode,
    qualityGate: config.qualityGate,
    durationSeconds: config.durationSeconds,
    x264Preset: config.x264Preset,
    controlMode: "hard-switch",
    elapsedSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    commandCount: commandLog.length,
    commandLog,
    progressSampleCount: ffmpeg.progressSamples.length,
    finalOutputProgressMs: ffmpeg.getProgressMs(),
  };
  writeFileSync(join(outputDir, "vrcdn-poc-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const uploadedTo = await uploadArtifactDirectory(outputDir, config.artifactS3Uri);

  console.log(
    JSON.stringify({
      event: "vrcdn_poc_output_restream_completed",
      mode: config.mode,
      artifact: outputDir,
      ...(uploadedTo === undefined ? {} : { uploadedTo }),
      qualityGate: config.qualityGate,
      durationSeconds: config.durationSeconds,
      commandCount: commandLog.length,
      finalOutputProgressMs: ffmpeg.getProgressMs(),
    }),
  );
}

async function main() {
  const config = loadConfig();

  if (optionalEnv("VRDEX_VRCDN_POC_CONFIG_CHECK_ONLY") === "true") {
    console.log(
      JSON.stringify({
        event: "vrcdn_poc_configuration_validated",
        mode: config.mode,
        qualityGate: config.qualityGate,
        durationSeconds: config.durationSeconds,
        x264Preset: config.x264Preset,
        ...(config.mode === "source-pusher" ? { sourceKey: config.sourceKey, ingestSecretConfigured: true } : {}),
        ...(config.mode === "output-restream"
          ? {
              sourceAPlaybackConfigured: true,
              sourceBPlaybackConfigured: true,
              outputWatchConfigured: true,
              outputIngestSecretConfigured: true,
            }
          : {}),
        ...(config.mode === "single-output-smoke"
          ? {
              outputWatchConfigured: true,
              outputIngestSecretConfigured: true,
            }
          : {}),
      }),
    );
    return;
  }

  if (config.mode === "source-pusher") {
    await runSourcePusher(config);
    return;
  }

  await runOutputRestream(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? sanitizeLog(error.message) : String(error));
  process.exitCode = 1;
});
