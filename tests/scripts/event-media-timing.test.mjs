import assert from "node:assert/strict";
import test from "node:test";
import { LatestMediaBuffer } from "../../workers/restream/input-supervisor.mjs";
const pcm = (start, count) => {
  const b = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    b.writeInt16LE((start + i) % 30000, i * 4);
    b.writeInt16LE((start + i) % 30000, i * 4 + 2);
  }
  return b;
};
function frame(b, index, time, value = index) {
  b.videoTimestamp(index, Math.round(time * 90000));
  b.video(Buffer.alloc(6, value));
}
function audio(b, index, time, samples, start) {
  b.audioTimestamp(index, Math.round(time * 48000), samples);
  b.audio(pcm(start, samples));
}
function left(b) {
  return Array.from({ length: b.length / 4 }, (_, i) => b.readInt16LE(i * 4));
}
test("measured prewarm backlog anchors audio to video rather than oldest retained PCM", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0.15);
  audio(b, 0, 0, 12000, 0);
  b.beginPlayback();
  assert.deepEqual(
    left(b.takeAudio(6400)),
    Array.from({ length: 1600 }, (_, i) => 7200 + i),
  );
  assert(b.audioBytes <= 48000);
});
test("duplicated 30fps frames at 60fps and jitter preserve continuous PCM without repeated samples", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0.05);
  audio(b, 0, 0, 12000, 0);
  b.beginPlayback();
  const all = [];
  for (let i = 0; i < 6; i++) {
    if (i === 2) frame(b, 1, 0.083333333);
    if (i === 4) frame(b, 2, 0.14);
    all.push(...left(b.takeAudio(3200)));
  }
  assert.deepEqual(
    all,
    Array.from({ length: 4800 }, (_, i) => 2400 + i),
  );
});
test("Cut resume reanchors, repeated reads do not, and decoder reset discards old timeline", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0.05);
  audio(b, 0, 0, 12000, 0);
  b.beginPlayback();
  assert.equal(left(b.takeAudio(3200))[0], 2400);
  frame(b, 1, 0.1);
  assert.equal(left(b.takeAudio(3200))[0], 3200);
  b.beginPlayback();
  assert.equal(left(b.takeAudio(3200))[0], 4800);
  b.reset();
  assert.equal(b.frame, undefined);
  assert.deepEqual(left(b.takeAudio(3200)), Array(800).fill(0));
  frame(b, 0, 0);
  audio(b, 0, 0, 1600, 12000);
  b.beginPlayback();
  assert.equal(left(b.takeAudio(3200))[0], 12000);
});
test("raw frame and PCM before metadata are associated without a third frame or stale promotion", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0, 7);
  b.video(Buffer.from([8, 8]));
  b.video(Buffer.from([8, 8, 8, 8]));
  assert.equal(b.frame[0], 7);
  assert(b.partial.length <= 6);
  b.videoTimestamp(1, 3000);
  assert.equal(b.frame[0], 8);
  assert.equal(b.framePts, 3000);
  b.audio(pcm(0, 4800));
  b.beginPlayback();
  assert.deepEqual(left(b.takeAudio(16)), [0, 0, 0, 0]);
  b.audioTimestamp(0, 0, 4800);
  assert.deepEqual(left(b.takeAudio(16)), [1600, 1601, 1602, 1603]);
  b.video(Buffer.alloc(12, 9));
  assert(b.partial.length <= 6);
  assert.equal(b.frame[0], 8);
  b.videoTimestamp(2, 6000);
  assert.equal(
    b.frame[0],
    8,
    "superseded unmatched frame cannot replace current",
  );
  b.videoTimestamp(3, 9000);
  assert.equal(b.frame[0], 9);
});
test("timestamp overlaps skip duplicate PCM and explicit gaps produce silence", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 8, 1);
  audio(b, 1, 4 / 48000, 8, 101);
  audio(b, 2, 16 / 48000, 4, 201);
  b.beginPlayback();
  assert.deepEqual(
    left(b.takeAudio(80)),
    [
      1, 2, 3, 4, 5, 6, 7, 8, 105, 106, 107, 108, 0, 0, 0, 0, 201, 202, 203,
      204,
    ],
  );
});
test("integer PTS remains sample accurate at a twelve-hour session timestamp", () => {
  const b = new LatestMediaBuffer(6),
    base = 12 * 3600;
  frame(b, 0, base + 0.15);
  audio(b, 0, base, 12000, 0);
  b.beginPlayback();
  assert.equal(left(b.takeAudio(4))[0], 7200);
});
test("overflow of retained media reanchors without increasing the 250ms bound", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 12000, 0);
  b.beginPlayback();
  b.takeAudio(4);
  audio(b, 1, 0.25, 12000, 12000);
  frame(b, 1, 0.4);
  assert.equal(b.audioBytes, 48000);
  assert.equal(left(b.takeAudio(4))[0], 19200);
});
test("missing timing and metadata overflow cannot publish unmatched media", () => {
  const b = new LatestMediaBuffer(6);
  b.video(Buffer.alloc(6, 1));
  b.audio(pcm(1, 100));
  assert.equal(b.frame, undefined);
  assert.deepEqual(left(b.takeAudio(4)), [0]);
  for (let i = 0; i < 1000; i++) b.videoTimestamp(i, i * 1500);
  assert.equal(b.timingFailed, true);
  assert.equal(b.frame, undefined);
});
test("a temporary empty PCM range advances the existing clock and never replays late samples", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 4, 1);
  b.beginPlayback();
  assert.deepEqual(left(b.takeAudio(16)), [1, 2, 3, 4]);
  assert.deepEqual(left(b.takeAudio(16)), [0, 0, 0, 0]);
  audio(b, 1, 4 / 48000, 8, 101);
  assert.deepEqual(left(b.takeAudio(16)), [105, 106, 107, 108]);
});
test("audio discontinuity beyond retained media discards old epoch and anchors to new matched frame", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 1600, 1);
  b.beginPlayback();
  b.takeAudio(4);
  audio(b, 1, 20, 1600, 101);
  frame(b, 1, 20);
  assert.equal(left(b.takeAudio(4))[0], 101);
  assert(b.audioBytes <= 48000);
});
test("real decoder normalizes 44100Hz mono before timestamping 48000Hz stereo PCM", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawn, execFileSync } = await import("node:child_process");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const { createInputSupervisor } =
    await import("../../workers/restream/input-supervisor.mjs");
  const directory = await mkdtemp(join(tmpdir(), "event-timing-contract-"));
  let input;
  t.after(async () => {
    await input?.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const path = join(directory, "mono.mkv");
  execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=64x48:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=997:sample_rate=44100",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    { timeout: 15000, stdio: "ignore" },
  );
  input = createInputSupervisor({
    source: { slotKey: "mono", sourceId: "mono", url: path },
    quality: { width: 64, height: 48, frameRate: 60 },
    spawnProcess: (command, args, options) => {
      const paced = [...args];
      paced.splice(paced.indexOf("-i"), 0, "-re");
      return spawn(command, paced, options);
    },
  });
  input.start();
  const deadline = performance.now() + 5000;
  const covered = () =>
    input.buffer
      .audioRanges()
      .some(
        (row) =>
          row.start <= Math.round((input.buffer.framePts * 48000) / 90000) &&
          Math.round((input.buffer.framePts * 48000) / 90000) < row.end,
      );
  while (
    (!input.getObservation().ready || !covered()) &&
    performance.now() < deadline
  )
    await sleep(20);
  assert.equal(
    covered(),
    true,
    "actual PCM must cover the frame before reading",
  );
  assert.equal(input.getObservation().ready, true);
  assert.equal(input.buffer.timingFailed, false);
  assert(input.buffer.audioMetadataSamples > 0);
  assert(input.buffer.audioBytes <= 48000);
  const data = input.buffer.takeAudio(3200);
  assert(
    data.some((byte) => byte !== 0),
    "actual decoded PCM is audible",
  );
  for (let i = 0; i < data.length; i += 4)
    assert.equal(
      data.readInt16LE(i),
      data.readInt16LE(i + 2),
      "mono is normalized to paired stereo samples",
    );
  assert(
    input.buffer.audioTimes.every(
      (row) =>
        Number.isSafeInteger(row.pts) && Number.isSafeInteger(row.samples),
    ),
  );
});
test("forward latest-frame skips do not reset an established continuous audio clock", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 12000, 1);
  b.beginPlayback();
  b.takeAudio(6400);
  const before = b.audioCursor;
  frame(b, 1, 0.3);
  assert.equal(
    b.audioCursor,
    before,
    "forward frame skip is not a decoder reset",
  );
  assert.equal(left(b.takeAudio(4))[0], 1601);
});
for (const [caseId, offset, gapAt, expectedMs] of [
  [0, 0, 0, 0],
  [1, 0.15, 0, 150],
  [2, -0.15, 4.5, 150],
  [3, -0.15, 4, 384],
])
  test(`original timestamp marker proof case ${caseId} retains every marker across gaps`, async (t) => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createProcessOwner } =
      await import("../../scripts/event-proof-processes.mjs");
    const { measureMediaMarkers, probe } =
      await import("../../scripts/event-capacity-media.mjs");
    const directory = await mkdtemp(join(tmpdir(), "event-marker-contract-")),
      owner = createProcessOwner();
    t.after(async () => {
      await owner.close();
      await rm(directory, { recursive: true, force: true });
    });
    const discontinuity = gapAt > 0;
    const file = join(directory, discontinuity ? "markers.mkv" : "markers.ts");
    const gap = discontinuity ? `+0.25/TB*gte(T,${gapAt})` : "";
    await owner.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=black:size=64x48:rate=30",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(lt(mod(t\\,1)\\,0.1)\\,0.65*sin(2*PI*1000*t)\\,0):s=48000",
        "-t",
        "10",
        "-vf",
        `drawbox=x=4:y=0:w=5:h=6:color=white:t=fill:enable='lt(mod(t,1),0.1)',setpts='PTS${gap}'`,
        "-af",
        `asetpts='PTS+${offset}/TB${gap}'`,
        "-fps_mode",
        "passthrough",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        discontinuity ? "pcm_s16le" : "aac",
        "-b:a",
        "160k",
        "-f",
        discontinuity ? "matroska" : "mpegts",
        file,
      ],
      { timeoutMs: 15000 },
    );
    const info = await probe(owner, file),
      start = Number(info.format.start_time) + 0.5;
    const facts = await measureMediaMarkers(owner, file, {
      width: 64,
      height: 48,
      windows: [{ identity: "a", start, end: start + 7 }],
      maxSeconds: 12,
    });
    assert.equal(facts.markerDecode.complete, true);
    assert(facts.markerCount >= 6);
    assert(
      Math.abs(facts.avDriftMs - expectedMs) < 25,
      JSON.stringify({ expected: expectedMs, actual: facts.avDriftMs }),
    );
    assert.equal(
      facts.avDriftMs <= 100,
      offset === 0,
      "known out-of-gate offsets remain rejected",
    );
  });
