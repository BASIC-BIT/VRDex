import { createInterface } from "node:readline";
import { resolveDestinationProfile } from "../workers/restream/broadcast-profiles.mjs";
export async function probe(owner, file) {
  return JSON.parse(
    (
      await owner.run(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        { timeoutMs: 15000 },
      )
    ).toString(),
  );
}
export async function createFixture(owner, file, id) {
  const color = id === "a" ? "red" : "blue";
  const filter = `drawbox=x=0:y=0:w=128:h=128:color=${color}:t=fill,drawbox=x=128:y=0:w=128:h=128:color=black:t=fill,drawbox=x=128:y=0:w=128:h=128:color=white:t=fill:enable='lt(mod(t,1),0.1)'`;
  await owner.run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=60[scene];testsrc=size=480x270:rate=60:decimals=2[clock];[scene][clock]overlay=x=1440:y=0",
      "-f",
      "lavfi",
      "-i",
      "anoisesrc=color=white:sample_rate=48000:amplitude=0.12:seed=42[a];anoisesrc=color=white:sample_rate=48000:amplitude=0.12:seed=43[b];[a][b]amerge=inputs=2,aeval=val(0)+if(lt(mod(t\\,1)\\,0.1)\\,0.65*sin(2*PI*1000*t)\\,0)|val(1)+if(lt(mod(t\\,1)\\,0.1)\\,0.65*sin(2*PI*1000*t)\\,0):c=stereo",
      "-t",
      "12",
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "veryfast",
      "-b:v",
      "6000k",
      "-maxrate",
      "6000k",
      "-bufsize",
      "12000k",
      "-g",
      "60",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "320k",
      "-ac",
      "2",
      "-f",
      "mpegts",
      "-y",
      file,
    ],
    { timeoutMs: 180000 },
  );
  const facts = await probe(owner, file),
    v = facts.streams.find((s) => s.codec_type === "video"),
    a = facts.streams.find((s) => s.codec_type === "audio");
  if (
    v.codec_name !== "h264" ||
    v.width !== 1920 ||
    v.height !== 1080 ||
    v.r_frame_rate !== "60/1" ||
    a.codec_name !== "aac" ||
    a.channels !== 2 ||
    a.sample_rate !== "48000"
  )
    throw Error("Input fixture not H264/AAC 1080p60");
  return {
    videoCodec: v.codec_name,
    width: v.width,
    height: v.height,
    fps: 60,
    audioCodec: a.codec_name,
    channels: a.channels,
    sampleRate: Number(a.sample_rate),
  };
}
export async function packetFacts(owner, file, audioWindow) {
  const child = owner.start(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_packets",
      "-show_entries",
      "packet=stream_index,dts_time,pts_time,flags,size",
      "-of",
      "compact=p=0",
      file,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let maxGap = 0,
    maxGop = 0,
    lastKey,
    packets = 0,
    activeAudioBytes = 0,
    activeAudioStart,
    activeAudioEnd;
  const first = new Map(),
    last = new Map(),
    bytes = new Map();
  let diagnosticBytes = 0;
  child.stderr.on("data", (b) => {
    diagnosticBytes += b.length;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const row = Object.fromEntries(line.split("|").map((s) => s.split("=")));
      const index = Number(row.stream_index),
        time = Number(row.dts_time);
      if (!Number.isFinite(time) || !row.dts_time) continue;
      if (last.has(index)) {
        if (time < last.get(index)) throw Error("Nonmonotonic packet");
        maxGap = Math.max(maxGap, time - last.get(index));
      } else first.set(index, time);
      if (
        index === 1 &&
        audioWindow &&
        time >= audioWindow[0] &&
        time <= audioWindow[1]
      ) {
        activeAudioBytes += Number(row.size);
        activeAudioStart ??= time;
        activeAudioEnd = time;
      }
      last.set(index, time);
      bytes.set(index, (bytes.get(index) ?? 0) + Number(row.size));
      if (index === 0 && row.flags?.includes("K")) {
        if (lastKey !== undefined) maxGop = Math.max(maxGop, time - lastKey);
        lastKey = time;
      }
      packets++;
    }
    if ((await child.closed) !== 0 || !packets || diagnosticBytes > 1048576)
      throw Error("Packet verification failed");
    return {
      maxGap,
      maxGop,
      packets,
      monotonic: true,
      audioKbps: audioWindow
        ? (activeAudioBytes * 8) / (activeAudioEnd - activeAudioStart) / 1000
        : (bytes.get(1) * 8) / (last.get(1) - first.get(1)) / 1000,
    };
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
  }
}
const rawArgs = (file, start, duration, filter, one = false) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-ss",
  String(start),
  "-i",
  file,
  "-t",
  String(duration),
  "-vf",
  filter,
  "-an",
  "-pix_fmt",
  "rgb24",
  ...(one ? ["-frames:v", "1"] : []),
  "-f",
  "rawvideo",
  "pipe:1",
];
export async function verifyMedia(
  owner,
  file,
  request,
  destination,
  phases,
  references,
  internalDelayMs,
) {
  const info = await probe(owner, file),
    video = info.streams.find((s) => s.codec_type === "video"),
    audio = info.streams.find((s) => s.codec_type === "audio"),
    p = resolveDestinationProfile({ settings: request.settings, destination });
  const facts = await packetFacts(owner, file, [
    Number(info.format.start_time) + phases[0].atSeconds,
    Number(info.format.start_time) + phases[0].atSeconds + 6,
  ]);
  const identities = [];
  let psnr = Infinity;
  for (const phase of phases) {
    // Crop the source marker after scaling; decode from a known post-ack interval.
    const x = Math.round((64 * p.width) / 1920),
      y = Math.round((64 * p.height) / 1080);
    const rgb = await owner.run(
      "ffmpeg",
      rawArgs(
        file,
        phase.atSeconds,
        0.05,
        `crop=2:2:${x}:${y},scale=1:1`,
        true,
      ),
      { maxBytes: 65536 },
    );
    if (rgb.length !== 3) throw Error("Missing identity frame");
    const [r, g, b] = rgb;
    const identity =
      r > 150 && r > g * 2 && r > b * 2
        ? "a"
        : b > 150 && b > r * 2 && b > g * 2
          ? "b"
          : r < 60 && g < 60 && b < 60
            ? "slate"
            : "unknown";
    if (identity !== phase.identity)
      throw Error("Wrong encoded source identity");
    identities.push(identity);
    if (identity === "slate") continue;
    const frame = await owner.run(
      "ffmpeg",
      rawArgs(file, phase.atSeconds, 0.05, "scale=160:90", true),
      { maxBytes: 65536 },
    );
    const reference = references[identity];
    const size = 160 * 90 * 3;
    let mse = Infinity;
    for (let offset = 0; offset + size <= reference.length; offset += size) {
      let sum = 0;
      for (let i = 0; i < size; i++) {
        const delta = frame[i] - reference[offset + i];
        sum += delta * delta;
      }
      mse = Math.min(mse, sum / size);
    }
    psnr = Math.min(
      psnr,
      10 * Math.log10((255 * 255) / Math.max(mse, 0.00001)),
    );
  }
  const start = phases[0].atSeconds,
    duration = 6;
  const flashes = await owner.run(
    "ffmpeg",
    rawArgs(
      file,
      start,
      duration,
      `crop=${Math.max(2, Math.floor((64 * p.width) / 1920))}:${Math.max(2, Math.floor((64 * p.height) / 1080))}:${Math.floor((160 * p.width) / 1920)}:${Math.floor((32 * p.height) / 1080)},scale=1:1`,
    ),
    { maxBytes: 65536 },
  );
  const pcm = await owner.run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(start),
      "-i",
      file,
      "-t",
      String(duration),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { maxBytes: 1000000 },
  );
  const visual = [],
    audible = [];
  let lit = false,
    loud = false;
  for (let i = 0; i < flashes.length; i += 3) {
    const on = flashes[i] > 180 && flashes[i + 1] > 180 && flashes[i + 2] > 180;
    if (on && !lit) visual.push(i / 3 / p.frameRate);
    lit = on;
  }
  for (let i = 0; i + 960 <= pcm.length; i += 960) {
    let sum = 0;
    for (let j = i; j < i + 960; j += 2) {
      const value = pcm.readInt16LE(j) / 32768;
      sum += value * value;
    }
    const on = Math.sqrt(sum / 480) > 0.15;
    if (on && !loud) audible.push(i / 960 / 100);
    loud = on;
  }
  const deltas = visual
    .filter((t) => t > 0.2 && t < duration - 0.2)
    .map((t) => Math.min(...audible.map((a) => Math.abs(a - t))) * 1000);
  return {
    ...facts,
    destination,
    videoCodec: video?.codec_name,
    width: video?.width,
    height: video?.height,
    fps: video?.r_frame_rate.split("/").reduce((a, b) => a / b),
    pixelFormat: video?.pix_fmt,
    audioCodec: audio?.codec_name,
    channels: audio?.channels,
    sampleRate: Number(audio?.sample_rate),
    identities,
    visualPsnrDb: psnr,
    avDriftMs: Math.max(...deltas),
    markerVisualSeconds: visual,
    markerAudioSeconds: audible,
    markerCount: deltas.length,
    internalDelayMs,
  };
}
export async function referenceFrames(owner, file) {
  return owner.run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      "scale=160:90",
      "-an",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { timeoutMs: 60000, maxBytes: 40 * 1024 * 1024 },
  );
}
