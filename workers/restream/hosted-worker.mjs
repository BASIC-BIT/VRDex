import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const REQUIRED_GATE = "1080p60";
const ALLOWED_BENCHMARK_MODES = new Set(["dry-run", "ecs-fargate"]);
const DEFAULT_ARTIFACT_ROOT = process.env.AWS_EXECUTION_ENV
  ? "/tmp/vrdex-restream-worker-benchmark"
  : "artifacts/restream-worker-benchmark";
const timeline = [
  { atSeconds: 0, command: "start_program", scene: "source-a", audio: "source-a-tone-440hz" },
  { atSeconds: 4, command: "switch_hold", scene: "hold-slate", audio: "hold-tone-220hz" },
  { atSeconds: 8, command: "switch_source", targetSourceKey: "source-b", scene: "source-b", audio: "source-b-tone-880hz" },
  { atSeconds: 12, command: "stop_program" },
];

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

function requiredIntegerEnv(name) {
  const value = requiredEnv(name);

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function requiredUrlEnv(name) {
  const value = requiredEnv(name);

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`${name} must use http or https.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${name} must`)) {
      throw error;
    }

    throw new Error(`${name} must be a valid URL.`);
  }

  return value;
}

function listEnv(name, required) {
  const value = required ? requiredEnv(name) : optionalEnv(name);

  if (value === undefined) {
    return [];
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (required && entries.length === 0) {
    throw new Error(`${name} must include at least one reference name.`);
  }

  return entries;
}

function booleanEnv(name, defaultValue) {
  const value = optionalEnv(name);

  if (value === undefined) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    if (!options.inherit) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

function parseFrameRate(value) {
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
}

function checkPlaylist(outputDir) {
  const playlistPath = join(outputDir, "hls", "program.m3u8");
  assert(existsSync(playlistPath), `Missing HLS playlist: ${playlistPath}`);
  const playlist = readFileSync(playlistPath, "utf8");
  const durations = [...playlist.matchAll(/^#EXTINF:([0-9.]+),/gm)].map((match) => Number(match[1]));
  const segmentNames = playlist.split(/\r?\n/).filter((line) => line.endsWith(".ts"));
  const totalDuration = durations.reduce((sum, value) => sum + value, 0);

  assert(playlist.includes("#EXT-X-INDEPENDENT-SEGMENTS"), "HLS playlist should mark independent segments.");
  assert(segmentNames.length >= 3, `Expected at least 3 HLS segments, found ${segmentNames.length}.`);
  assert(Math.abs(totalDuration - 12) <= 0.75, `Expected HLS duration near 12s, found ${totalDuration}s.`);

  for (const segmentName of segmentNames) {
    const segmentPath = join(outputDir, "hls", segmentName);
    assert(existsSync(segmentPath), `Playlist references missing segment ${segmentName}.`);
    assert(statSync(segmentPath).size > 0, `Segment ${segmentName} is empty.`);
  }

  return { playlistPath, segmentCount: segmentNames.length, totalDuration };
}

async function probePlaylist(playlistPath) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", playlistPath]);

  return JSON.parse(stdout);
}

async function writeSyntheticProgram(outputDir) {
  const hlsDir = join(outputDir, "hls");
  const framesDir = join(outputDir, "frames");
  mkdirSync(hlsDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });
  writeFileSync(join(outputDir, "command-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);

  const playlistPath = join(hlsDir, "program.m3u8");
  const segmentPattern = join(hlsDir, "program-%03d.ts");
  const started = performance.now();

  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x1080:rate=60:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=4",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x111827:size=1920x1080:rate=60:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=48000:duration=4",
    "-f",
    "lavfi",
    "-i",
    "smptebars=size=1920x1080:rate=60:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=48000:duration=4",
    "-filter_complex",
    [
      "[0:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v0]",
      "[1:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a0]",
      "[2:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v1]",
      "[3:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a1]",
      "[4:v]format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v2]",
      "[5:a]pan=stereo|c0=c0|c1=c0,asetpts=PTS-STARTPTS[a2]",
      "[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]",
    ].join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-tune",
    "zerolatency",
    "-profile:v",
    "high",
    "-level:v",
    "4.2",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "60",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-b:v",
    "3500k",
    "-maxrate",
    "3500k",
    "-bufsize",
    "7000k",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    segmentPattern,
    playlistPath,
  ]);

  const encodeElapsedSeconds = (performance.now() - started) / 1000;

  for (const [label, seconds] of [
    ["source-a", 2],
    ["hold-slate", 6],
    ["source-b", 10],
  ]) {
    await run("ffmpeg", [
      "-hide_banner",
      "-y",
      "-ss",
      String(seconds),
      "-i",
      playlistPath,
      "-frames:v",
      "1",
      "-update",
      "1",
      join(framesDir, `${label}.jpg`),
    ]);
  }

  return { encodeElapsedSeconds };
}

async function uploadArtifacts(outputDir, s3Uri) {
  if (!s3Uri.startsWith("s3://")) {
    throw new Error("VRDEX_RESTREAM_ARTIFACT_S3_URI must start with s3://.");
  }

  const destination = `${s3Uri.replace(/\/+$/, "")}/${basename(outputDir)}/`;
  await run("aws", ["s3", "sync", outputDir, destination, "--no-progress"]);

  return destination;
}

function writeHtmlReport(outputDir, report) {
  const frameList = report.frames
    .map(
      (frame) => `
        <figure>
          <img src="frames/${frame}" alt="${frame.replace(/\.jpg$/, "")}" />
          <figcaption>${frame.replace(/\.jpg$/, "")}</figcaption>
        </figure>`,
    )
    .join("\n");
  const checks = Object.entries(report.acceptance)
    .map(([name, passed]) => `<li><strong>${name}</strong>: ${passed ? "pass" : "fail"}</li>`)
    .join("\n");

  writeFileSync(
    join(outputDir, "report.html"),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VRDex Restream Worker Benchmark</title>
  <style>
    body { margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, Segoe UI, Arial, sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    a { color: #93c5fd; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 24px 0; }
    .card, figure { background: #111827; border: 1px solid #263244; border-radius: 10px; padding: 16px; }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .value { margin-top: 6px; font-size: 18px; font-weight: 650; }
    figure { margin: 0; }
    img { display: block; width: 100%; border-radius: 8px; background: #020617; }
    figcaption { margin-top: 10px; color: #cbd5e1; }
    li { margin: 8px 0; }
    code { color: #bfdbfe; }
  </style>
</head>
<body>
  <main>
    <h1>VRDex Restream Worker Benchmark</h1>
    <p>Generated ${report.generatedAt}. Synthetic source, hold slate, and source switch output for the ${report.qualityGate} gate.</p>
    <div class="grid">
      <div class="card"><div class="label">Mode</div><div class="value">${report.benchmarkMode}</div></div>
      <div class="card"><div class="label">Output</div><div class="value">${report.video.codec} ${report.video.width}x${report.video.height} @ ${report.video.frameRate}</div></div>
      <div class="card"><div class="label">Audio</div><div class="value">${report.audio.codec} ${report.audio.sampleRateHz}Hz ${report.audio.channels}ch</div></div>
      <div class="card"><div class="label">Realtime Factor</div><div class="value">${report.realtimeFactor.toFixed(2)}x</div></div>
    </div>
    <p>Playlist: <a href="hls/program.m3u8"><code>hls/program.m3u8</code></a></p>
    <h2>Acceptance</h2>
    <ul>${checks}</ul>
    <h2>Transition Evidence</h2>
    <div class="grid">${frameList}</div>
  </main>
</body>
</html>
`,
  );
}

async function runBenchmark(config) {
  await run("ffmpeg", ["-version"]);
  await run("ffprobe", ["-version"]);

  const outputDir = resolve(config.artifactRoot, timestamp());
  mkdirSync(outputDir, { recursive: true });
  const { encodeElapsedSeconds } = await writeSyntheticProgram(outputDir);
  const playlistSummary = checkPlaylist(outputDir);
  const metadata = await probePlaylist(playlistSummary.playlistPath);
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams.find((stream) => stream.codec_type === "audio");
  const frames = readdirSync(join(outputDir, "frames")).filter((entry) => entry.endsWith(".jpg")).sort();

  assert(video, "Output has no video stream.");
  assert(audio, "Output has no audio stream.");
  assert(video.codec_name === "h264", `Expected H.264 video, found ${video.codec_name}.`);
  assert(video.width === 1920 && video.height === 1080, `Expected 1920x1080 video, found ${video.width}x${video.height}.`);
  assert(Math.abs(parseFrameRate(video.avg_frame_rate) - 60) < 0.1, `Expected 60 fps, found ${video.avg_frame_rate}.`);
  assert(audio.codec_name === "aac", `Expected AAC audio, found ${audio.codec_name}.`);
  assert(Number(audio.sample_rate) === 48000, `Expected 48kHz audio, found ${audio.sample_rate}.`);
  assert(Number(audio.channels) === 2, `Expected stereo audio, found ${audio.channels} channels.`);
  assert(frames.includes("source-a.jpg"), "Missing source-a transition frame.");
  assert(frames.includes("hold-slate.jpg"), "Missing hold-slate transition frame.");
  assert(frames.includes("source-b.jpg"), "Missing source-b transition frame.");

  const realtimeFactor = playlistSummary.totalDuration / encodeElapsedSeconds;
  const report = {
    generatedAt: new Date().toISOString(),
    artifact: outputDir,
    benchmarkMode: config.benchmarkMode,
    qualityGate: REQUIRED_GATE,
    syntheticOnly: config.syntheticOnly,
    secretReferenceCount: config.secretRefNames.length,
    maxConcurrentWorkers: config.maxConcurrentWorkers,
    maxSessionSeconds: config.maxSessionSeconds,
    killSwitchParameter: config.killSwitchParameter,
    commandTimeline: timeline,
    playlist: playlistSummary.playlistPath,
    segmentCount: playlistSummary.segmentCount,
    durationSeconds: playlistSummary.totalDuration,
    encodeElapsedSeconds,
    realtimeFactor,
    video: {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      frameRate: video.avg_frame_rate,
    },
    audio: {
      codec: audio.codec_name,
      sampleRateHz: Number(audio.sample_rate),
      channels: Number(audio.channels),
    },
    frames,
    acceptance: {
      realtimeEncode: realtimeFactor >= 1,
      expectedVideoShape: video.codec_name === "h264" && video.width === 1920 && video.height === 1080,
      expectedAudioShape: audio.codec_name === "aac" && Number(audio.sample_rate) === 48000 && Number(audio.channels) === 2,
      transitionFramesPresent: frames.length >= 3,
      independentSegments: true,
    },
  };

  assert(report.acceptance.realtimeEncode, `Expected realtime encode factor >= 1, found ${realtimeFactor.toFixed(2)}.`);
  writeFileSync(join(outputDir, "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeHtmlReport(outputDir, report);

  const artifactS3Uri = optionalEnv("VRDEX_RESTREAM_ARTIFACT_S3_URI");
  const uploadedTo = artifactS3Uri === undefined ? undefined : await uploadArtifacts(outputDir, artifactS3Uri);

  console.log(
    JSON.stringify({
      event: "restream_worker_benchmark_completed",
      artifact: outputDir,
      ...(uploadedTo === undefined ? {} : { uploadedTo }),
      benchmarkMode: config.benchmarkMode,
      qualityGate: REQUIRED_GATE,
      durationSeconds: report.durationSeconds,
      realtimeFactor: Number(report.realtimeFactor.toFixed(3)),
      frames: report.frames,
    }),
  );
}

function loadConfig() {
  const qualityGate = requiredEnv("VRDEX_RESTREAM_QUALITY_GATE");

  if (qualityGate !== REQUIRED_GATE) {
    throw new Error(`Hosted restream workers must run behind the ${REQUIRED_GATE} gate.`);
  }

  const benchmarkMode = requiredEnv("VRDEX_RESTREAM_BENCHMARK_MODE");

  if (!ALLOWED_BENCHMARK_MODES.has(benchmarkMode)) {
    throw new Error("VRDEX_RESTREAM_BENCHMARK_MODE must be dry-run or ecs-fargate.");
  }

  requiredUrlEnv("CONVEX_URL");
  const syntheticOnly = booleanEnv("VRDEX_RESTREAM_SYNTHETIC_ONLY", true);
  const config = {
    benchmarkMode,
    syntheticOnly,
    killSwitchParameter: requiredEnv("VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER"),
    secretRefNames: listEnv("VRDEX_RESTREAM_SECRET_REF_NAMES", !syntheticOnly),
    maxSessionSeconds: requiredIntegerEnv("VRDEX_RESTREAM_MAX_SESSION_SECONDS"),
    maxConcurrentWorkers: requiredIntegerEnv("VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS"),
    artifactRoot: optionalEnv("VRDEX_RESTREAM_ARTIFACT_ROOT") ?? DEFAULT_ARTIFACT_ROOT,
  };

  if (!syntheticOnly && config.secretRefNames.length === 0) {
    throw new Error("VRDEX_RESTREAM_SECRET_REF_NAMES must include at least one reference name for non-synthetic workers.");
  }

  return config;
}

async function main() {
  const config = loadConfig();

  if (booleanEnv("VRDEX_RESTREAM_CONFIG_CHECK_ONLY", false)) {
    if (config.benchmarkMode !== "dry-run") {
      throw new Error("VRDEX_RESTREAM_CONFIG_CHECK_ONLY is allowed only in dry-run mode.");
    }

    console.log(
      JSON.stringify({ event: "restream_worker_configuration_validated", benchmarkMode: config.benchmarkMode, qualityGate: REQUIRED_GATE }),
    );
    return;
  }

  await runBenchmark(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