test("cursor beyond newly retained PCM reanchors only when the matched video is covered", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 4, 1);
  b.beginPlayback();
  b.takeAudio(16);
  b.takeAudio(32);
  frame(b, 1, 8 / 48000);
  audio(b, 1, 4 / 48000, 6, 101);
  assert.deepEqual(left(b.takeAudio(8)), [105, 106]);
  assert.equal(b.audioCursor, 10);
});
async function createMonoTimingFixture(
  owner,
  source,
  normalized = true,
  timing60 = false,
) {
  await owner.run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=black:size=854x480:rate=${timing60 ? 60 : 30}`,
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(lt(mod(t\\,1)\\,0.1)\\,0.65*sin(2*PI*1000*t)\\,0):s=44100",
      "-t",
      "16",
      "-vf",
      (timing60 ? "drawbox=x=0:y=0:w=57:h=57:color=red:t=fill," : "") +
        "drawbox=x=57:y=0:w=57:h=57:color=white:t=fill:enable='lt(mod(t,1),0.1)'",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      ...(normalized ? ["-muxdelay", "0", "-flush_packets", "1"] : []),
      "-f",
      "mpegts",
      source,
    ],
    { timeoutMs: 15000 },
  );
}
test("late decoded PCM after an empty gap is skipped without replay or growing the tail", () => {
  const b = new LatestMediaBuffer(6);
  frame(b, 0, 0);
  audio(b, 0, 0, 800, 1);
  b.beginPlayback();
  assert.deepEqual(
    left(b.takeAudio(3200)),
    Array.from({ length: 800 }, (_, i) => i + 1),
  );
  for (let i = 0; i < 10; i++)
    assert.deepEqual(left(b.takeAudio(3200)), Array(800).fill(0));
  assert.equal(b.audioCursor, 8800);
  frame(b, 1, 8800 / 48000);
  audio(b, 1, 800 / 48000, 16000, 1001);
  assert.equal(b.audioBytes, 48000);
  assert.equal(
    b.audioStartIndex,
    4800,
    "oldest late PCM was capped before playback",
  );
  assert.deepEqual(
    left(b.takeAudio(3200)),
    Array.from({ length: 800 }, (_, i) => 9001 + i),
  );
  assert.equal(b.audioCursor, 9600);
  assert.equal(
    b.audioStartIndex,
    9600,
    "late retained PCM before the cursor is skipped",
  );
  assert(b.audioBytes <= 48000);
});
test("normalized timing fixture preserves AAC packets without delayed audio PES groups", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createProcessOwner } =
    await import("../../scripts/event-proof-processes.mjs");
  const { probe } = await import("../../scripts/event-capacity-media.mjs");
  const directory = await mkdtemp(join(tmpdir(), "event-packet-contract-")),
    owner = createProcessOwner();
  t.after(async () => {
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  const results = [];
  for (const normalized of [false, true]) {
    const file = join(directory, normalized ? "normalized.ts" : "bursty.ts");
    await createMonoTimingFixture(owner, file, normalized);
    const info = await probe(owner, file),
      video = info.streams.find((s) => s.codec_type === "video"),
      audio = info.streams.find((s) => s.codec_type === "audio");
    assert.equal(video.codec_name, "h264");
    assert.equal(video.r_frame_rate, "30/1");
    assert.equal(audio.codec_name, "aac");
    assert.equal(audio.sample_rate, "44100");
    assert.equal(audio.channels, 1);
    const packets = JSON.parse(
      (
        await owner.run(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_packets",
            "-show_entries",
            "packet=stream_index,pts,dts,pos,data_hash",
            "-show_data_hash",
            "sha256",
            "-of",
            "json",
            file,
          ],
          { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024 },
        )
      ).toString(),
    ).packets;
    let videoDts;
    const groups = [],
      hashes = [[], []];
    for (const packet of packets) {
      hashes[packet.stream_index].push(packet.data_hash);
      if (packet.stream_index === 0) videoDts = Number(packet.dts);
      else if (packet.pos !== undefined)
        groups.push({
          frames: 1,
          lateMs:
            videoDts === undefined
              ? undefined
              : (videoDts - Number(packet.pts)) / 90,
        });
      else groups.at(-1).frames++;
    }
    assert.equal(hashes[0].length, 480);
    assert.equal(hashes[1].length, 691);
    assert(hashes.flat().every((hash) => /^SHA256:[a-f0-9]{64}$/.test(hash)));
    if (normalized) {
      assert(
        groups.every((group) => group.frames === 1),
        "each AAC frame must be independently available to the paced decoder",
      );
      assert(
        groups.every(
          (group) => group.lateMs === undefined || group.lateMs <= 0,
        ),
        "audio must not wait behind newer video DTS",
      );
    } else {
      assert(
        groups.some((group) => group.frames >= 10 && group.lateMs >= 200),
        "preserve the original bursty delivery counterexample",
      );
    }
    results.push(hashes);
  }
  assert.deepEqual(
    results[1],
    results[0],
    "packetization must preserve all encoded media payloads",
  );
});
test("real prewarmed 30fps mono source stays synchronized in a 60fps stereo program", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const { createProcessOwner } =
    await import("../../scripts/event-proof-processes.mjs");
  const { measureMediaMarkers, probe } =
    await import("../../scripts/event-capacity-media.mjs");
  const { createProgramRenderer } =
    await import("../../workers/restream/program-renderer.mjs");
  const { createInputSupervisor } =
    await import("../../workers/restream/input-supervisor.mjs");
  const directory = await mkdtemp(join(tmpdir(), "event-sync-contract-")),
    owner = createProcessOwner();
  let renderer;
  t.after(async () => {
    await renderer?.stop();
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  const source = join(directory, "source.ts"),
    output = join(directory, "program.ts");
  await createMonoTimingFixture(owner, source);
  const chunks = [];
  let bytes = 0,
    overflow = false;
  renderer = createProgramRenderer({
    quality: "480p60",
    createInput: (options) =>
      createInputSupervisor({
        ...options,
        spawnProcess: (...args) => owner.start(...args),
      }),
  });
  renderer.subscribe((chunk) => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) overflow = true;
    else chunks.push(chunk);
  });
  await renderer.reconcileSources([
    { slotKey: "a", sourceId: "a", revision: 1, url: source },
  ]);
  await renderer.start();
  await sleep(2000);
  assert.equal(renderer.selectSource("a"), true);
  const acknowledgementDeadline = performance.now() + 5000;
  while (
    renderer.getState().renderedSourceId !== "a" &&
    performance.now() < acknowledgementDeadline
  )
    await sleep(20);
  assert.equal(renderer.getState().renderedSourceId, "a");
  const start = renderer.getState().outputMs / 1000 + 1;
  await sleep(8000);
  assert.equal(renderer.getState().error, undefined);
  await renderer.stop();
  assert.equal(overflow, false);
  await writeFile(output, Buffer.concat(chunks));
  const info = await probe(owner, output),
    first = Number(info.format.start_time) + start;
  const facts = await measureMediaMarkers(owner, output, {
    width: 854,
    height: 480,
    windows: [{ identity: "a", start: first, end: first + 6 }],
    maxSeconds: 15,
  });
  assert(
    facts.avDriftMs <= 100,
    JSON.stringify({ avDriftMs: facts.avDriftMs }),
  );
  assert.equal(
    info.streams.find((s) => s.codec_type === "video").r_frame_rate,
    "60/1",
  );
  assert.equal(
    info.streams.find((s) => s.codec_type === "audio").sample_rate,
    "48000",
  );
  assert.equal(info.streams.find((s) => s.codec_type === "audio").channels, 2);
});

test("real buffered decoder advances source media at wall rate without a test pacing override", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { createProcessOwner } =
    await import("../../scripts/event-proof-processes.mjs");
  const { createInputSupervisor } =
    await import("../../workers/restream/input-supervisor.mjs");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const directory = await mkdtemp("/tmp/event-decoder-pacing-"),
    owner = createProcessOwner();
  let input;
  t.after(async () => {
    await input?.stop();
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  const source = `${directory}/buffered.ts`;
  await owner.run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=60",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=997:sample_rate=48000",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-b:a",
      "160k",
      "-muxdelay",
      "0",
      "-flush_packets",
      "1",
      "-f",
      "mpegts",
      source,
    ],
    { timeoutMs: 15000 },
  );
  input = createInputSupervisor({
    source: { slotKey: "a", sourceId: "a", url: source },
    quality: { width: 320, height: 180, frameRate: 30 },
    spawnProcess: (...args) => owner.start(...args),
  });
  const frames = [],
    b = input.buffer,
    publish = b.publishFrame;
  b.publishFrame = function (...args) {
    const before = this.frameCount;
    const result = Reflect.apply(publish, this, args);
    if (this.frameCount !== before)
      frames.push({ pts: this.framePts, at: performance.now() });
    return result;
  };
  input.start();
  const deadline = performance.now() + 5000;
  while (frames.length < 61 && performance.now() < deadline) await sleep(10);
  assert(frames.length >= 61, "bounded real decoder progress");
  const mediaMs = (frames[60].pts - frames[0].pts) / 90,
    wallMs = frames[60].at - frames[0].at;
  assert(
    mediaMs - wallMs <= 100,
    JSON.stringify({ mediaMs, wallMs, sourceAheadMs: mediaMs - wallMs }),
  );
  assert(b.audioBytes <= 48000);
});

for (const [name, lag, missing, carryIn] of [
  ["measured startup lag is retained", 0.130667, false, false],
  ["carry-in is explicit and full pulses align", 0, false, true],
  ["missing full pulse cannot alias next cycle", 0, true, true],
])
  test(`transition marker proof ${name}`, async () => {
    const { measureTransitionMarkers } =
      await import("../../scripts/event-capacity-media.mjs");
    const selection = {
      identity: "a",
      tick: 90,
      fps: 30,
      sourcePts: 9000,
      carryIn,
      pulses: [
        { tick: 90, sourcePts: 9000 },
        ...[1, 2, 3].map((n) => ({
          tick: 90 + n * 30,
          sourcePts: 9000 + n * 90000,
        })),
      ],
      endTick: 210,
    };
    const data = {
      selections: [selection],
      identities: [
        { identity: "slate", pts: 1 },
        { identity: "a", pts: 4 },
      ],
      visual: [4, 5, 6, 7],
      audible: [4, 5, 6, 7]
        .filter((_, i) => !(missing && i === 1))
        .map((v) => v + lag),
      videoEnd: 9,
      audioEnd: 9,
    };
    if (missing)
      assert.throws(
        () => measureTransitionMarkers(data),
        /Missing same-cycle audio/,
      );
    else {
      const result = measureTransitionMarkers(data);
      assert.equal(result[0].boundaryFragment !== null, carryIn);
      assert.equal(result[0].pairs.length, carryIn ? 3 : 4);
      const dropped = structuredClone(data);
      dropped.selections[0].sourcePulses = [99000, 189000, 279000];
      dropped.selections[0].lastSourcePts = 279000;
      dropped.selections[0].pulses.splice(1, 1);
      dropped.visual.splice(1, 1);
      assert.throws(
        () => measureTransitionMarkers(dropped),
        /Selected source pulse was not submitted/,
      );
      assert.equal(
        Math.max(
          ...result[0].pairs.map((p) => Math.abs(p.audioMinusVideoMs)),
        ) <= 100,
        lag === 0,
      );
    }
  });

test("selection observation preserves receivers and binds first source frame to submitted tick", async () => {
  const { observeSelectionMarkers } =
    await import("../../scripts/event-capacity-media.mjs");
  const b = new LatestMediaBuffer((192 * 108 * 3) / 2),
    selections = [];
  let tick = 17;
  const input = { buffer: b };
  assert.equal(
    observeSelectionMarkers(
      input,
      {
        source: { sourceId: "a", revision: 7 },
        quality: { width: 192, height: 108, frameRate: 30 },
      },
      () => tick,
      selections,
    ),
    input,
  );
  const white = Buffer.alloc((192 * 108 * 3) / 2, 235);
  b.videoTimestamp(0, 9000);
  b.video(white);
  b.videoTimestamp(1, 10500);
  b.video(white);
  audio(b, 0, 0.1, 12000, 1);
  b.beginPlayback();
  const first = b.takeAudio(6400);
  assert.equal(first.length, 6400);
  assert.equal(b.audioCursor, 5600 + 1600);
  assert.deepEqual(selections[0], {
    identity: "a",
    revision: 7,
    tick: 17,
    fps: 30,
    sourcePts: 10500,
    carryIn: true,
    pulses: [{ tick: 17, sourcePts: 10500 }],
    sourcePulses: [],
    lastSourcePts: 10500,
    endTick: 18,
  });
  tick++;
  b.takeAudio(6400);
  assert.equal(
    selections[0].pulses.length,
    1,
    "duplicate video does not invent a new pulse",
  );
  b.reset();
  assert.equal(b.frame, undefined);
});

test("real 60 to 30 startup proof binds complete pulses, PCM and submitted watermark", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { setTimeout: sleep } = await import("node:timers/promises");
  const { createProcessOwner } =
    await import("../../scripts/event-proof-processes.mjs");
  const { createInputSupervisor } =
    await import("../../workers/restream/input-supervisor.mjs");
  const { createProgramRenderer } =
    await import("../../workers/restream/program-renderer.mjs");
  const { observeSelectionMarkers, measureMediaMarkers } =
    await import("../../scripts/event-capacity-media.mjs");
  const directory = await mkdtemp("/tmp/event-startup-marker-"),
    owner = createProcessOwner(),
    selections = [],
    chunks = [];
  let renderer,
    bytes = 0,
    overflow = false,
    missingSamples = 0,
    takes = 0;
  const holes = [];
  t.after(async () => {
    await renderer?.stop();
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  const source = `${directory}/source.ts`,
    output = `${directory}/program.ts`;
  await createMonoTimingFixture(owner, source, true, true);
  renderer = createProgramRenderer({
    quality: "480p30",
    createInput: (options) => {
      const input = observeSelectionMarkers(
        createInputSupervisor({
          ...options,
          spawnProcess: (...args) => owner.start(...args),
        }),
        options,
        () => renderer.getState().ticks,
        selections,
      );
      const b = input.buffer,
        take = b.takeAudio;
      b.takeAudio = function (...args) {
        const ranges = this.audioRanges(),
          before = this.audioCursor,
          q = args[0] / 4;
        const result = Reflect.apply(take, this, args);
        const start = this.audioCursor - q;
        let covered = 0;
        for (const range of ranges)
          covered += Math.max(
            0,
            Math.min(start + q, range.end) - Math.max(start, range.start),
          );
        missingSamples += q - covered;
        takes++;
        if (covered < q && holes.length < 8)
          holes.push({
            take: takes,
            ready: input.getObservation().ready,
            framePts: this.framePts,
            cursorBefore: before,
            start,
            end: start + q,
            covered,
            requested: q,
            rawSamples: this.audioSamplesReceived,
            metadataSamples: this.audioMetadataSamples,
            ranges: ranges.map((r) => ({ start: r.start, end: r.end })),
          });
        if (before !== undefined)
          assert.equal(
            this.audioCursor,
            before + q,
            "continuous selected PCM cursor",
          );
        assert(this.audioBytes <= 48000);
        return result;
      };
      return input;
    },
  });
  renderer.subscribe((chunk) => {
    bytes += chunk.length;
    if (bytes > 16 * 1048576) overflow = true;
    else chunks.push(chunk);
  });
  await renderer.reconcileSources([
    { slotKey: "a", sourceId: "a", revision: 1, url: source },
  ]);
  await renderer.start();
  await sleep(2000);
  assert.equal(renderer.selectSource("a"), true);
  await sleep(6000);
  t.diagnostic(JSON.stringify({ takes, missingSamples, holes }));
  assert.equal(renderer.getState().error, undefined);
  await renderer.stop();
  assert.equal(overflow, false);
  assert(takes >= 170);
  await writeFile(output, Buffer.concat(chunks));
  const facts = await measureMediaMarkers(owner, output, {
    width: 854,
    height: 480,
    windows: [],
    selections,
    maxSeconds: 12,
  });
  assert.equal(facts.transitionMarkers.length, 1);
  assert(facts.markerCount >= 3);
  assert(
    facts.avDriftMs <= 100,
    JSON.stringify({ avDriftMs: facts.avDriftMs }),
  );
  assert.equal(
    missingSamples,
    0,
    JSON.stringify({
      reason: "all selected PCM intervals have actual matched coverage",
      missingSamples,
      takes,
      holes,
      avDriftMs: facts.avDriftMs,
    }),
  );
});

for (const lag of [0, 0.130667])
  test(`encoded first A and Take markers preserve all pulses with audio lag ${Math.round(lag * 1000)}ms`, async (t) => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { createProcessOwner } =
      await import("../../scripts/event-proof-processes.mjs");
    const { measureMediaMarkers } =
      await import("../../scripts/event-capacity-media.mjs");
    const directory = await mkdtemp("/tmp/event-transition-media-"),
      owner = createProcessOwner(),
      file = `${directory}/markers.ts`;
    t.after(async () => {
      await owner.close();
      await rm(directory, { recursive: true, force: true });
    });
    await owner.run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=black:size=64x48:rate=30",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=if(lt(mod(t\\,1)\\,0.1)\\,0.65*sin(2*PI*1000*t)\\,0):s=48000",
        "-t",
        "12",
        "-vf",
        "drawbox=x=0:y=0:w=4:h=6:color=red:t=fill:enable='gte(t,1)*lt(t,6)',drawbox=x=0:y=0:w=4:h=6:color=blue:t=fill:enable='gte(t,6)',drawbox=x=4:y=0:w=5:h=6:color=white:t=fill:enable='gte(t,1)*lt(mod(t,1),0.1)'",
        "-af",
        `asetpts=PTS+${lag}/TB`,
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-muxdelay",
        "0",
        "-f",
        "mpegts",
        file,
      ],
      { timeoutMs: 15000 },
    );
    const selections = [1, 6].map((second, i) => ({
      identity: i ? "b" : "a",
      revision: 1,
      tick: second * 30,
      fps: 30,
      sourcePts: 90000,
      carryIn: false,
      endTick: second * 30 + 120,
      pulses: [0, 1, 2, 3].map((n) => ({
        tick: (second + n) * 30,
        sourcePts: (1 + n) * 90000,
      })),
    }));
    const facts = await measureMediaMarkers(owner, file, {
      width: 64,
      height: 48,
      windows: [],
      selections,
      maxSeconds: 14,
    });
    assert.equal(facts.markerCount, 8);
    assert.equal(facts.transitionMarkers.length, 2);
    assert.equal(
      facts.avDriftMs <= 100,
      lag === 0,
      JSON.stringify({ lag, avDriftMs: facts.avDriftMs }),
    );
  });

function matrixEpochFixture(destinationOffset = 0) {
  const selections = [
    {
      identity: "a",
      revision: 1,
      tick: 127,
      fps: 30,
      sourcePts: 7921,
      carryIn: true,
      endTick: 247,
      pulses: [
        [127, 7921],
        [156, 93421],
        [185, 181921],
        [215, 271921],
        [245, 361921],
      ].map(([tick, sourcePts]) => ({ tick, sourcePts })),
    },
    {
      identity: "b",
      revision: 1,
      tick: 9264,
      fps: 30,
      sourcePts: 27010465,
      carryIn: false,
      endTick: 9384,
      pulses: [
        [9269, 27026965],
        [9299, 27115465],
        [9329, 27205465],
        [9359, 27295465],
      ].map(([tick, sourcePts]) => ({ tick, sourcePts })),
    },
  ];
  const add = (t) => t + destinationOffset;
  return {
    selections,
    identities: [
      { identity: "slate", pts: add(0.021333333333333333) },
      { identity: "a", pts: add(4.254666666666667) },
      { identity: "b", pts: add(308.8213333333333) },
      { identity: "slate", pts: add(319.1213333333333) },
    ],
    visual: [
      4.254666666666667, 5.221333333333333, 6.188, 7.188, 8.188, 308.988,
      309.988, 310.988, 311.988,
    ].map(add),
    audible: [
      4.255333333333334, 5.184, 6.1866666666666665, 7.188, 8.180666666666667,
      308.5113333333333, 308.98066666666665, 309.98333333333335, 310.986,
      311.9886666666667,
    ].map(add),
    videoEnd: add(324),
    audioEnd: add(324),
  };
}
for (const destination of ["program", "vrcdn"])
  test(`selection epoch replays actual matrix01 ${destination} without prior source ambiguity`, async () => {
    const { measureTransitionMarkers } =
      await import("../../scripts/event-capacity-media.mjs");
    const data = matrixEpochFixture(destination === "vrcdn" ? 1.4 : 0);
    if (destination === "vrcdn") {
      data.identities[1].pts = 5.655;
      data.identities[2].pts = 310.221;
      data.visual = [
        5.655, 6.621, 7.588, 8.588, 9.588, 310.388, 311.388, 312.388, 313.388,
      ];
      data.audible = [
        5.655333333333333, 6.584, 7.586666666666667, 8.588, 9.580666666666668,
        309.91133333333335, 310.3806666666667, 311.3833333333333, 312.386,
        313.38866666666667,
      ];
    }
    const result = measureTransitionMarkers(data);
    assert.equal(result[0].pairs.length, 4);
    assert.equal(result[1].pairs.length, 4);
    assert(
      Math.abs(result[1].pairs[0].audioMinusVideoMs + 7.3333333333) < 0.001,
    );
    assert.deepEqual(result[1].preEpochExclusions, [
      {
        audioPts: data.audible[5],
        reason: "before-selection-acceptance-bound",
      },
    ]);
    assert(
      Math.max(
        ...result.flatMap((r) =>
          r.pairs.map((p) => Math.abs(p.audioMinusVideoMs)),
        ),
      ) < 38,
    );
  });

test("selection epoch keeps missing ambiguous boundary and completeness failures strict", async () => {
  const { measureTransitionMarkers } =
    await import("../../scripts/event-capacity-media.mjs");
  const missing = matrixEpochFixture();
  missing.audible.splice(6, 1);
  assert.throws(
    () => measureTransitionMarkers(missing),
    /Missing same-cycle audio/,
  );
  const duplicate = matrixEpochFixture();
  duplicate.audible.push(308.99);
  assert.throws(
    () => measureTransitionMarkers(duplicate),
    /Ambiguous same-cycle audio/,
  );
  const truncated = matrixEpochFixture();
  truncated.audioEnd = 312;
  assert.throws(
    () => measureTransitionMarkers(truncated),
    /Truncated transition/,
  );
  const watermark = matrixEpochFixture();
  watermark.identities[2].pts += 0.2;
  assert.throws(() => measureTransitionMarkers(watermark), /program watermark/);
  for (const lag of [-0.05, -0.130667, 0.130667]) {
    const d = {
      selections: [
        {
          identity: "a",
          tick: 30,
          fps: 30,
          sourcePts: 90000,
          carryIn: false,
          endTick: 150,
          pulses: [1, 2, 3, 4].map((n) => ({
            tick: n * 30,
            sourcePts: n * 90000,
          })),
        },
      ],
      identities: [
        { identity: "slate", pts: 0 },
        { identity: "a", pts: 1 },
      ],
      visual: [1, 2, 3, 4],
      audible: [1, 2, 3, 4].map((v) => v + lag),
      videoEnd: 6,
      audioEnd: 6,
    };
    if (lag < -0.1)
      assert.throws(
        () => measureTransitionMarkers(d),
        /Missing same-cycle audio/,
      );
    else {
      const result = measureTransitionMarkers(d);
      assert.equal(
        Math.max(
          ...result[0].pairs.map((p) => Math.abs(p.audioMinusVideoMs)),
        ) <= 100,
        lag === -0.05,
      );
    }
  }
});

test("encoded phase shifted A and B audio remain bound to the actual selection epoch", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { createProcessOwner } =
    await import("../../scripts/event-proof-processes.mjs");
  const { measureMediaMarkers } =
    await import("../../scripts/event-capacity-media.mjs");
  const directory = await mkdtemp("/tmp/event-epoch-media-"),
    owner = createProcessOwner(),
    file = `${directory}/markers.ts`;
  t.after(async () => {
    await owner.close();
    await rm(directory, { recursive: true, force: true });
  });
  await owner.run(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=64x48:rate=30",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(if(lt(t\\,6)\\,lt(mod(t+0.3\\,1)\\,0.1)\\,lt(mod(t-1/6\\,1)\\,0.1))\\,0.65*sin(2*PI*1000*t)\\,0):s=48000",
      "-t",
      "12",
      "-vf",
      "drawbox=x=0:y=0:w=4:h=6:color=red:t=fill:enable='gte(t,1)*lt(t,6)',drawbox=x=0:y=0:w=4:h=6:color=blue:t=fill:enable='gte(t,6)',drawbox=x=4:y=0:w=5:h=6:color=white:t=fill:enable='gte(t,1)*if(lt(t,6),lt(mod(t+0.3,1),0.1),lt(mod(t-1/6,1),0.1))'",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-muxdelay",
      "0",
      "-f",
      "mpegts",
      file,
    ],
    { timeoutMs: 15000 },
  );
  const selections = [
    {
      identity: "a",
      revision: 1,
      tick: 30,
      fps: 30,
      sourcePts: 90000,
      carryIn: false,
      endTick: 150,
      pulses: [51, 81, 111, 141].map((tick) => ({
        tick,
        sourcePts: tick * 3000,
      })),
    },
    {
      identity: "b",
      revision: 1,
      tick: 180,
      fps: 30,
      sourcePts: 540000,
      carryIn: false,
      endTick: 300,
      pulses: [185, 215, 245, 275].map((tick) => ({
        tick,
        sourcePts: tick * 3000,
      })),
    },
  ];
  const facts = await measureMediaMarkers(owner, file, {
    width: 64,
    height: 48,
    windows: [],
    selections,
    maxSeconds: 14,
  });
  assert.equal(facts.markerCount, 8);
  assert(
    facts.avDriftMs <= 100,
    JSON.stringify({ avDriftMs: facts.avDriftMs }),
  );
  assert.equal(facts.transitionMarkers[1].preEpochExclusions.length, 1);
  const excluded = facts.transitionMarkers[1].preEpochExclusions[0].audioPts;
  assert(excluded < facts.transitionMarkers[1].start - 0.1);
  assert(
    Math.abs(excluded - facts.transitionMarkers[1].pairs[0].videoPts) < 0.5,
    "prior source would have caused the original ambiguity",
  );
});
