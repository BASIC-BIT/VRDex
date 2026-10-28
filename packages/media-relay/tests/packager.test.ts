import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createSourceRelay } from "../../../workers/restream/source-relay.mjs";
import {
  parseSourceDescriptor,
  type RenditionSnapshot,
} from "../src/contracts";
import {
  createPackager,
  type PackagerFailure,
  type PackagerContinuity,
} from "../src/worker/packager";
const run = promisify(execFile);
const source = parseSourceDescriptor({
  streamKey: "vrcdn/DJ_Case/1",
  streamId: "DJ_Case",
  inputFormat: "vrcdn_fmp4",
  packagingVersion: 1,
});
async function fixture(
  codec = "libx264",
  broken: "partial" | "timestamps" | "playlist" | null = null,
) {
  const directory = await mkdtemp(join(tmpdir(), "vrdex-packager-"));
  const input = join(directory, "input.mp4");
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=128x72:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "22",
      "-c:v",
      codec,
      "-g",
      "50",
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      input,
    ],
    { timeout: 15000 },
  );
  const original = await readFile(input);
  let data =
    broken === "partial"
      ? original.subarray(0, 2000)
      : broken === "timestamps"
        ? Buffer.concat([original, original])
        : original;
  let acquisitions = 0,
    active = 0,
    maximum = 0;
  const provider = createServer((_req, res) => {
    acquisitions++;
    if (_req.url === "/nested.ts") {
      res.writeHead(403).end();
      return;
    }
    active++;
    maximum = Math.max(active, maximum);
    res.once("close", () => active--);
    res.writeHead(200, { "Content-Type": "video/mp4" });
    let offset = 0;
    const timer = setInterval(() => {
      res.write(data.subarray(offset, offset + 4096));
      offset += 4096;
      if (offset >= data.length) {
        clearInterval(timer);
        if (broken === "partial" || broken === "playlist") res.end();
      }
    }, 30);
    res.once("close", () => clearInterval(timer));
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  assert(address && typeof address !== "string");
  if (broken === "playlist")
    data = Buffer.from(`#EXTM3U
#EXT-X-TARGETDURATION:2
#EXTINF:2,
http://127.0.0.1:${address.port}/nested.ts
#EXT-X-ENDLIST
`);
  const start = createPackager({
    createRelay: () =>
      createSourceRelay({
        inputFormat: "vrcdn_fmp4",
        resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
        requestSource: (
          url: URL,
          _options: unknown,
          cb: (res: IncomingMessage) => void,
        ) => {
          assert.equal(
            url.href,
            "https://stream.vrcdn.live/live/DJ_Case.live.mp4",
          );
          return request(`http://127.0.0.1:${address.port}`, cb);
        },
      }),
  });
  return {
    directory,
    start,
    counts: () => ({ acquisitions, active, maximum }),
    async close() {
      provider.closeAllConnections();
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 150 && !condition(); i++) await delay(50);
  assert(condition(), "expected condition within 7.5 seconds");
}
async function probe(path: string) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type",
      "-of",
      "json",
      path,
    ],
    { timeout: 5000 },
  );
  return JSON.parse(stdout).streams as {
    codec_name: string;
    codec_type: string;
  }[];
}
test(
  "one acquired MP4 yields advancing complete decodable video and genuinely audio-only HLS with truthful late-keyframe durations",
  { timeout: 25000 },
  async () => {
    const f = await fixture();
    const snapshots: RenditionSnapshot[] = [],
      failures: PackagerFailure[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
        onFailure: (failure) => {
          failures.push(failure);
        },
      });
      await until(
        () =>
          snapshots.some(
            (s) => s.rendition === "video" && s.segments.length >= 3,
          ) && snapshots.some((s) => s.rendition === "audio" && s.sequence > 0),
      );
      assert.deepEqual(failures, []);
      assert.equal(f.counts().acquisitions, 1);
      await delay(150);
      const latestAudio = snapshots
        .filter((s) => s.rendition === "audio")
        .at(-1);
      assert(latestAudio?.segments[0]);
      const attemptName = latestAudio.segments[0].objectKey.split("/")[0];
      assert(attemptName);
      const attemptFiles = await readdir(join(f.directory, attemptName));
      assert(
        !attemptFiles.includes("audio-0.ts"),
        "obsolete completed segments are pruned after publication",
      );
      for (const rendition of ["video", "audio"]) {
        const snapshot = snapshots
          .filter((s) => s.rendition === rendition)
          .at(-1);
        assert(snapshot);
        assert(snapshot.segments.length > 1);
        assert(
          snapshot.targetDurationSeconds >=
            Math.max(...snapshot.segments.map((s) => s.durationSeconds)),
        );
        if (rendition === "video") assert(snapshot.targetDurationSeconds >= 5);
        for (const segment of snapshot.segments) {
          assert(!segment.objectKey.endsWith(".tmp"));
          assert((await stat(join(f.directory, segment.objectKey))).size > 0);
        }
        const segment = snapshot.segments.at(-1);
        assert(segment);
        const streams = await probe(join(f.directory, segment.objectKey));
        assert.deepEqual(
          streams.map((s) => s.codec_name).sort(),
          rendition === "audio" ? ["aac"] : ["aac", "h264"],
        );
        const decoded = await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            join(f.directory, segment.objectKey),
            "-f",
            "null",
            "-",
          ],
          { timeout: 5000 },
        );
        assert.equal(
          decoded.stderr,
          "",
          "completed segments decode without media errors",
        );
        const playlist = await readFile(
          join(
            f.directory,
            segment.objectKey.replace(/[^/]+$/, `${rendition}.m3u8`),
          ),
          "utf8",
        );
        assert(!playlist.includes("#EXT-X-INDEPENDENT-SEGMENTS"));
      }
      await handle.stop();
      await handle.stop();
      await until(() => f.counts().active === 0);
      assert.deepEqual((await readdir(f.directory)).sort(), ["input.mp4"]);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
