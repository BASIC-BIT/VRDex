import assert from "node:assert/strict";
import { test } from "node:test";
import { areRenditionsPlayable } from "../src/policy";
import { harness, output } from "./registry-fixture";
test("thirty seconds without fresh output becomes terminal despite native demand; terminal does not restart", async () => {
  const h = harness();
  try {
    await h.tick();
    await h.tick(1000);
    const a = h.attempts[0];
    assert(a);
    await output(a, h.now(), 0, "video", 3);
    await output(a, h.now(), 0, "audio", 3);
    await h.tick(10000);
    assert(h.observations.at(-1)?.jobs.some((j) => j.state === "recovering"));
    await h.tick(10000);
    await h.tick(10000);
    assert(h.observations.at(-1)?.jobs.some((j) => j.state === "unavailable"));
    const count = h.attempts.length;
    await h.tick(10000);
    assert.equal(h.attempts.length, count);
  } finally {
    await h.registry.stop();
  }
});
test("fresh output keeps a healthy source alive beyond thirty seconds", async () => {
  const h = harness();
  try {
    await h.tick();
    await h.tick(1000);
    const a = h.attempts[0];
    assert(a);
    for (let n = 0; n < 8; n++) {
      await output(a, h.now(), n, "video", 3);
      await output(a, h.now(), n, "audio", 3);
      await h.tick(5000);
    }
    assert(!a.signal.aborted);
    assert.equal(h.attempts.length, 1);
  } finally {
    await h.registry.stop();
  }
});

import { fixture, source, until } from "./packager-fixture";
import { createRelayRegistry, type RelayControl } from "../src/worker/registry";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RenditionSnapshot } from "../src/contracts";

test(
  "real media registry recovers disconnected upstream, missing objects and killed child, then bounds a stalled upload and cleans up",
  { timeout: 30000 },
  async () => {
    const f = await fixture("libx264", null, true);
    const snapshots: RenditionSnapshot[] = [],
      objects = new Map<string, Buffer>();
    let failUpload = false,
      stalled = false,
      blocked = false,
      release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const states: string[] = [];
    const control: RelayControl = {
      async register() {},
      async list() {
        return [{ source, admissionRevision: 0, state: "queued" }];
      },
      async claim() {
        return {
          streamKey: source.streamKey,
          workerId: "one",
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
      async observe({ state }) {
        states.push(state);
      },
      async commitSnapshot({ snapshot, isCurrent, signal }) {
        signal.throwIfAborted();
        assert(isCurrent());
        for (const segment of snapshot.segments)
          assert(objects.has(segment.objectKey));
        snapshots.push(snapshot);
      },
    };
    const registry = createRelayRegistry({
      control,
      storage: {
        async putSegment({ objectKey, filePath, signal }) {
          signal.throwIfAborted();
          if (failUpload) {
            failUpload = false;
            throw Error("missing object");
          }
          if (stalled) {
            blocked = true;
            await gate;
            signal.throwIfAborted();
          }
          objects.set(objectKey, await readFile(filePath));
        },
        async putSnapshot() {},
        async retire() {},
      },
      binding: {
        workerId: "one",
        workerEpoch: 1,
        allocation: {
          cpuUnits: 1024,
          memoryMiB: 2048,
          evidenceId: "test-proof-1",
        },
        maxSources: 1,
        draining: false,
      },
      directory: f.directory,
      demand: {
        async read() {
          return {
            healthy: true,
            activity: [
              { streamKey: source.streamKey, lastActivityAt: Date.now() },
            ],
          };
        },
      },
      packager: f.start,
      limits: { retryDelayMs: 100, operationTimeoutMs: 1000, maxAttempts: 2 },
    });
    const latest = () =>
      snapshots.filter((s) => s.rendition === "video").at(-1);
    const playable = () => areRenditionsPlayable({video:latest(),audio:snapshots.filter(s=>s.rendition==="audio").at(-1)}, Date.now(), 1);
    try {
      registry.reconcile();
      await until(playable);
      const first = latest();
      assert(first);
      f.disconnect();
      await until(
        () =>
          Boolean(latest()?.segments.some((s) => s.discontinuity)) &&
          f.counts().acquisitions >= 2,
      );
      await until(playable);
      const second = latest();
      assert(second);
      assert(second.sequence > (first.segments.at(-1)?.sequence ?? -1));
      assert(second.generatedAt >= first.generatedAt);
      failUpload = true;
      const acquisitions = f.counts().acquisitions;
      await until(() => f.counts().acquisitions > acquisitions);
      await until(
        () =>
          latest()?.segments[0]?.objectKey.split("/").at(-2) !==
          second.segments[0]?.objectKey.split("/").at(-2),
      );
      await until(playable);
      process.kill(await f.childPid(), "SIGKILL");
      const before = latest();
      assert(before);
      await until(() =>
        Boolean(latest() && latest()!.generatedAt > before.generatedAt),
      );
      assert.equal(f.counts().maximum, 1);
      assert(Date.now() - (latest()?.generatedAt ?? 0) < 10000);
      stalled = true;
      await until(() => blocked);
      const committedBeforeStall = snapshots.length;
      await until(() => states.includes("unavailable"));
      assert.equal(snapshots.length, committedBeforeStall);
      assert.equal(f.counts().maximum, 1);
      await registry.stop();
      release();
      await until(() => f.counts().active === 0);
      assert.equal(snapshots.length, committedBeforeStall);
      assert.deepEqual(await readdir(join(f.directory, source.streamId)), []);
    } finally {
      release();
      await registry.stop();
      await f.close();
    }
  },
);

test("fresh partial windows cannot reset the thirty-second playable recovery deadline", async () => {
  const h = harness();
  try {
    await h.tick(); await h.tick(1000);
    const attempt = h.attempts[0]; assert(attempt);
    for (let n=0;n<6;n++) {
      await output(attempt,h.now(),n,"video");
      await output(attempt,h.now(),n,"audio");
      await h.tick(5000);
    }
    assert(attempt.signal.aborted);
    assert(h.observations.at(-1)?.jobs.some(j=>j.state==="unavailable"));
  } finally { await h.registry.stop(); }
});
