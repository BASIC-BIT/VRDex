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
  "-copyts",
  "-i",
  file,
  "-vf",
  `trim=start=${start}:duration=${duration},${filter}`,
  "-fps_mode",
  "passthrough",
  "-an",
  "-pix_fmt",
  "rgb24",
  ...(one ? ["-frames:v", "1"] : []),
  "-f",
  "rawvideo",
  "pipe:1",
];
/** Decode once without seeking and retain original integer timestamps. Every
 * marker in each declared source window contributes to the maximum drift. */
export async function measureMediaMarkers(
  owner,
  file,
  { width, height, windows, maxSeconds },
) {
  const child = owner.start(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-nostats",
      "-loglevel",
      "info",
      "-copyts",
      "-threads",
      "2",
      "-filter_threads",
      "1",
      "-i",
      file,
      "-map",
      "0:v:0",
      "-vf",
      `crop=${Math.max(2, Math.floor((64 * width) / 1920))}:${Math.max(2, Math.floor((64 * height) / 1080))}:${Math.floor((160 * width) / 1920)}:${Math.floor((32 * height) / 1080)},scale=1:1,format=yuv444p,settb=1/90000,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:direct=1:file='pipe\\:5',format=rgb24`,
      "-fps_mode",
      "passthrough",
      "-threads",
      "1",
      "-f",
      "rawvideo",
      "pipe:3",
      "-map",
      "0:a:0",
      "-af",
      "aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,asettb=1/48000,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Number_of_samples,ametadata=mode=print:direct=1:file='pipe\\:6'",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-f",
      "s16le",
      "pipe:4",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe", "pipe", "pipe"] },
  );
  const parts = [[], [], [], []],
    sizes = [0, 0, 0, 0];
  const caps = [
    Math.ceil(maxSeconds * 64 * 1024),
    Math.ceil(maxSeconds * 61 * 3),
    Math.ceil(maxSeconds * 48000 * 2 + 96000),
    Math.ceil(maxSeconds * 32 * 1024),
  ];
  let failed = false;
  const stop = () => {
    failed = true;
    child.kill("SIGKILL");
  };
  const timer = setTimeout(stop, 120000);
  let diagnosticBytes = 0;
  child.stderr.on("data", (chunk) => {
    diagnosticBytes += chunk.length;
    if (diagnosticBytes > 1048576) stop();
  });
  for (const [pipe, i] of [
    [5, 0],
    [3, 1],
    [4, 2],
    [6, 3],
  ])
    child.stdio[pipe].on("data", (chunk) => {
      sizes[i] += chunk.length;
      if (sizes[i] > caps[i]) stop();
      else parts[i].push(chunk);
    });
  const code = await child.closed;
  clearTimeout(timer);
  if (code !== 0 || failed)
    throw Error("Bounded timestamp marker decode failed");
  const videoMetadata = Buffer.concat(parts[0]).toString(),
    audioMetadata = Buffer.concat(parts[3]).toString(),
    rgb = Buffer.concat(parts[1]),
    pcm = Buffer.concat(parts[2]);
  const video = [
    ...videoMetadata.matchAll(
      /^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:[^\n]+\nlavfi\.signalstats\.YAVG=[^\n]+\n/gm,
    ),
  ].map((m) => ({ index: Number(m[1]), pts: Number(m[2]) }));
  const audio = [
    ...audioMetadata.matchAll(
      /^frame:(\d+)\s+pts:(-?\d+)\s+pts_time:[^\n]+\nlavfi\.astats\.Overall\.Number_of_samples=([\d.]+)\n/gm,
    ),
  ].map((m) => ({
    index: Number(m[1]),
    pts: Number(m[2]),
    samples: Number(m[3]),
  }));
  if (
    !video.length ||
    !audio.length ||
    video.length * 3 !== rgb.length ||
    audio.reduce((sum, r) => sum + r.samples, 0) * 2 !== pcm.length
  )
    throw Error(
      `Incomplete timestamp marker payload (${video.length} frames/${rgb.length} bytes; ${audio.length} windows/${audio.reduce((sum, r) => sum + r.samples, 0)} samples/${pcm.length} bytes)`,
    );
  for (const rows of [video, audio])
    for (let i = 0; i < rows.length; i++)
      if (
        rows[i].index !== i ||
        !Number.isSafeInteger(rows[i].pts) ||
        (i && rows[i].pts <= rows[i - 1].pts)
      )
        throw Error("Invalid timestamp marker sequence");
  const visual = [],
    audible = [];
  let lit = false,
    loud = false,
    offset = 0;
  for (const row of video) {
    const i = row.index * 3,
      on = rgb[i] > 180 && rgb[i + 1] > 180 && rgb[i + 2] > 180;
    if (on && !lit) visual.push(row.pts / 90000);
    lit = on;
  }
  for (const row of audio) {
    for (let start = 0; start < row.samples; start += 480) {
      const count = Math.min(480, row.samples - start);
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const value = pcm.readInt16LE(offset + (start + i) * 2) / 32768;
        sum += value * value;
      }
      const on = Math.sqrt(sum / count) > 0.15;
      if (on && !loud) audible.push((row.pts + start) / 48000);
      loud = on;
    }
    offset += row.samples * 2;
  }
  const measured = windows.map((window) => {
    const frames = video.filter(
      (r) => r.pts / 90000 >= window.start && r.pts / 90000 < window.end,
    );
    const blocks = audio.filter(
      (r) => r.pts / 48000 >= window.start && r.pts / 48000 < window.end,
    );
    const markers = visual.filter(
      (time) => time > window.start + 0.2 && time < window.end - 0.2,
    );
    const sound = audible.filter(
      (time) => time >= window.start && time < window.end,
    );
    if (
      !frames.length ||
      !blocks.length ||
      blocks[0].pts / 48000 > window.start + 0.025 ||
      (blocks.at(-1).pts + blocks.at(-1).samples) / 48000 <
        window.end - 0.025 ||
      markers.length < Math.floor(window.end - window.start - 0.4) ||
      sound.length < Math.floor(window.end - window.start - 0.4)
    )
      throw Error("Incomplete source marker window");
    const pairs = markers.map((videoPts) => {
      const audioPts = sound.reduce((a, b) =>
        Math.abs(a - videoPts) <= Math.abs(b - videoPts) ? a : b,
      );
      return {
        videoPts,
        audioPts,
        audioMinusVideoMs: (audioPts - videoPts) * 1000,
      };
    });
    return {
      ...window,
      videoFrames: frames.length,
      audioWindows: blocks.length,
      visualMarkers: markers.length,
      audioMarkers: sound.length,
      pairs,
    };
  });
  const deltas = measured.flatMap((window) =>
    window.pairs.map((row) => Math.abs(row.audioMinusVideoMs)),
  );
  return {
    avDriftMs: Math.max(...deltas),
    markerCount: deltas.length,
    markerMethod: "original-integer-pts-no-seek-passthrough",
    markerVisualSeconds: visual,
    markerAudioSeconds: audible,
    markerWindows: measured,
    markerDecode: {
      videoFrames: video.length,
      audioWindows: audio.length,
      videoRange: [video[0].pts / 90000, video.at(-1).pts / 90000],
      audioRange: [
        audio[0].pts / 48000,
        (audio.at(-1).pts + audio.at(-1).samples) / 48000,
      ],
      complete: true,
    },
  };
}
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
        Number(info.format.start_time) + phase.atSeconds,
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
      rawArgs(
        file,
        Number(info.format.start_time) + phase.atSeconds,
        0.05,
        "scale=160:90",
        true,
      ),
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
  const markers = await measureMediaMarkers(owner, file, {
    width: p.width,
    height: p.height,
    maxSeconds: request.durationSeconds + 180,
    windows: phases
      .filter((phase) => phase.identity !== "slate")
      .map((phase) => ({
        identity: phase.identity,
        start: Number(info.format.start_time) + phase.atSeconds,
        end: Number(info.format.start_time) + phase.atSeconds + 6,
      })),
  });
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
    ...markers,
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