test(
  "restart continuity retains increasing media and discontinuity sequence without overwriting objects",
  { timeout: 25000 },
  async () => {
    const f = await fixture();
    const snapshots: RenditionSnapshot[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      const args = {
        source,
        epoch: 7,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: (snapshot: RenditionSnapshot) => {
          snapshots.push(snapshot);
        },
        onFailure: (failure: PackagerFailure) => {
          assert.fail(failure.message);
        },
      };
      handle = await f.start(args);
      await until(() => snapshots.some((s) => s.rendition === "video"));
      const last = (rendition: "video" | "audio") => {
        const value = snapshots.filter((s) => s.rendition === rendition).at(-1);
        assert(value);
        return value;
      };
      await until(() => snapshots.some((s) => s.rendition === "audio"));
      const previous = { video: last("video"), audio: last("audio") };
      await handle.stop();
      await until(() => f.counts().active === 0);
      const continuity: PackagerContinuity = {
        video: { nextSequence: 100, discontinuitySequence: 3 },
        audio: { nextSequence: 200, discontinuitySequence: 4 },
      };
      snapshots.length = 0;
      handle = await f.start({ ...args, continuity });
      await until(
        () =>
          snapshots.some((s) => s.rendition === "video") &&
          snapshots.some((s) => s.rendition === "audio"),
      );
      for (const rendition of ["video", "audio"] as const) {
        const first = snapshots.find((s) => s.rendition === rendition);
        assert(first);
        assert.equal(
          first.segments[0]?.sequence,
          continuity[rendition].nextSequence,
        );
        assert.equal(first.segments[0]?.discontinuity, true);
        assert.equal(
          first.discontinuitySequence,
          continuity[rendition].discontinuitySequence,
        );
        assert(
          !previous[rendition].segments.some((old) =>
            first.segments.some((next) => next.objectKey === old.objectKey),
          ),
        );
      }
      await until(() => last("audio").sequence > 200);
      assert.equal(last("audio").discontinuitySequence, 5);
      assert(last("audio").segments.every((segment) => !segment.discontinuity));
      assert.equal(f.counts().acquisitions, 2);
      assert.equal(f.counts().maximum, 1);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
test(
  "unsupported video codec yields explicit unsupported failure without publishing or transcoding",
  { timeout: 20000 },
  async () => {
    const f = await fixture("mpeg4");
    const snapshots: RenditionSnapshot[] = [],
      failures: PackagerFailure[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: (s) => {
          snapshots.push(s);
        },
        onFailure: (f) => {
          failures.push(f);
        },
      });
      await until(() => failures.length > 0);
      assert.equal(failures[0]?.kind, "unsupported");
      assert.equal(failures.length, 1);
      assert.deepEqual(snapshots, []);
      await until(() => f.counts().active === 0);
      assert.equal(f.counts().acquisitions, 1);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);

test(
  "a partial input fragment never becomes published media and failed acquisition is closed once",
  { timeout: 15000 },
  async () => {
    const f = await fixture("libx264", "partial");
    const snapshots: RenditionSnapshot[] = [],
      failures: PackagerFailure[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: (s) => {
          snapshots.push(s);
        },
        onFailure: (f) => {
          failures.push(f);
        },
      });
      await until(() => failures.length > 0);
      assert.deepEqual(snapshots, []);
      assert.equal(failures.length, 1);
      assert.equal(f.counts().active, 0);
      assert.equal(f.counts().acquisitions, 1);
      assert.deepEqual((await readdir(f.directory)).sort(), ["input.mp4"]);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
test(
  "timestamp resets fail explicitly instead of hiding nonmonotonic DTS warnings",
  { timeout: 15000 },
  async () => {
    const f = await fixture("libx264", "timestamps");
    const failures: PackagerFailure[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: () => {},
        onFailure: (f) => {
          failures.push(f);
        },
      });
      await until(() => failures.length > 0);
      assert.equal(failures[0]?.kind, "timestamp");
      assert.equal(failures.length, 1);
      assert.equal(f.counts().active, 0);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
test(
  "abort closes the active acquisition and removes only this attempt directory",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const abort = new AbortController(),
      failures: PackagerFailure[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: abort.signal,
        onSnapshot: () => {},
        onFailure: (f) => {
          failures.push(f);
        },
      });
      await until(() => f.counts().active === 1);
      abort.abort();
      await handle.stop();
      await until(() => f.counts().active === 0);
      assert.deepEqual(failures, []);
      assert.deepEqual((await readdir(f.directory)).sort(), ["input.mp4"]);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
test(
  "stop fences and detaches a blocked publisher callback without waiting forever",
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    const abort = new AbortController();
    let entered = false,
      released = () => {};
    let callbackSignal: AbortSignal | undefined;
    const blocked = new Promise<void>((resolve) => {
      released = resolve;
    });
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: abort.signal,
        onSnapshot: async (_snapshot, signal) => {
          entered = true;
          callbackSignal = signal;
          await blocked;
        },
        onFailure: (failure) => {
          assert.fail(failure.message);
        },
      });
      await until(() => entered);
      abort.abort();
      const completed = await Promise.race([
        handle.stop().then(() => true),
        delay(1500).then(() => false),
      ]);
      assert.equal(
        completed,
        true,
        "stop must not wait for external publication",
      );
      assert.equal(callbackSignal?.aborted, true);
      await until(() => f.counts().active === 0);
      assert.deepEqual((await readdir(f.directory)).sort(), ["input.mp4"]);
    } finally {
      released();
      await handle?.stop();
      await f.close();
    }
  },
);

test(
  "MP4 content type cannot smuggle a nested playlist into a second unguarded acquisition",
  { timeout: 15000 },
  async () => {
    const f = await fixture("libx264", "playlist");
    const failures: PackagerFailure[] = [],
      snapshots: RenditionSnapshot[] = [];
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        onSnapshot: (s) => {
          snapshots.push(s);
        },
        onFailure: (f) => {
          failures.push(f);
        },
      });
      await until(() => failures.length > 0);
      assert.equal(
        f.counts().acquisitions,
        1,
        "decoder must not follow the disguised playlist URL",
      );
      assert.deepEqual(snapshots, []);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
