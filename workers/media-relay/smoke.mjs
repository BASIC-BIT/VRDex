import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  stat,
  readFile,
  readdir,
  rm,
  writeFile,
  chmod,
} from "node:fs/promises";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import {
  WORKER_SCRATCH_DIRECTORY,
  startRelayWorker,
  createPackager,
  createSourceRelay,
} from "/app/worker.mjs";
const scratch = await stat(WORKER_SCRATCH_DIRECTORY);
assert.equal(process.getuid(), 1000, "fixture must use the image node user");
assert.equal(
  scratch.uid,
  process.getuid(),
  "volume ownership must be initialized by the image",
);
assert.equal(
  scratch.mode & 0o777,
  0o750,
  "volume must retain image permissions",
);
const run = promisify(execFile),
  directory = await mkdtemp(`${WORKER_SCRATCH_DIRECTORY}/relay-image-`);
let worker, server;
const objects = new Map(),
  snapshots = [],
  observations = [];
let active = 0,
  maximum = 0;
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await delay(50);
  assert(fn(), "bounded fixture condition");
}
try {
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
      "24",
      "-c:v",
      "libx264",
      "-g",
      "20",
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",
      `${directory}/input.mp4`,
    ],
    { timeout: 15000 },
  );
  const data = await readFile(`${directory}/input.mp4`);
  server = createServer((_req, res) => {
    active++;
    maximum = Math.max(maximum, active);
    let offset = 0;
    res.writeHead(200, { "Content-Type": "video/mp4" });
    const timer = setInterval(() => {
      res.write(data.subarray(offset, offset + 4096));
      offset += 4096;
      if (offset >= data.length) clearInterval(timer);
    }, 30);
    res.once("close", () => {
      active--;
      clearInterval(timer);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const wrapper = `${directory}/ffmpeg-owned`;
  await writeFile(
    wrapper,
    `#!/bin/sh\nprintf '%s\\n' "$$" >> '${directory}/children'\nexec ffmpeg "$@"\n`,
  );
  await chmod(wrapper, 0o700);
  const packager = createPackager({
    ffmpegPath: wrapper,
    createRelay: () =>
      createSourceRelay({
        inputFormat: "vrcdn_fmp4",
        resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
        requestSource: (_url, _options, cb) =>
          request(`http://127.0.0.1:${port}`, cb),
      }),
  });
  let sources = ["Alpha", "Bravo"].map((streamId) => ({
    source: {
      streamId,
      streamKey: `vrcdn/${streamId}/1`,
      inputFormat: "vrcdn_fmp4",
      packagingVersion: 1,
    },
    state: "queued",
    admissionRevision: 0,
  }));
  worker = startRelayWorker({
    directory,
    binding: {
      workerId: "local-image",
      workerEpoch: 1,
      allocation: {
        cpuUnits: 1024,
        memoryMiB: 2048,
        evidenceId: "synthetic-image-only",
      },
      maxSources: 2,
      draining: false,
    },
    packager: (options) =>
      packager({
        ...options,
        onFailure(failure) {
          process.stderr.write(
            JSON.stringify({ fixtureFailure: failure }) + "\n",
          );
          options.onFailure(failure);
        },
      }),
    metrics: (event) => process.stderr.write(JSON.stringify(event) + "\n"),
    control: {
      async register(o) {
        observations.push(o);
      },
      async list() {
        return sources;
      },
      async claim(s) {
        return {
          streamKey: s.streamKey,
          workerId: "local-image",
          epoch: 1,
          serverNow: Date.now(),
          expiresAt: Date.now() + 30000,
          renewAfterMs: 10000,
        };
      },
      async renew(l) {
        return { ...l, serverNow: Date.now(), expiresAt: Date.now() + 30000 };
      },
      async read() {
        return { recoveryStartedAt: Date.now() };
      },
      async observe() {},
      async commitSnapshot({ snapshot, isCurrent, signal }) {
        signal.throwIfAborted();
        assert(isCurrent());
        for (const s of snapshot.segments) assert(objects.has(s.objectKey));
        snapshots.push(snapshot);
      },
    },
    storage: {
      async putSegment({ objectKey, filePath, signal }) {
        signal.throwIfAborted();
        objects.set(objectKey, await readFile(filePath));
      },
      async putSnapshot({ objectKey, snapshot }) {
        objects.set(objectKey, Buffer.from(JSON.stringify(snapshot)));
      },
      async retire() {},
    },
    demand: {
      async read() {
        return {
          healthy: true,
          activity: sources.map(({ source }) => ({
            streamKey: source.streamKey,
            lastActivityAt: Date.now(),
          })),
        };
      },
    },
  });
  await until(
    () =>
      new Set(snapshots.map((s) => s.streamKey + "/" + s.rendition)).size === 4,
  );
  await until(() =>
    observations.some(
      (o) => o.activeJobs === 2 && o.resources.sampleSequence > 0,
    ),
  );
  assert.equal(maximum, 2);
  assert(observations.every((o) => o.activeJobs <= 2));
  const before = snapshots.length;
  worker.drain();
  sources.push({
    source: {
      streamId: "Charlie",
      streamKey: "vrcdn/Charlie/1",
      inputFormat: "vrcdn_fmp4",
      packagingVersion: 1,
    },
    state: "queued",
    admissionRevision: 0,
  });
  await until(() => snapshots.length > before);
  assert(!snapshots.some((s) => s.streamKey.includes("Charlie")));
  const pids = (await readFile(`${directory}/children`, "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  process.kill(pids[0], "SIGKILL");
  await until(() =>
    snapshots.some(
      (s) =>
        s.streamKey === "vrcdn/Alpha/1" &&
        s.segments.some((x) => x.discontinuity),
    ),
  );
  process.kill(process.pid, "SIGTERM");
  await worker.stop();
  await until(() => active === 0);
  const allPids = (await readFile(`${directory}/children`, "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  for (const pid of allPids) assert.throws(() => process.kill(pid, 0));
  assert.equal(
    (await readdir(directory)).filter((p) => p.startsWith("attempt-")).length,
    0,
  );
  process.stdout.write(
    JSON.stringify({
      proof: "actual-image",
      scratch: {
        path: WORKER_SCRATCH_DIRECTORY,
        uid: scratch.uid,
        mode: (scratch.mode & 0o777).toString(8),
      },
      maximumSources: maximum,
      committedSnapshots: snapshots.length,
      objects: objects.size,
      allocation: observations[0].allocation,
      resources: observations.at(-1).resources,
      drain: true,
      term: true,
      killedChild: true,
      reapedChildren: allPids.length,
    }) + "\n",
  );
} finally {
  await worker?.stop();
  server?.closeAllConnections();
  if (server) await new Promise((r) => server.close(r));
  await rm(directory, { recursive: true, force: true });
}
