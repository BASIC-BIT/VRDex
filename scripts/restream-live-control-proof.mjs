import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_LIVE_CONTROL_PRESET,
  FFmpegProcess,
  ProgramController,
  ZmqCommandClient,
  buildSyntheticLiveControlFfmpegArgs,
} from "../workers/restream/live-control.mjs";

const ARTIFACT_ROOT = "artifacts/restream-live-control-proof";
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME_RATE = 60;
const DURATION_SECONDS = 12;
const FADE_MS = DEFAULT_LIVE_CONTROL_PRESET.fadeMs;
const HOLD_AUDIO_DELAY_MS = DEFAULT_LIVE_CONTROL_PRESET.holdAudioDelayMs;
const CONTROL_ZMQ_PORT = DEFAULT_LIVE_CONTROL_PRESET.controlPort;

const timeline = [
  { atSeconds: 0, command: "start_program", scene: "source-a" },
  { atSeconds: 4, command: "switch_hold", scene: "hold-slate", fadeMs: FADE_MS, audioDelayMs: HOLD_AUDIO_DELAY_MS },
  { atSeconds: 8, command: "switch_source", scene: "source-b", fadeMs: FADE_MS },
  { atSeconds: DURATION_SECONDS, command: "stop_program" },
];

const scenes = {
  "source-a": {
    color: "0x2563eb",
    title: "Source A",
    subtitle: "Runtime controlled input",
  },
  "hold-slate": {
    color: "0x020617",
    title: "VRDex Hold Slate",
    subtitle: "Slate audio starts after the live delay",
  },
  "source-b": {
    color: "0xf97316",
    title: "Source B",
    subtitle: "Runtime controlled input",
  },
};

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

function runBuffer(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout: Buffer.concat(stdout), stderr });
        return;
      }

      reject(new Error(`${command} exited with ${code}${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

async function writeSceneImage(outputPath, scene) {
  await run("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${scene.color}:size=${WIDTH}x${HEIGHT}:rate=1`,
    "-vf",
    [
      "format=rgba",
      "drawbox=x=170:y=140:w=1580:h=800:color=0x0f172a@0.38:t=fill",
      "drawbox=x=250:y=230:w=1420:h=620:color=0xffffff@0.14:t=6",
      "drawbox=x=450:y=350:w=820:h=260:color=0x020617@0.30:t=fill",
      `drawtext=text='${scene.title}':fontcolor=white:fontsize=104:x=(w-text_w)/2:y=700`,
      `drawtext=text='${scene.subtitle}':fontcolor=0xe5e7eb:fontsize=42:x=(w-text_w)/2:y=820`,
      "format=rgb24",
    ].join(","),
    "-frames:v",
    "1",
    "-update",
    "1",
    outputPath,
  ]);
}

async function writeSceneImages(framesDir) {
  const paths = {};

  for (const [key, scene] of Object.entries(scenes)) {
    const outputPath = join(framesDir, `${key}-input.png`);
    await writeSceneImage(outputPath, scene);
    paths[key] = outputPath;
  }

  return paths;
}

async function remuxPreview(playlistPath, watchPreviewPath) {
  await run("ffmpeg", ["-hide_banner", "-y", "-i", playlistPath, "-c", "copy", "-movflags", "+faststart", watchPreviewPath]);
}

async function extractFrame(inputPath, seconds, outputPath) {
  await run("ffmpeg", ["-hide_banner", "-y", "-ss", String(seconds), "-i", inputPath, "-frames:v", "1", "-update", "1", outputPath]);
}

async function sampleFrameColor(inputPath, seconds) {
  const { stdout } = await runBuffer("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-ss",
    String(seconds),
    "-i",
    inputPath,
    "-vf",
    "scale=1:1,format=rgb24",
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-",
  ]);

  assert(stdout.length >= 3, `Could not sample frame color at ${seconds}s.`);

  return { r: stdout[0], g: stdout[1], b: stdout[2] };
}

function classifyColor({ r, g, b }) {
  if (b > r + 45 && b > g + 25) {
    return "source-a";
  }

  if (r > 120 && g > 55 && b < 90) {
    return "source-b";
  }

  if (r < 95 && g < 105 && b < 130) {
    return "hold-slate";
  }

  return "unknown";
}

function colorDistance(first, second) {
  return Math.sqrt((first.r - second.r) ** 2 + (first.g - second.g) ** 2 + (first.b - second.b) ** 2);
}

