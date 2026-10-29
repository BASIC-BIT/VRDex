import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemand, dynamoDemandUpdate } from "../src/gateway/demand";
import { streamKeyFor } from "../src/contracts";
const streamKey = streamKeyFor("Alpha");
test("coalesces concurrent native observations at ten seconds and retains monotonic time", async () => {
  let now = 100000,
    writes = 0;
  const rows = new Map<string, number>();
  const demand = createDemand({
    clock: () => now,
    store: {
      async checkHealth() {},
      async updateMax({ streamKey, at }: { streamKey: string; at: number }) {
        writes++;
        rows.set(streamKey, Math.max(rows.get(streamKey) ?? 0, at));
      },
      async read(streamKey: string) {
        return rows.get(streamKey) ?? null;
      },
    },
  });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      demand.recordDemand({ streamKey, at: now }),
    ),
  );
  assert.equal(writes, 1);
  now = 109999;
  await demand.recordDemand({ streamKey, at: now });
  assert.equal(writes, 1);
  now = 110000;
  await demand.recordDemand({ streamKey, at: now });
  assert.equal(writes, 2);
  await demand.recordDemand({ streamKey, at: 100000 });
  assert.equal(await demand.lastDemand(streamKey), 110000);
  now = 290000;
  assert.deepEqual(
    await demand.read({
      streamKeys: [streamKey],
      signal: new AbortController().signal,
    }),
    { healthy: true, activity: [{ streamKey, lastActivityAt: 110000 }] },
  );
  assert.equal(writes, 2); // reads/segments never sustain a lost Close
});
test("demand outage reports unhealthy, preserves last observation and bounds physical writes/maps", async () => {
  let fail = false,
    now = 100000;
  const demand = createDemand({
    clock: () => now,
    maxEntries: 1,
    store: {
      async checkHealth() {
        if (fail) throw Error("offline");
      },
      async updateMax() {
        if (fail) throw Error("offline");
      },
      async read() {
        if (fail) throw Error("offline");
        return 100000;
      },
    },
  });
  await demand.recordDemand({ streamKey, at: now });
  fail = true;
  now = 110000;
  await assert.rejects(demand.recordDemand({ streamKey, at: now }));
  assert.deepEqual(
    await demand.read({
      streamKeys: [streamKey],
      signal: new AbortController().signal,
    }),
    { healthy: false, activity: [] },
  );
  await assert.rejects(
    demand.recordDemand({ streamKey: streamKeyFor("Beta"), at: now }),
  );
});
test("DynamoDB write contract uses conditional max-time update without ownership mutation", () => {
  const update = dynamoDemandUpdate({
    tableName: "demand",
    streamKey,
    at: 100000,
  });
  assert.deepEqual(update, {
    TableName: "demand",
    Key: { streamKey },
    UpdateExpression: "SET lastActivityAt = :at",
    ConditionExpression:
      "attribute_not_exists(lastActivityAt) OR lastActivityAt < :at",
    ExpressionAttributeValues: { ":at": 100000 },
  });
});

test("empty demand scan probes health so an unavailable store cannot admit unaccounted work", async () => {
  const demand = createDemand({
    clock: () => 100000,
    store: {
      async checkHealth() {
        throw Error("offline");
      },
      async updateMax() {},
      async read() {
        return null;
      },
    },
  });
  assert.deepEqual(
    await demand.read({ streamKeys: [], signal: new AbortController().signal }),
    { healthy: false, activity: [] },
  );
});

test("noncooperative write retains bounded slot until physical settlement", async () => {
  let finish!: () => void;
  const blocked = new Promise<void>((r) => (finish = r));
  const demand = createDemand({
    clock: () => 100000,
    maxConcurrent: 1,
    store: {
      async checkHealth() {},
      async updateMax() {
        await blocked;
      },
      async read() {
        return null;
      },
    },
  });
  const pending = demand.recordDemand({ streamKey, at: 100000 });
  await assert.rejects(
    demand.recordDemand({ streamKey: streamKeyFor("Beta"), at: 100000 }),
  );
  assert.deepEqual(
    await demand.read({ streamKeys: [], signal: new AbortController().signal }),
    { healthy: false, activity: [] },
  );
  finish();
  await pending;
  assert.deepEqual(
    await demand.read({ streamKeys: [], signal: new AbortController().signal }),
    { healthy: true, activity: [] },
  );
});

test("concurrent empty scans share one physical health probe", async () => {
  let finish!: () => void;
  let probes = 0;
  const blocked = new Promise<void>((r) => (finish = r));
  const demand = createDemand({
    clock: () => 100000,
    maxConcurrent: 1,
    store: {
      async checkHealth() {
        probes++;
        await blocked;
      },
      async updateMax() {},
      async read() {
        return null;
      },
    },
  });
  const scans = Array.from({ length: 20 }, () =>
    demand.read({ streamKeys: [], signal: new AbortController().signal }),
  );
  finish();
  const results = await Promise.all(scans);
  assert.equal(probes, 1);
  assert.ok(results.every((result) => result.healthy));
});

import { harness, output } from "./registry-fixture";
import { parseSourceDescriptor } from "../src/contracts";
test("real demand adapter outage keeps existing jobs only through bounded idle grace and denies new starts", async () => {
  let offline = false;
  const rows = new Map<string, number>();
  const demand = createDemand({
    clock: () => h.now(),
    store: {
      async checkHealth() {
        if (offline) throw Error("offline");
      },
      async updateMax({ streamKey, at }) {
        rows.set(streamKey, Math.max(rows.get(streamKey) ?? 0, at));
      },
      async read(key) {
        if (offline) throw Error("offline");
        return rows.get(key) ?? null;
      },
    },
  });
  const h = harness({ demand });
  try {
    await demand.recordDemand({ streamKey, at: h.now() });
    await h.tick();
    await h.tick(1000);
    const attempt = h.attempts[0];
    assert.ok(attempt);
    offline = true;
    h.setSources([
      { source: attempt.source, admissionRevision: 0, state: "queued" },
      {
        source: parseSourceDescriptor({
          streamKey: "vrcdn/Beta/1",
          streamId: "Beta",
          inputFormat: "vrcdn_fmp4",
          packagingVersion: 1,
        }),
        admissionRevision: 0,
        state: "queued",
      },
    ]);
    for (let i = 0; i < 36; i++) {
      await output(attempt, h.now(), i, "video", 3);
      await output(attempt, h.now(), i, "audio", 3);
      await h.tick(5000);
      if (i < 35) assert.equal(attempt.signal.aborted, false);
    }
    assert.equal(attempt.signal.aborted, true);
    assert.equal(h.attempts.length, 1);
    assert.ok(
      h.observations.at(-1)?.jobs.some((job) => job.state === "stopped"),
    );
  } finally {
    await h.registry.stop();
  }
});
