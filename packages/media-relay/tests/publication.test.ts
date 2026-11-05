import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPublisher,
  type PublicationCommit,
  type RelayStorage,
} from "../src/worker/publisher";
import {
  OwnershipLeaseSchema,
  RenditionSnapshotSchema,
} from "../src/contracts";
export const lease = OwnershipLeaseSchema.parse({
  streamKey: "vrcdn/Alpha/1",
  workerId: "one",
  epoch: 1,
  serverNow: 100000,
  expiresAt: 130000,
  renewAfterMs: 10000,
});
export const snapshot = (sequence = 0) =>
  RenditionSnapshotSchema.parse({
    streamKey: lease.streamKey,
    epoch: 1,
    rendition: "video",
    targetDurationSeconds: 2,
    sequence,
    discontinuitySequence: 0,
    generatedAt: 100000,
    segments: [
      {
        sequence,
        objectKey: `attempt-1-abc/video-${sequence}.ts`,
        durationSeconds: 2,
        programDateTime: 100000,
        discontinuity: false,
      },
    ],
  });
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export function memoryStorage(): RelayStorage & {
  snapshots: ReturnType<typeof snapshot>[];
  uploads: string[];
  commitSnapshot: PublicationCommit;
} {
  const snapshots: ReturnType<typeof snapshot>[] = [];
  const uploads: string[] = [];
  return {
    snapshots,
    uploads,
    async putSegment({ objectKey, signal }) {
      signal.throwIfAborted();
      uploads.push(objectKey);
    },
    async commitSnapshot({ snapshot: s, isCurrent, signal }) {
      signal.throwIfAborted();
      if (!isCurrent()) throw Error("fenced");
      snapshots.push(s);
    },
    async putSnapshot() {},
    async retire() {},
  };
}
test("uploads finish before snapshot visibility and namespace keys by epoch", async () => {
  const storage = memoryStorage(),
    gate = deferred();
  const put = storage.putSegment;
  storage.putSegment = async (args) => {
    await gate.promise;
    await put(args);
  };
  const pub = createPublisher({
    storage,
    commitSnapshot: (args) => storage.commitSnapshot(args),
    isCurrent: () => true,
    limits: { maxPending: 2, operationTimeoutMs: 1000 },
  });
  const result = pub.publishSnapshot({
    lease,
    snapshot: snapshot(),
    segments: { directory: "/tmp" },
    signal: new AbortController().signal,
  });
  await Promise.resolve();
  assert.equal(storage.snapshots.length, 0);
  gate.resolve();
  await result;
  assert.equal(storage.snapshots.length, 1);
  assert.equal(
    storage.snapshots[0]?.segments[0]?.objectKey,
    "vrcdn/Alpha/1/epochs/1/attempt-1-abc/video-0.ts",
  );
});
test("blocked upload queue is bounded and cancellation prevents a late commit", async () => {
  const storage = memoryStorage(),
    gate = deferred();
  storage.putSegment = () => gate.promise;
  const abort = new AbortController();
  let current = true;
  const pub = createPublisher({
    storage,
    commitSnapshot: (args) => storage.commitSnapshot(args),
    isCurrent: () => current,
    limits: { maxPending: 1, operationTimeoutMs: 1000 },
  });
  const pending = pub.publishSnapshot({
    lease,
    snapshot: snapshot(),
    segments: { directory: "/tmp" },
    signal: abort.signal,
  });
  await assert.rejects(
    pub.publishSnapshot({
      lease,
      snapshot: snapshot(1),
      segments: { directory: "/tmp" },
      signal: abort.signal,
    }),
    /queue/i,
  );
  current = false;
  abort.abort();
  await assert.rejects(pending);
  gate.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(storage.snapshots.length, 0);
});
test("rejects out of order snapshots and obsolete epoch before storage", async () => {
  const storage = memoryStorage();
  let current = true;
  const pub = createPublisher({
    storage,
    commitSnapshot: (args) => storage.commitSnapshot(args),
    isCurrent: () => current,
  });
  const args = {
    lease,
    segments: { directory: "/tmp" },
    signal: new AbortController().signal,
  };
  await pub.publishSnapshot({ ...args, snapshot: snapshot(2) });
  await assert.rejects(
    pub.publishSnapshot({ ...args, snapshot: snapshot(1) }),
    /order/i,
  );
  current = false;
  await assert.rejects(pub.publishSnapshot({ ...args, snapshot: snapshot(3) }));
  assert.equal(storage.snapshots.length, 1);
});
test("stalled snapshot commit blocks later writes even after timeout", async () => {
  const storage = memoryStorage(),
    gate = deferred();
  storage.commitSnapshot = () => gate.promise;
  const pub = createPublisher({
    storage,
    commitSnapshot: (args) => storage.commitSnapshot(args),
    isCurrent: () => true,
    limits: { maxPending: 1, operationTimeoutMs: 10 },
  });
  const args = {
    lease,
    segments: { directory: "/tmp" },
    signal: new AbortController().signal,
  };
  await assert.rejects(
    pub.publishSnapshot({ ...args, snapshot: snapshot() }),
    /timed out/i,
  );
  await assert.rejects(
    pub.publishSnapshot({ ...args, snapshot: snapshot(1) }),
    /queue/i,
  );
  gate.resolve();
});
test("diagnostics retain timed-out physical queue slots until settlement", async () => {
  const blocked = deferred();
  const storage = memoryStorage();
  storage.putSegment = () => blocked.promise;
  const publisher = createPublisher({
    storage,
    commitSnapshot: storage.commitSnapshot,
    isCurrent: () => true,
    limits: { maxPending: 2, operationTimeoutMs: 10 },
  });
  const first = publisher.publishSnapshot({
    lease,
    snapshot: snapshot(),
    segments: { directory: "/tmp" },
    signal: new AbortController().signal,
  });
  await assert.rejects(first, /timed out/);
  assert.equal(publisher.pendingCount(), 1);
  blocked.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(publisher.pendingCount(), 0);
});