async function meanVolumeDb(inputPath, seconds, durationSeconds) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner",
    "-v",
    "info",
    "-ss",
    String(seconds),
    "-t",
    String(durationSeconds),
    "-i",
    inputPath,
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);
  const match = stderr.match(/mean_volume:\s*(-?[0-9.]+) dB/);

  assert(match, `Could not read mean volume at ${seconds}s.`);

  return Number(match[1]);
}

async function findQuietestVolume(inputPath, startSeconds, endSeconds) {
  const samples = [];

  for (let seconds = startSeconds; seconds <= endSeconds; seconds += 0.1) {
    const sampleAt = Number(seconds.toFixed(3));
    samples.push({ sampleAt, volumeDb: await meanVolumeDb(inputPath, sampleAt, 0.08) });
  }

  return samples.reduce((quietest, sample) => (sample.volumeDb < quietest.volumeDb ? sample : quietest));
}

function findLatestElapsed(commandLog, kind, predicate) {
  const matches = commandLog.filter((event) => event.kind === kind && predicate(event));
  const latest = matches.at(-1);

  assert(latest, `Missing command event ${kind}.`);

  return latest.elapsedSeconds;
}

function findFirstElapsed(commandLog, kind, predicate) {
  const match = commandLog.find((event) => event.kind === kind && predicate(event));

  assert(match, `Missing command event ${kind}.`);

  return match.elapsedSeconds;
}

async function verifyTransitionBlend(inputPath, { label, fromSeconds, toSeconds, scanStart, scanEnd }) {
  const fromColor = await sampleFrameColor(inputPath, fromSeconds);
  const toColor = await sampleFrameColor(inputPath, toSeconds);
  const samples = [];

  for (let seconds = scanStart; seconds <= scanEnd; seconds += 0.1) {
    const sampleAt = Number(seconds.toFixed(3));
    const color = await sampleFrameColor(inputPath, sampleAt);
    samples.push({
      sampleAt,
      color,
      distanceFromSource: Number(colorDistance(color, fromColor).toFixed(2)),
      distanceFromTarget: Number(colorDistance(color, toColor).toFixed(2)),
    });
  }

  const bestBlend = samples.reduce((best, sample) => {
    const score = Math.min(sample.distanceFromSource, sample.distanceFromTarget);
    const bestScore = Math.min(best.distanceFromSource, best.distanceFromTarget);

    return score > bestScore ? sample : best;
  });

  return {
    label,
    fromColor,
    toColor,
    samples,
    bestBlend,
    passed: bestBlend.distanceFromSource > 20 && bestBlend.distanceFromTarget > 20,
  };
}

async function verifyOutput({ outputDir, framesDir, watchPreviewPath, commandLog }) {
  assert(existsSync(watchPreviewPath), `Missing watch preview: ${watchPreviewPath}`);
  assert(statSync(watchPreviewPath).size > 0, "Watch preview is empty.");

  const videoSamples = [
    { label: "source-a", seconds: 2 },
    { label: "hold-slate", seconds: 6 },
    { label: "source-b", seconds: 10 },
  ];

  const frameChecks = [];

  for (const sample of videoSamples) {
    const framePath = join(framesDir, `${sample.label}.jpg`);
    await extractFrame(watchPreviewPath, sample.seconds, framePath);
    const color = await sampleFrameColor(watchPreviewPath, sample.seconds);
    const classifiedAs = classifyColor(color);
    frameChecks.push({ ...sample, frame: `frames/${sample.label}.jpg`, color, classifiedAs, passed: classifiedAs === sample.label });
  }

  const transitionChecks = [
    await verifyTransitionBlend(watchPreviewPath, {
      label: "source-a-to-hold",
      fromSeconds: 3.6,
      toSeconds: 5.2,
      scanStart: 4.05,
      scanEnd: 4.7,
    }),
    await verifyTransitionBlend(watchPreviewPath, {
      label: "hold-to-source-b",
      fromSeconds: 7.6,
      toSeconds: 9.2,
      scanStart: 8.05,
      scanEnd: 8.7,
    }),
  ];

  const audioSilenceAt = findLatestElapsed(commandLog, "audio-fade-out-source-a", (event) => Number(event.value) === 0);
  const holdAudioStartsAt = findFirstElapsed(commandLog, "audio-fade-in-hold", (event) => Number(event.value) > 0);
  const silenceScanStart = Number(Math.max(4.1, audioSilenceAt - 0.75).toFixed(3));
  const silenceScanEnd = Number(Math.min(5.8, holdAudioStartsAt + 0.35).toFixed(3));
  const quietestSilence = await findQuietestVolume(watchPreviewPath, silenceScanStart, silenceScanEnd);
  const sourceVolumeDb = await meanVolumeDb(watchPreviewPath, 2, 0.25);
  const holdVolumeDb = await meanVolumeDb(watchPreviewPath, 6, 0.25);
  const sourceBVolumeDb = await meanVolumeDb(watchPreviewPath, 10, 0.25);
  const audioChecks = {
    sourceVolumeDb,
    silenceScanStart,
    silenceScanEnd,
    silenceSampleAt: quietestSilence.sampleAt,
    silenceVolumeDb: quietestSilence.volumeDb,
    holdVolumeDb,
    sourceBVolumeDb,
    slateDelayHasSilence: quietestSilence.volumeDb < -45,
    sourceAudioPresent: sourceVolumeDb > -40,
    holdAudioPresent: holdVolumeDb > -40,
    sourceBAudioPresent: sourceBVolumeDb > -40,
  };

  writeFileSync(join(outputDir, "frame-checks.json"), `${JSON.stringify(frameChecks, null, 2)}\n`);
  writeFileSync(join(outputDir, "transition-checks.json"), `${JSON.stringify(transitionChecks, null, 2)}\n`);
  writeFileSync(join(outputDir, "audio-checks.json"), `${JSON.stringify(audioChecks, null, 2)}\n`);

  return { frameChecks, transitionChecks, audioChecks };
}

