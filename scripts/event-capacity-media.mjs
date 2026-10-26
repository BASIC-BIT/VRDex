import { CAPACITY_FIXTURE as F } from "./event-capacity-fixture-data.mjs";
import { parseMarkerMetadata } from "./event-marker-metadata.mjs";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { decodeSourceAudio, SOURCE_FREQUENCIES, MARKER_SCHEMA } from "./event-source-markers.mjs";
import { decodeMarkerVisuals } from "./event-marker-record.mjs";
import { buildMarkerContexts } from "./event-marker-contexts.mjs";
import { packMarkerRecord, validateMarkerRecord } from "./event-marker-evidence.mjs";
import { resolveDestinationProfile } from "../workers/restream/broadcast-profiles.mjs";
import { assertProgramClock } from './event-marker-clock.mjs';
import { programDecodeArguments } from './event-marker-program-guards.mjs';
export async function probe(owner, file, {observeRaw,observeCapture,acquisition}={}) {
 const raw=await owner.run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",file],{timeoutMs:15000,observeCapture,signal:acquisition?.signal});
 await observeRaw?.(raw);return JSON.parse(raw.toString());
}
export async function createFixture(owner, file, id) {
  if (!Object.hasOwn(SOURCE_FREQUENCIES, id)) throw Error("marker_fixture_identity");
  const frequency = SOURCE_FREQUENCIES[id];
  const color = id === "a" ? F.identityColors.a : F.identityColors.b, M = F.marker, A = F.audio, O = F.output, E = F.expected;
  const filter = `drawbox=x=${M.identityX}:y=${M.identityY}:w=${M.identityWidth}:h=${M.identityHeight}:color=${color}:t=${M.fill},drawbox=x=${M.flashX}:y=${M.flashY}:w=${M.flashWidth}:h=${M.flashHeight}:color=${M.offColor}:t=${M.fill},drawbox=x=${M.flashX}:y=${M.flashY}:w=${M.flashWidth}:h=${M.flashHeight}:color=${M.onColor}:t=${M.fill}:enable='lt(mod(t,${M.periodSeconds}),${M.onSeconds})'`;
  await owner.run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      F.videoSource,
      "-f",
      "lavfi",
      "-i",
      `anoisesrc=color=${A.color}:sample_rate=${A.sampleRateHz}:amplitude=${A.amplitude}:seed=${A.leftSeed}[a];anoisesrc=color=${A.color}:sample_rate=${A.sampleRateHz}:amplitude=${A.amplitude}:seed=${A.rightSeed}[b];[a][b]amerge=inputs=${A.mergeInputs},aeval=val(0)+if(lt(mod(t\\,${A.periodSeconds})\\,${A.onSeconds})\\,${A.carrierAmplitude}*sin(2*PI*${frequency}*t)\\,0)|val(1)+if(lt(mod(t\\,${A.periodSeconds})\\,${A.onSeconds})\\,${A.carrierAmplitude}*sin(2*PI*${frequency}*t)\\,0):c=${A.layout}`,
      "-t",
      O.durationText,
      "-vf",
      filter,
      "-c:v",
      O.videoCodec,
      "-threads",
      O.threadsText,
      "-preset",
      O.preset,
      "-b:v",
      O.videoBitrate,
      "-maxrate",
      O.maxrate,
      "-bufsize",
      O.bufsize,
      "-g",
      O.gopText,
      "-pix_fmt",
      O.pixelFormat,
      "-c:a",
      O.audioCodec,
      "-b:a",
      O.audioBitrate,
      "-ac",
      O.channelsText,
      "-f",
      O.mux,
      "-y",
      file,
    ],
    { timeoutMs: 180000 },
  );
  const facts = await probe(owner, file),
    v = facts.streams.find((s) => s.codec_type === "video"),
    a = facts.streams.find((s) => s.codec_type === "audio");
  if (
    v.codec_name !== E.videoCodec ||
    v.width !== E.width ||
    v.height !== E.height ||
    v.r_frame_rate !== E.frameRateText ||
    a.codec_name !== E.audioCodec ||
    a.channels !== E.channels ||
    a.sample_rate !== E.sampleRateText
  )
    throw Error("Input fixture not H264/AAC 1080p60");
  return {
    videoCodec: v.codec_name,
    width: v.width,
    height: v.height,
    fps: E.fps,
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
/** Proof-only observation of the exact selected frame and submitted program tick.
 * Delegates original buffer methods without changing media, cursor or ownership. */
export function observeSelectionMarkers(
  input,
  { source, quality },
  getTick,
  selections,
) {
  const buffer = input.buffer;
  let lastIndex = -1,
    sourceLit = false,
    sourceOnset,
    selected,
    outputLit = false;
  const flash = () => {
    if (!buffer.frame) return false;
    let sum = 0;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        sum +=
          buffer.frame[
            Math.floor(((32 + y * 16) * quality.height) / 1080) *
              quality.width +
              Math.floor(((160 + x * 16) * quality.width) / 1920)
          ];
    return sum / 16 > 180;
  };
  const publish = buffer.publishFrame;
  buffer.publishFrame = function (...args) {
    const result = Reflect.apply(publish, this, args);
    if (this.frameIndex !== lastIndex) {
      const on = flash();
      if (on && !sourceLit) {
        sourceOnset = this.framePts;
        if (selected && getTick() < selected.tick + 4 * selected.fps) {
          if (selected.sourcePulses.length >= 256)
            throw Error("Source marker proof bound exceeded");
          selected.sourcePulses.push(sourceOnset);
        }
      }
      sourceLit = on;
      lastIndex = this.frameIndex;
    }
    return result;
  };
  const reset = buffer.reset;
  buffer.reset = function (...args) {
    const result = Reflect.apply(reset, this, args);
    lastIndex = -1;
    sourceLit = false;
    sourceOnset = undefined;
    selected = undefined;
    outputLit = false;
    return result;
  };
  const begin = buffer.beginPlayback;
  buffer.beginPlayback = function (...args) {
    const result = Reflect.apply(begin, this, args);
    if (selections.length >= 8) throw Error("Selection proof bound exceeded");
    selected = {
      identity: source.sourceId,
      revision: source.revision,
      tick: getTick(),
      fps: quality.frameRate,
      sourcePts: this.framePts,
      carryIn: flash() && sourceOnset < this.framePts,
      pulses: [],
      sourcePulses: [],
      lastSourcePts: this.framePts,
      endTick: getTick(),
    };
    selections.push(selected);
    outputLit = false;
    return result;
  };
  const take = buffer.takeAudio;
  buffer.takeAudio = function (...args) {
    const result = Reflect.apply(take, this, args);
    const tick = getTick();
    if (selected && tick < selected.tick + 4 * selected.fps) {
      const on = flash();
      if (on && !outputLit)
        selected.pulses.push({ tick, sourcePts: this.framePts });
      selected.endTick = tick + 1;
      selected.lastSourcePts = this.framePts;
      outputLit = on;
    }
    return result;
  };
  return input;
}

/** @typedef {{width:number, height:number, maxSeconds:number, finalProbe?:typeof probe}} DecodeOptions
 * @typedef {{index:number, pts:number, samples:number}} AudioMetadataRow
 * @typedef {{index:number, pts:number}} VideoMetadataRow
 * @typedef {Awaited<ReturnType<typeof probe>>} ProbeResult
 * @typedef {{native:{exitCode:number}, [key:string]:*}} CapturedInvocation
 * @typedef {{child:object, stop:Function, finish:()=>Promise<CapturedInvocation>}} StartedCapturedInvocation
 * @typedef {{assurance:object, inputSHA:string}} ProgramClock
 * ProgramClock additionally requires membership in the existing private registry.
 * @typedef {{audioChunks:Uint8Array[], audioRows:AudioMetadataRow[], videoRows:VideoMetadataRow[], rgb:Uint8Array, nativeCapture:CapturedInvocation|null, finalProbe:ProbeResult}} DecodedCapture
 * @typedef {Omit<DecodedCapture, 'nativeCapture'> & {nativeCapture:CapturedInvocation}} QualifiedDecodedCapture
 * @typedef {DecodeOptions & {startCapture:(request:{original:string[], stdio:string[]})=>StartedCapturedInvocation|Promise<StartedCapturedInvocation>, observeDecoded:(capture:QualifiedDecodedCapture)=>ProgramClock|Promise<ProgramClock>}} QualifiedDecodeOptions
 * @typedef {ReturnType<typeof decodeSourceAudio> & ReturnType<typeof decodeMarkerVisuals> & {watermarks:object[], audioMetadataRows:number, recordingSha256:string, videoStreamIndex:number|undefined, audioStreamIndex:number|undefined}} DecodedMarkerFacts
 * @typedef {DecodedMarkerFacts & {clock?:never, assurance?:never}} ObservedMediaMarkerRecord
 * @typedef {DecodedMarkerFacts & {clock:ProgramClock, assurance:ProgramClock['assurance']}} ProgramClockMarkerRecord
 */
/** Ordinary observations do not carry qualification authority.
 * @param {DecodeOptions} options
 * @returns {Promise<ObservedMediaMarkerRecord>}
 */
export async function decodeMediaMarkerRecord(owner, file, options) {
  if ('observeDecoded' in options || 'startCapture' in options)
    throw Error('marker_qualified_decoder_required');
  return decodeMarkerRecord(owner, file, options, () => undefined);
}
/** Require captured originals and a privately checked program clock.
 * @param {QualifiedDecodeOptions} options
 * @returns {Promise<ProgramClockMarkerRecord>}
 */
export async function decodeQualifiedMediaMarkerRecord(owner, file, options) {
  if (typeof options?.startCapture !== 'function' || typeof options?.observeDecoded !== 'function')
    throw Error('marker_clock_unproven');
  return decodeMarkerRecord(owner, file, options, async capture => {
    if (!capture.nativeCapture) throw Error('marker_clock_unproven');
    const clock = await options.observeDecoded(capture);
    assertProgramClock(clock);
    return clock;
  });
}
/** Decode once without seeking and retain original integer timestamps. The
 * resolver is required and supplied only by the two module-owned wrappers.
 * @param {(capture:DecodedCapture)=>ProgramClock|undefined|Promise<ProgramClock|undefined>} resolveClock
 */
async function decodeMarkerRecord(
  owner,
  file,
  { width, height, maxSeconds, startCapture, finalProbe=probe },
  resolveClock,
) {
  const original=programDecodeArguments(file,{width,height});
  const stdio=["ignore", "ignore", "pipe", "pipe", "pipe", "pipe", "pipe"];
  const captured=startCapture?await startCapture({original,stdio}):null;
  if (startCapture && (!captured?.child || typeof captured.stop !== 'function' || typeof captured.finish !== 'function' ||
      ![3,4,5,6].every(fd => typeof captured.child.stdio?.[fd]?.on === 'function'))) {
    // A malformed supplier may already own a child. Close that child without
    // launching an uncaptured replacement or invoking its observer.
    if (typeof captured?.stop === 'function') captured.stop('marker_clock_unproven');
    else captured?.child?.kill?.('SIGKILL');
    const failure = Error('marker_clock_unproven');
    try { if (typeof captured?.finish === 'function') await captured.finish(); }
    catch (error) { failure.cause = error; }
    await (captured?.child?.nativeClosed ?? captured?.child?.closed);
    throw failure;
  }
  const child=startCapture?captured.child:owner.start("ffmpeg",original,{stdio});
  const parts = [[], [], [], []],
    sizes = [0, 0, 0, 0];
  const caps = [
    Math.ceil(maxSeconds * 64 * 1024),
    Math.ceil(maxSeconds * 61 * 6),
    Math.ceil(maxSeconds * 48000 * 2 + 96000),
    Math.ceil(maxSeconds * 32 * 1024),
  ];
  let failed = false;
  const stop = () => {
    failed = true;
    if(captured)captured.stop("byte_cap");else child.kill("SIGKILL");
  };
  const timer = captured?null:setTimeout(stop, 120000);
  let diagnosticBytes = 0;
  if(!captured)child.stderr.on("data", (chunk) => {
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
  const nativeCapture=captured?await captured.finish():null;
  if (captured && !Number.isInteger(nativeCapture?.native?.exitCode)) throw Error('marker_clock_unproven');
  const code=captured?nativeCapture.native.exitCode:await child.closed;
  clearTimeout(timer);
  if (code !== 0 || failed)
    throw Error("Bounded timestamp marker decode failed");
  const videoMetadata = Buffer.concat(parts[0]).toString(),
    audioMetadata = Buffer.concat(parts[3]).toString(),
    rgb = Buffer.concat(parts[1]);
  const video = parseMarkerMetadata(videoMetadata, "video"),
    audio = parseMarkerMetadata(audioMetadata, "audio");
  const info = await finalProbe(owner, file);
  const clock=await resolveClock({audioChunks: parts[2], audioRows: audio, videoRows: video, rgb, nativeCapture,finalProbe:info});
  const decoded = {
    ...decodeSourceAudio(parts[2], audio,clock),
    ...decodeMarkerVisuals(rgb, video,clock),
    watermarks: [],
    audioMetadataRows: audio.length,
    ...(clock === undefined ? {} : {clock, assurance:clock.assurance}),
  };
  decoded.episodes.forEach((episode, id) => { episode.id = id; });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  decoded.recordingSha256 = hash.digest("hex");
  if (clock !== undefined) {
    const checked = assertProgramClock(clock);
    if (decoded.recordingSha256 !== clock.inputSHA || decoded.recordingSha256 !== checked.file.sha256)
      throw Error('marker_clock_binding');
  }
  decoded.videoStreamIndex = info.streams.find(s => s.codec_type === "video")?.index;
  decoded.audioStreamIndex = info.streams.find(s => s.codec_type === "audio")?.index;
  return decoded;
}
/** @typedef {Parameters<typeof buildMarkerContexts>[1]} ContextOptions
 * @typedef {{markerSchema:string, markerEvidence:ReturnType<typeof packMarkerRecord>, avDriftMs:number, markerCount:number, markerMethod:string, markerWindows:object[], transitionMarkers:object[], markerDecode:{videoFrames:number, audioWindows:number, videoRange:number[], audioRange:number[], complete:boolean}}} MediaMarkerMeasurement
 * @param {DecodeOptions & ContextOptions} options
 * @returns {Promise<MediaMarkerMeasurement>}
 */
export async function measureMediaMarkers(owner, file, options) {
  const decoded = await decodeMediaMarkerRecord(owner, file, options);
  const bound = buildMarkerContexts(decoded, options);
  decoded.contexts = bound.contexts;
  const markerEvidence = packMarkerRecord(decoded);
  validateMarkerRecord(markerEvidence);
  const deltas = bound.contexts.flatMap(c => c.pairs.map(p => Math.abs(p.offsetNumerator / 720)));
  if (!deltas.length) throw Error("marker_context_missing");
  return {
    markerSchema: MARKER_SCHEMA,
    markerEvidence,
    avDriftMs: Math.max(...deltas),
    markerCount: deltas.length,
    markerMethod: "original-integer-pts-no-seek-passthrough",
    markerWindows: bound.measured,
    transitionMarkers: bound.transitions,
    markerDecode: {
      videoFrames: decoded.videoFrames,
      audioWindows: decoded.audioMetadataRows,
      videoRange: decoded.videoRange.map(n => n / 90000),
      audioRange: decoded.audioRange.map(n => n / 48000),
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
  selections,
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
    selections,
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
