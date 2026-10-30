import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat, readdir, writeFile, mkdir, mkdtemp, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { type RenditionSnapshot } from "../src/contracts";
import {
  createPackager,
  type PackagerFailure,
  type PackagerContinuity,
} from "../src/worker/packager";
import { source, fixture, until } from "./packager-fixture";
const run = promisify(execFile);
test("source metadata naming a full disk does not drain a healthy packager", { timeout: 20000 }, async () => {
  const f = await fixture("libx264", null, false, "No space left on device");
  const snapshots: RenditionSnapshot[] = [];
  const failures: PackagerFailure[] = [];
  let handle: Awaited<ReturnType<typeof f.start>> | undefined;
  try {
    handle = await f.start({
      source, epoch: 1, directory: f.directory,
      signal: new AbortController().signal,
      onSnapshot(snapshot) { snapshots.push(snapshot); },
      onFailure(failure) { failures.push(failure); },
    });
    await until(() => snapshots.some((snapshot) => snapshot.rendition === "video") || failures.length > 0);
    assert.deepEqual(failures, []);
    assert(snapshots.some((snapshot) => snapshot.rendition === "video"));
  } finally {
    await handle?.stop();
    await f.close();
  }
});
test("scratch pressure reports failure while physical cleanup remains pending", { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-pressure-cleanup-"));
  const wrapper = join(directory, "ffmpeg-sleeper");
  await writeFile(wrapper, "#!/bin/sh\nexec sleep 30\n");
  await chmod(wrapper, 0o700);
  let releaseDispose: (() => void) | undefined;
  const pendingDispose = new Promise<void>((resolve) => { releaseDispose = resolve; });
  const failures: PackagerFailure[] = [];
  const start = createPackager({
    ffmpegPath: wrapper,
    createRelay: async () => ({
      createInput: () => ({
        transportReady: Promise.resolve({ url: "http://127.0.0.1:1" }),
        dispose: () => pendingDispose,
      }),
      stop() {},
    }) as never,
  });
  let handle: Awaited<ReturnType<typeof start>> | undefined;
  try {
    handle = await start({
      source, epoch: 1, directory, signal: new AbortController().signal,
      scratchLimitBytes: 512 * 1024,
      onSnapshot() { assert.fail("no media should publish"); },
      onFailure(failure) { failures.push(failure); },
    });
    const attempt = (await readdir(directory)).find((name) => name.startsWith("attempt-"));
    assert(attempt);
    await writeFile(join(directory, attempt, "unfinished.ts.tmp"), Buffer.alloc(1024 * 1024));
    await until(() => failures.length === 1);
    assert.equal(failures[0]?.kind, "pressure");
  } finally {
    releaseDispose?.();
    await handle?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
test(
  "scratch pressure from an unfinished segment fences publication and reaps acquisition",
  { timeout: 20000 },
  async () => {
    const f = await fixture();
    const failures: PackagerFailure[] = [];
    let published = 0;
    let handle: Awaited<ReturnType<typeof f.start>> | undefined;
    try {
      handle = await f.start({
        source,
        epoch: 1,
        directory: f.directory,
        signal: new AbortController().signal,
        scratchLimitBytes: 4 * 1024 * 1024,
        scratchRoot: f.directory,
        onSnapshot: () => { published++; return new Promise<void>(() => {}); },
        onFailure: (failure) => { failures.push(failure); },
      });
      await until(() => published === 1);
      assert.equal(f.counts().active, 1);
      const attempt = (await readdir(f.directory)).find((name) => name.startsWith("attempt-"));
      assert(attempt);
      const otherAttempt = join(f.directory, "other-source", "attempt-2-incomplete");
      await mkdir(otherAttempt, { recursive: true });
      await writeFile(join(otherAttempt, "video-999.ts.tmp"), Buffer.alloc(8 * 1024 * 1024));
      await until(() => failures.length === 1);
      assert.equal(failures[0]?.kind, "pressure");
      assert.equal(published, 1);
      assert.equal(f.counts().active, 0);
      assert.deepEqual((await readdir(f.directory)).sort(), ["input.mp4", "other-source"]);
    } finally {
      await handle?.stop();
      await f.close();
    }
  },
);
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

test("malformed untyped continuity rejects before creating resources", async () => {
  let acquired = 0;
  const start = createPackager({
    createRelay: async () => {
      acquired++;
      throw Error("resource created");
    },
  });
  for (const continuity of [
    {},
    { video: { nextSequence: 0, discontinuitySequence: 0 } },
    { video: {}, audio: {} },
    {
      video: { nextSequence: 0, discontinuitySequence: 0, extra: 1 },
      audio: { nextSequence: 0, discontinuitySequence: 0 },
    },
  ]) {
    await assert.rejects(
      start({
        source,
        epoch: 1,
        directory: "/tmp/vrdex-invalid-continuity",
        signal: new AbortController().signal,
        continuity: continuity as PackagerContinuity,
        onSnapshot() {},
        onFailure() {},
      }),
      /continuity/i,
    );
  }
  assert.equal(acquired, 0);
});