function writeHtmlReport(outputDir, report) {
  const frameCards = report.frameChecks
    .map(
      (check) => `
        <figure>
          <img src="${check.frame}" alt="${check.label}" />
          <figcaption>${check.label}: ${check.classifiedAs} (${check.passed ? "pass" : "fail"})</figcaption>
        </figure>`,
    )
    .join("\n");
  const transitionCards = report.transitionChecks
    .map(
      (check) => `
        <div class="card">
          <div class="label">${check.label}</div>
          <div class="value">${check.passed ? "blend detected" : "blend missing"}</div>
          <p>Best blend at ${check.bestBlend.sampleAt}s, distances ${check.bestBlend.distanceFromSource} / ${check.bestBlend.distanceFromTarget}</p>
        </div>`,
    )
    .join("\n");
  const checks = Object.entries(report.acceptance)
    .map(([name, passed]) => `<li><strong>${name}</strong>: ${passed ? "pass" : "fail"}</li>`)
    .join("\n");
  const commands = report.commandLog
    .map((event) => `<div><strong>${event.elapsedSeconds}s</strong> ${event.kind}${event.command ? ` ${event.command}` : ""}${event.value === undefined ? "" : ` ${event.value}`}</div>`)
    .join("\n");

  writeFileSync(
    join(outputDir, "report.html"),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VRDex Restream Live Control Proof</title>
  <style>
    body { margin: 0; background: #0f172a; color: #e5e7eb; font-family: Inter, Segoe UI, Arial, sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    a { color: #93c5fd; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); margin: 24px 0; }
    .card, figure, .commands div { background: #111827; border: 1px solid #263244; border-radius: 10px; padding: 16px; }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .value { margin-top: 6px; font-size: 18px; font-weight: 650; }
    figure { margin: 0; }
    img { display: block; width: 100%; border-radius: 8px; background: #020617; }
    figcaption { margin-top: 10px; color: #cbd5e1; }
    video { display: block; width: 100%; max-height: 70vh; margin: 24px 0; background: #020617; border-radius: 12px; }
    li { margin: 8px 0; }
    code { color: #bfdbfe; }
    .commands { display: grid; gap: 10px; margin: 16px 0 24px; }
  </style>
</head>
<body>
  <main>
    <h1>VRDex Restream Live Control Proof</h1>
    <p>Generated ${report.generatedAt}. FFmpeg started once and was controlled at runtime through ZeroMQ commands.</p>
    <video controls preload="metadata" poster="frames/source-a.jpg" src="program.mp4"></video>
    <div class="grid">
      <div class="card"><div class="label">Output</div><div class="value">${report.width}x${report.height} @ ${report.frameRate}fps</div></div>
      <div class="card"><div class="label">Runtime Commands</div><div class="value">${report.commandLog.length}</div></div>
      <div class="card"><div class="label">Control Mode</div><div class="value">${report.controlMode}</div></div>
      <div class="card"><div class="label">Fade</div><div class="value">${report.fadeMs}ms</div></div>
      <div class="card"><div class="label">Slate Audio Delay</div><div class="value">${report.holdAudioDelayMs}ms</div></div>
    </div>
    <h2>Acceptance</h2>
    <ul>${checks}</ul>
    <h2>Command Log</h2>
    <div class="commands">${commands}</div>
    <h2>Frame Evidence</h2>
    <div class="grid">${frameCards}</div>
    <h2>Transition Evidence</h2>
    <div class="grid">${transitionCards}</div>
    <p>Playlist: <a href="hls/program.m3u8"><code>hls/program.m3u8</code></a></p>
    <p>Watch preview: <a href="program.mp4"><code>program.mp4</code></a></p>
  </main>
</body>
</html>
`,
  );
}

async function main() {
  await run("ffmpeg", ["-version"]);
  await run("python", ["-c", "import zmq; print(zmq.__version__)"]);

  const outputDir = resolve(ARTIFACT_ROOT, timestamp());
  const framesDir = join(outputDir, "frames");
  const hlsDir = join(outputDir, "hls");
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(hlsDir, { recursive: true });

  const scenePaths = await writeSceneImages(framesDir);
  const playlistPath = join(hlsDir, "program.m3u8");
  const watchPreviewPath = join(outputDir, "program.mp4");
  const commandLog = [];
  const ffmpegArgs = buildSyntheticLiveControlFfmpegArgs({
    scenePaths,
    hlsDir,
    playlistPath,
    width: WIDTH,
    height: HEIGHT,
    frameRate: FRAME_RATE,
    durationSeconds: DURATION_SECONDS,
  });
  const ffmpeg = new FFmpegProcess(ffmpegArgs);
  const client = new ZmqCommandClient(CONTROL_ZMQ_PORT);
  const controller = new ProgramController(client, { commandLog });

  try {
    await Promise.all([controller.runProofTimeline(), ffmpeg.wait()]);
  } catch (error) {
    ffmpeg.stop();
    throw error;
  } finally {
    client.close();
  }

  writeFileSync(join(outputDir, "controller-events.json"), `${JSON.stringify(commandLog, null, 2)}\n`);
  await remuxPreview(playlistPath, watchPreviewPath);
  const { frameChecks, transitionChecks, audioChecks } = await verifyOutput({ outputDir, framesDir, watchPreviewPath, commandLog });
  const acceptance = {
    ffmpegStartedOnce: true,
    runtimeVideoFadeCommandsSent: commandLog.some((event) => event.kind.startsWith("video-alpha-fade")),
    runtimeAudioFadeCommandsSent: commandLog.some((event) => event.kind.startsWith("audio-fade")),
    sourceAFrameDetected: frameChecks.some((check) => check.label === "source-a" && check.passed),
    holdSlateFrameDetected: frameChecks.some((check) => check.label === "hold-slate" && check.passed),
    sourceBFrameDetected: frameChecks.some((check) => check.label === "source-b" && check.passed),
    sourceAToHoldBlendDetected: transitionChecks.some((check) => check.label === "source-a-to-hold" && check.passed),
    holdToSourceBBlendDetected: transitionChecks.some((check) => check.label === "hold-to-source-b" && check.passed),
    sourceAudioPresent: audioChecks.sourceAudioPresent,
    slateDelayHasSilence: audioChecks.slateDelayHasSilence,
    holdAudioPresent: audioChecks.holdAudioPresent,
    sourceBAudioPresent: audioChecks.sourceBAudioPresent,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    artifact: outputDir,
    width: WIDTH,
    height: HEIGHT,
    frameRate: FRAME_RATE,
    durationSeconds: DURATION_SECONDS,
    controlMode: DEFAULT_LIVE_CONTROL_PRESET.controlMode,
    fadeMs: FADE_MS,
    holdAudioDelayMs: HOLD_AUDIO_DELAY_MS,
    timeline,
    commandLog,
    playlist: playlistPath,
    watchPreview: watchPreviewPath,
    frameChecks,
    transitionChecks,
    audioChecks,
    acceptance,
  };

  assert(Object.values(acceptance).every(Boolean), `Live-control acceptance failed: ${JSON.stringify(acceptance)}`);
  writeFileSync(join(outputDir, "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeHtmlReport(outputDir, report);

  console.log(
    JSON.stringify({
      event: "restream_live_control_proof_completed",
      artifact: outputDir,
      watchPreview: "program.mp4",
      commandCount: commandLog.length,
      audioChecks,
      frameChecks: frameChecks.map(({ label, classifiedAs, passed }) => ({ label, classifiedAs, passed })),
      transitionChecks: transitionChecks.map(({ label, passed, bestBlend }) => ({ label, passed, bestBlend })),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
