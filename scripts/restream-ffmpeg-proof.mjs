import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const artifactRoot = resolve("artifacts/restream-ffmpeg-proof");
const timeline = [
  { atSeconds: 0, command: "start_program", scene: "source-a", audio: "source-a-tone-440hz" },
  { atSeconds: 4, command: "switch_hold", scene: "hold-slate", audio: "hold-tone-220hz" },
  { atSeconds: 8, command: "switch_source", targetSourceKey: "source-b", scene: "source-b", audio: "source-b-tone-880hz" },
  { atSeconds: 12, command: "stop_program" },
];

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";

    if (options.capture) {
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function latestArtifactDir() {
  if (!existsSync(artifactRoot)) {
    throw new Error(`No artifact root exists at ${artifactRoot}. Run pnpm proof:restream:ffmpeg first.`);
  }

  const entries = readdirSync(artifactRoot)
    .map((entry) => join(artifactRoot, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  if (entries.length === 0) {
    throw new Error(`No proof artifacts exist under ${artifactRoot}. Run pnpm proof:restream:ffmpeg first.`);
  }

  return entries[0];
}

function parseFrameRate(value) {
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator === 0 ? 0 : numerator / denominator;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runProof() {
  await run("ffmpeg", ["-version"], { capture: true });
  await run("ffprobe", ["-version"], { capture: true });

  const outputDir = join(artifactRoot, timestamp());
  const hlsDir = join(outputDir, "hls");
  const framesDir = join(outputDir, "frames");
  mkdirSync(hlsDir, { recursive: true });
  mkdirSync(framesDir, { recursive: true });

  writeFileSync(join(outputDir, "command-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);

  const playlist = join(hlsDir, "program.m3u8");
  const segmentPattern = join(hlsDir, "program-%03d.ts");
  const args = [
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
    playlist,
  ];

  await run("ffmpeg", args);

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
      playlist,
      "-frames:v",
      "1",
      "-update",
      "1",
      join(framesDir, `${label}.jpg`),
    ]);
  }

  await checkProof(outputDir);
  console.log(`Restream FFmpeg proof artifacts: ${outputDir}`);
}

async function probePlaylist(playlist) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", playlist],
    { capture: true },
  );
  return JSON.parse(stdout);
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

  return { segmentCount: segmentNames.length, totalDuration };
}

async function checkProof(inputDir = process.argv[3] ? resolve(process.argv[3]) : latestArtifactDir()) {
  const outputDir = resolve(inputDir);
  const playlistPath = join(outputDir, "hls", "program.m3u8");
  const timelinePath = join(outputDir, "command-timeline.json");
  assert(existsSync(timelinePath), `Missing command timeline: ${timelinePath}`);

  const commands = JSON.parse(readFileSync(timelinePath, "utf8"));
  assert(commands.length === timeline.length, `Expected ${timeline.length} timeline commands, found ${commands.length}.`);
  assert(commands[1]?.command === "switch_hold", "Timeline should switch to hold slate at the second command.");
  assert(commands[2]?.command === "switch_source", "Timeline should switch to source B at the third command.");

  const playlistSummary = checkPlaylist(outputDir);
  const metadata = await probePlaylist(playlistPath);
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams.find((stream) => stream.codec_type === "audio");

  assert(video, "Output has no video stream.");
  assert(audio, "Output has no audio stream.");
  assert(video.codec_name === "h264", `Expected H.264 video, found ${video.codec_name}.`);
  assert(video.width === 1920 && video.height === 1080, `Expected 1920x1080 video, found ${video.width}x${video.height}.`);
  assert(Math.abs(parseFrameRate(video.avg_frame_rate) - 60) < 0.1, `Expected 60 fps, found ${video.avg_frame_rate}.`);
  assert(audio.codec_name === "aac", `Expected AAC audio, found ${audio.codec_name}.`);
  assert(Number(audio.sample_rate) === 48000, `Expected 48kHz audio, found ${audio.sample_rate}.`);
  assert(Number(audio.channels) === 2, `Expected stereo audio, found ${audio.channels} channels.`);

  for (const frame of ["source-a.jpg", "hold-slate.jpg", "source-b.jpg"]) {
    const framePath = join(outputDir, "frames", frame);
    assert(existsSync(framePath), `Missing transition evidence frame ${frame}.`);
    assert(statSync(framePath).size > 0, `Transition evidence frame ${frame} is empty.`);
  }

  console.log(
    JSON.stringify(
      {
        artifact: outputDir,
        playlist: playlistPath,
        segmentCount: playlistSummary.segmentCount,
        durationSeconds: playlistSummary.totalDuration,
        video: `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate}`,
        audio: `${audio.codec_name} ${audio.sample_rate}Hz ${audio.channels}ch`,
        frames: readdirSync(join(outputDir, "frames")).map((entry) => basename(entry)),
      },
      null,
      2,
    ),
  );
}

const mode = process.argv[2] ?? "run";

try {
  if (mode === "run") {
    await runProof();
  } else if (mode === "check") {
    await checkProof();
  } else {
    throw new Error(`Unknown mode ${mode}. Use run or check.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
