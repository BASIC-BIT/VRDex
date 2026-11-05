import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceDescriptor } from "../src/contracts";
import { source, harness, output, flush } from "./registry-fixture";
test("scratch exhaustion before an attempt starts drains admission", async () => {
  let starts = 0;
  let otherSignal: AbortSignal | undefined;
  const bravo = parseSourceDescriptor({ ...source, streamId: "Bravo", streamKey: "vrcdn/Bravo/1" });
  const h = harness({
    packager: async (options) => {
      starts++;
      if (options.source.streamKey === source.streamKey)
        throw Object.assign(new Error("scratch full"), {
          failure: { kind: "pressure", message: "scratch full" },
        });
      otherSignal = options.signal;
      return { async stop() {} };
    },
  });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    await h.tick(5000);
    assert.equal(starts, 2);
    assert(otherSignal?.aborted);
    assert(h.observations.at(-1)?.jobs.some((job) => job.state === "unavailable"));
  } finally {
    await h.registry.stop();
  }
});
test("scratch pressure fences every active job and prevents new admission", async () => {
  const h = harness();
  const bravo = parseSourceDescriptor({ ...source, streamId: "Bravo", streamKey: "vrcdn/Bravo/1" });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    h.attempts[0]?.onFailure({ kind: "pressure", message: "scratch full" });
    await h.tick(1000);
    assert(h.attempts.every((attempt) => attempt.signal.aborted));
    assert.equal(h.stopped.length, 2);
    await h.tick(5000);
    assert.equal(h.attempts.length, 2);
  } finally {
    await h.registry.stop();
  }
});
test("pressure fences siblings and drains admission while physical cleanup is pending", async () => {
  const bravo = parseSourceDescriptor({ ...source, streamId: "Bravo", streamKey: "vrcdn/Bravo/1" });
  const charlie = parseSourceDescriptor({ ...source, streamId: "Charlie", streamKey: "vrcdn/Charlie/1" });
  const events: string[] = [];
  const h = harness({
    binding: {
      workerId: "one", workerEpoch: 1,
      allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "test-proof-1" },
      maxSources: 3, draining: false,
    },
    packager: async (options) => {
      h.attempts.push(options);
      return { stop: () => new Promise<void>(() => {}) };
    },
    metrics: (event) => events.push(event.kind),
    limits: { cleanupTimeoutMs: 20 },
  });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    h.attempts[0]?.onFailure({ kind: "pressure", message: "scratch full" });
    assert(h.attempts.every((attempt) => attempt.signal.aborted));
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
      { source: charlie, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    assert(events.includes("scratch_pressure"));
  } finally {
    await h.registry.stop();
  }
});
test("quota failure during an already-aborted cleanup drains sibling jobs", async () => {
  const bravo = parseSourceDescriptor({ ...source, streamId: "Bravo", streamKey: "vrcdn/Bravo/1" });
  const charlie = parseSourceDescriptor({ ...source, streamId: "Charlie", streamKey: "vrcdn/Charlie/1" });
  const events: string[] = [];
  const h = harness({
    binding: {
      workerId: "one", workerEpoch: 1,
      allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "test-proof-1" },
      maxSources: 3, draining: false,
    },
    packager: async (options) => {
      h.attempts.push(options);
      return { async stop() {
        if (options.source.streamKey === source.streamKey)
          throw Object.assign(Error("quota exceeded"), { code: "EDQUOT" });
      } };
    },
    metrics: (event) => events.push(event.kind),
  });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    h.setSources([
      { source, admissionRevision: 0, state: "draining" },
      { source: bravo, admissionRevision: 0, state: "queued" },
      { source: charlie, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick(1000);
    assert(h.attempts[0]?.signal.aborted);
    assert(h.attempts[1]?.signal.aborted);
    assert.equal(h.attempts.length, 2);
    assert(events.includes("scratch_pressure"));
  } finally {
    await h.registry.stop();
  }
});
test("typed scratch pressure from pending setup after abort still drains siblings", async () => {
  const bravo = parseSourceDescriptor({ ...source, streamId: "Bravo", streamKey: "vrcdn/Bravo/1" });
  const charlie = parseSourceDescriptor({ ...source, streamId: "Charlie", streamKey: "vrcdn/Charlie/1" });
  let releaseSetup: (() => void) | undefined;
  const pendingSetup = new Promise<void>((resolve) => { releaseSetup = resolve; });
  const events: string[] = [];
  const h = harness({
    binding: {
      workerId: "one", workerEpoch: 1,
      allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "test-proof-1" },
      maxSources: 3, draining: false,
    },
    packager: async (options) => {
      h.attempts.push(options);
      if (options.source.streamKey === source.streamKey) {
        await pendingSetup;
        throw Object.assign(Error("scratch full during setup"), {
          failure: { kind: "pressure", message: "scratch full during setup" },
        });
      }
      return { async stop() {} };
    },
    metrics: (event) => events.push(event.kind),
  });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    h.setSources([
      { source, admissionRevision: 0, state: "draining" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick(1000);
    assert(h.attempts[0]?.signal.aborted);
    releaseSetup?.();
    await flush();
    assert(h.attempts[1]?.signal.aborted);
    h.setSources([
      { source, admissionRevision: 0, state: "draining" },
      { source: bravo, admissionRevision: 0, state: "queued" },
      { source: charlie, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
    assert.equal(h.registry.diagnostics().activeJobs, 2);
    assert.equal(events.filter((kind) => kind === "scratch_pressure").length, 1);
  } finally {
    releaseSetup?.();
    await h.registry.stop();
  }
});
test("duplicate admitted grants share one job; drain retains valid work but denies new sources", async () => {
  const h = harness();
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 1);
    h.registry.drain();
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      {
        source: {
          ...source,
          streamId: "Bravo",
          streamKey: parseSourceDescriptor({
            ...source,
            streamId: "Bravo",
            streamKey: "vrcdn/Bravo/1",
          }).streamKey,
        },
        admissionRevision: 0,
        state: "queued",
      },
    ]);
    await h.tick(10000);
    assert.equal(h.attempts.length, 1);
    assert(!h.attempts[0]?.signal.aborted);
  } finally {
    await h.registry.stop();
  }
});
test("source crash is isolated and recovery resumes after cleanup with increasing continuity", async () => {
  const h = harness();
  const bravo = parseSourceDescriptor({
    ...source,
    streamId: "Bravo",
    streamKey: "vrcdn/Bravo/1",
  });
  try {
    h.setSources([
      { source, admissionRevision: 0, state: "queued" },
      { source: bravo, admissionRevision: 0, state: "queued" },
    ]);
    await h.tick();
    await h.tick(1000);
    const first = h.attempts[0];
    assert(first);
    await output(first, h.now());
    await output(first, h.now(), 0, "audio");
    first.onFailure({ kind: "source", message: "gone" });
    await flush();
    await h.tick(1000);
    assert.equal(h.attempts.length, 3);
    assert.equal(h.attempts[2]?.continuity?.video.nextSequence, 1);
    assert.equal(h.attempts[1]?.signal.aborted, false);
  } finally {
    await h.registry.stop();
  }
});
test("stalled renewal and resource sampling cannot postpone authority loss or cleanup", async () => {
  const h = harness({ readCounters: () => new Promise(() => {}) });
  try {
    await h.tick();
    await h.tick(1000);
    const attempt = h.attempts[0];
    assert(attempt);
    h.control.renew = () => new Promise(() => {});
    await h.tick(10000);
    await h.tick(20000);
    assert(attempt.signal.aborted);
    assert(h.stopped.length > 0);
    assert.equal(h.observations.at(-1)?.resources, null);
  } finally {
    await h.registry.stop();
  }
});
test("demand health outage denies new jobs", async () => {
  const h = harness({
    demand: {
      async read() {
        return { healthy: false, activity: [] };
      },
    },
  });
  try {
    await h.tick();
    await h.tick(1000);
    assert.equal(h.attempts.length, 0);
  } finally {
    await h.registry.stop();
  }
});

test("watchdog independently fences during stalled teardown and renewal without a reconcile call", async () => {
  let entered = 0;
  let active: import("../src/worker/packager").PackagerOptions | undefined;
  const h = harness({
    packager: async (options) => {
      active = options;
      return {
        stop: async () => {
          entered++;
          await new Promise(() => {});
        },
      };
    },
    limits: { cleanupTimeoutMs: 20, operationTimeoutMs: 5000 },
  });
  try {
    await h.tick();
    await h.tick(1000);
    h.control.renew = () => new Promise(() => {});
    await h.tick(10000);
    await h.tick(18000);
    assert(active);
    await output(active, h.now());
    await output(active, h.now(), 0, "audio");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(entered, 0);
    h.advance(1000);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(entered, 1);
    const before = Date.now();
    await h.registry.stop();
    assert(Date.now() - before < 500);
  } finally {
    await h.registry.stop();
  }
});

test("explicit higher admission revision can restart a terminal source but repeated native demand cannot", async () => {
  const h = harness();
  try {
    await h.tick();
    await h.tick(1000);
    const first = h.attempts[0];
    assert(first);
    first.onFailure({ kind: "unsupported", message: "codec" });
    await h.tick(1000);
    await h.tick(1000);
    assert.equal(h.attempts.length, 1);
    h.setSources([{ source, state: "queued", admissionRevision: 1 }]);
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
  } finally {
    await h.registry.stop();
  }
});

test("idle source stops after native demand grace despite continuing fresh media", async () => {
  const h = harness({
    demand: {
      async read() {
        return { healthy: true, activity: [] };
      },
    },
  });
  try {
    await h.tick();
    await h.tick(1000);
    const a = h.attempts[0];
    assert(a);
    for (let n = 0; n < 36; n++) {
      await output(a, h.now(), n, "video", 3);
      await output(a, h.now(), n, "audio", 3);
      await h.tick(5000);
    }
    assert(a.signal.aborted);
    assert(h.observations.at(-1)?.jobs.some((j) => j.state === "stopped"));
  } finally {
    await h.registry.stop();
  }
});

import { startRelayWorker } from "../src/worker/main";
test("bootable runtime starts registration and admitted work, and removes its signal handlers on stop", async () => {
  const h = harness();
  await h.registry.stop();
  const before = process.listenerCount("SIGTERM");
  const runtime = startRelayWorker(h.options);
  try {
    await flush();
    assert.equal(h.attempts.length, 1);
    assert.equal(process.listenerCount("SIGTERM"), before + 1);
  } finally {
    await runtime.stop();
  }
  assert.equal(process.listenerCount("SIGTERM"), before);
});

test("a restarted packager retains an immutable continuity baseline as more output is published", async () => {
  const h = harness();
  try {
    await h.tick();
    await h.tick(1000);
    const first = h.attempts[0];
    assert(first);
    await output(first, h.now());
    await output(first, h.now(), 0, "audio");
    first.onFailure({ kind: "source", message: "gone" });
    await flush();
    await h.tick(1000);
    const second = h.attempts[1];
    assert(second);
    await output(second, h.now(), 1);
    assert.equal(second.continuity?.video.nextSequence, 1);
  } finally {
    await h.registry.stop();
  }
});

test("a losing claim does not permanently consume a local job slot", async () => {
  const h = harness();
  const claim = h.control.claim;
  let calls = 0;
  h.control.claim = async (...args) => {
    if (++calls === 1) throw Error("already leased");
    return claim(...args);
  };
  try {
    await h.tick();
    assert.equal(h.attempts.length, 0);
    await h.tick(1000);
    assert.equal(h.attempts.length, 1);
  } finally {
    await h.registry.stop();
  }
});

test("retirement uses a bounded ten-minute cutoff and never blocks admission", async () => {
  const calls: { before: number; limit: number }[] = [];
  const h = harness();
  h.storage.retire = async ({ before, limit }) => {
    calls.push({ before, limit });
    await new Promise(() => {});
  };
  try {
    await h.tick();
    await h.tick(60000);
    assert.deepEqual(calls, [{ before: -500000, limit: 1000 }]);
    assert.equal(h.attempts.length, 1);
  } finally {
    await h.registry.stop();
  }
});

test("a terminal source now owned elsewhere frees its local slot after cleanup", async () => {
  const h = harness({
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
  });
  try {
    await h.tick();
    const first = h.attempts[0];
    assert(first);
    h.control.observe = async () => {
      throw Error("newer owner");
    };
    first.onFailure({ kind: "unsupported", message: "codec" });
    h.setSources([]);
    await h.tick(1000);
    const bravo = parseSourceDescriptor({
      ...source,
      streamId: "Bravo",
      streamKey: "vrcdn/Bravo/1",
    });
    h.setSources([{ source: bravo, state: "queued", admissionRevision: 0 }]);
    await h.tick(1000);
    assert.equal(h.attempts.length, 2);
  } finally {
    await h.registry.stop();
  }
});

test("unsupported packager failure preserves an explicit terminal reason in control observation", async () => {
  const h = harness();
  let reason: unknown;
  h.control.observe = async (args) => {
    reason = Reflect.get(args, "terminalReason");
  };
  try {
    await h.tick();
    const a = h.attempts[0];
    assert(a);
    a.onFailure({ kind: "unsupported", message: "codec" });
    await flush(); // Terminal lease surrender follows physical stop settlement.
    await h.tick(1000);
    assert.equal(reason, "unsupported");
    assert.equal(h.attempts.length, 1);
  } finally {
    await h.registry.stop();
  }
});

test("disappearing terminal job retains its slot while an observation ignores cancellation", async () => {
  const h = harness({
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
    limits: { operationTimeoutMs: 20 },
  });
  let release = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pendingObservations = 0;
  let firstSignal: AbortSignal | undefined;
  h.control.observe = async ({ signal }) => {
    if (firstSignal) return;
    firstSignal = signal;
    pendingObservations++;
    try {
      await blocked;
    } finally {
      pendingObservations--;
    }
  };
  try {
    await h.tick();
    await h.tick(1000);
    assert.equal(pendingObservations, 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(firstSignal?.aborted, true);
    const first = h.attempts[0];
    assert(first);
    first.onFailure({ kind: "unsupported", message: "codec" });
    await flush();
    const bravo = parseSourceDescriptor({
      ...source,
      streamId: "Bravo",
      streamKey: "vrcdn/Bravo/1",
    });
    h.setSources([{ source: bravo, state: "queued", admissionRevision: 0 }]);
    for (let i = 0; i < 3; i++) {
      await h.tick(1000);
      assert.equal(
        h.attempts.length,
        1,
        "pending observation must retain the only job slot",
      );
      assert.equal(pendingObservations, 1);
    }
    release();
    await flush();
    await h.tick(1000);
    await h.tick(1000);
    assert.equal(pendingObservations, 0);
    assert.equal(
      h.attempts.length,
      2,
      "settled observation permits replacement admission",
    );
    assert.equal(h.attempts[1]?.source.streamKey, bravo.streamKey);
  } finally {
    release();
    await flush();
    await h.registry.stop();
  }
});
