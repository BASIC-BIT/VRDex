import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { OwnershipLeaseSchema } from "../../packages/media-relay/src";
const schema =
  (
    schemaModule as unknown as {
      default?: typeof schemaModule;
    }
  ).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/mediaRelayWorker.ts": () =>
    import("../../convex/mediaRelayWorker"),
};
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`mediaRelayWorker:${name}`);
const allocation = {
  cpuUnits: 1024,
  memoryMiB: 2048,
  evidenceId: "test-proof-1",
};
const observation = (workerId = "one", workerEpoch = 1) => ({
  workerId,
  workerEpoch,
  observedAt: Date.now(),
  allocation,
  activeJobs: 0,
  resources: null,
  jobs: [],
});
async function fixture() {
  process.env.MEDIA_RELAY_ENABLED = "true";
  process.env.MEDIA_RELAY_WORKER_TOKEN = "relay-test-credential";
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify(
    ["one", "two"].map((workerId) => ({
      workerId,
      workerEpoch: 1,
      allocation,
      maxSources: 2,
      draining: false,
    })),
  );
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    for (const streamId of ["Alpha", "Bravo", "Charlie"])
      await ctx.db.insert("mediaRelaySources", {
        streamKey: `vrcdn/${streamId}/1`,
        streamId,
        inputFormat: "vrcdn_fmp4",
        packagingVersion: 1,
        state: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
  });
  const call = (name: string, args: Record<string, unknown>) =>
    t.mutation(ref(name), { credential: "relay-test-credential", ...args });
  for (const workerId of ["one", "two"])
    await call("registerWorker", { observation: observation(workerId) });
  const claim = (workerId: string, streamId = "Alpha") =>
    call("claimSource", {
      workerId,
      workerEpoch: 1,
      streamKey: `vrcdn/${streamId}/1`,
    });
  return { t, call, claim };
}
it("racing claims have one owner; takeover fences old observations and increments epoch", async () => {
  for (let run = 0; run < 5; run++) {
    const h = await fixture();
    const results = await Promise.allSettled([h.claim("one"), h.claim("two")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const winner = results.find((r) => r.status === "fulfilled");
    assert.ok(winner?.status === "fulfilled");
    const lease = OwnershipLeaseSchema.parse(winner.value);
    assert.equal(lease.expiresAt - lease.serverNow, 30000);
    assert.equal(lease.renewAfterMs, 10000);
    const loser = lease.workerId === "one" ? "two" : "one";
    await assert.rejects(h.claim(loser));
    await h.t.run(async (ctx) => {
      const row = await ctx.db
        .query("mediaRelaySources")
        .withIndex("by_streamKey", (q) => q.eq("streamKey", lease.streamKey))
        .unique();
      assert.ok(row);
      await ctx.db.patch(row._id, { leaseExpiresAt: Date.now() });
    });
    const next = OwnershipLeaseSchema.parse(await h.claim(loser));
    assert.equal(next.epoch, lease.epoch + 1);
    await assert.rejects(
      h.call("observeSource", {
        workerId: lease.workerId,
        workerEpoch: 1,
        streamKey: lease.streamKey,
        epoch: lease.epoch,
        state: "ready",
        progressAt: Date.now(),
      }),
    );
    await assert.rejects(
      h.call("renewSource", {
        workerId: lease.workerId,
        workerEpoch: 1,
        streamKey: lease.streamKey,
        epoch: lease.epoch,
      }),
    );
  }
});
it("trusted allocation and credentials fail closed; stale registration cannot replace identity", async () => {
  const h = await fixture();
  await assert.rejects(
    h.call("registerWorker", {
      observation: {
        ...observation(),
        allocation: { ...allocation, cpuUnits: 8192 },
      },
    }),
  );
  await assert.rejects(
    h.call("registerWorker", { observation: observation("one", 2) }),
  );
  await assert.rejects(
    h.call("claimSource", {
      credential: "event-bridge-token",
      workerId: "one",
      workerEpoch: 1,
      streamKey: "vrcdn/Alpha/1",
    }),
  );
  delete process.env.MEDIA_RELAY_WORKERS;
  await assert.rejects(h.claim("one"));
});
it("capacity and drain protect existing jobs; a failed source does not revoke its sibling", async () => {
  const h = await fixture();
  const first = OwnershipLeaseSchema.parse(await h.claim("one"));
  const second = OwnershipLeaseSchema.parse(await h.claim("one", "Bravo"));
  await assert.rejects(h.claim("one", "Charlie"));
  await h.call("observeSource", {
    workerId: "one",
    workerEpoch: 1,
    streamKey: first.streamKey,
    epoch: first.epoch,
    state: "unavailable",
    progressAt: Date.now(),
  });
  await assert.rejects(
    h.call("renewSource", {
      workerId: "one",
      workerEpoch: 1,
      streamKey: first.streamKey,
      epoch: first.epoch,
    }),
  );
  const renewed = OwnershipLeaseSchema.parse(
    await h.call("renewSource", {
      workerId: "one",
      workerEpoch: 1,
      streamKey: second.streamKey,
      epoch: second.epoch,
    }),
  );
  assert.equal(renewed.epoch, second.epoch);
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "one",
      workerEpoch: 1,
      allocation,
      maxSources: 2,
      draining: true,
    },
  ]);
  await assert.rejects(h.claim("one", "Charlie"));
  assert.equal(
    OwnershipLeaseSchema.parse(
      await h.call("renewSource", {
        workerId: "one",
        workerEpoch: 1,
        streamKey: second.streamKey,
        epoch: second.epoch,
      }),
    ).epoch,
    second.epoch,
  );
  await h.call("releaseSource", {
    workerId: "one",
    workerEpoch: 1,
    streamKey: second.streamKey,
    epoch: second.epoch,
  });
});
it("worker restart rejects old registration and ownership; release permits strictly newer session epoch", async () => {
  const h = await fixture();
  const first = OwnershipLeaseSchema.parse(await h.claim("one"));
  await h.call("releaseSource", {
    workerId: "one",
    workerEpoch: 1,
    streamKey: first.streamKey,
    epoch: first.epoch,
  });
  const second = OwnershipLeaseSchema.parse(await h.claim("one"));
  assert.equal(second.epoch, 2);
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "one",
      workerEpoch: 2,
      allocation,
      maxSources: 2,
      draining: false,
    },
  ]);
  await h.call("registerWorker", { observation: observation("one", 2) });
  await assert.rejects(
    h.call("registerWorker", { observation: observation("one", 1) }),
  );
  await assert.rejects(
    h.call("renewSource", {
      workerId: "one",
      workerEpoch: 2,
      streamKey: second.streamKey,
      epoch: second.epoch,
    }),
  );
  await assert.rejects(h.claim("one"));
});
it("stale progress cannot overwrite current state, and terminal jobs relinquish ownership", async () => {
  const h = await fixture();
  const first = OwnershipLeaseSchema.parse(await h.claim("one"));
  const args = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: first.streamKey,
    epoch: first.epoch,
  };
  const progressAt = Date.now();
  await h.call("observeSource", { ...args, state: "ready", progressAt });
  await assert.rejects(
    h.call("observeSource", {
      ...args,
      state: "recovering",
      progressAt: progressAt - 1,
    }),
  );
  await h.call("observeSource", { ...args, state: "stopped", progressAt });
  await assert.rejects(
    h.call("observeSource", { ...args, state: "ready", progressAt }),
  );
  await assert.rejects(h.claim("one"));
});
it("racing placement into the final worker slot admits only one additional source", async () => {
  const h = await fixture();
  await h.claim("one");
  const results = await Promise.allSettled([
    h.claim("one", "Bravo"),
    h.claim("one", "Charlie"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
});
it("lease expiry is exclusive and an expired owner cannot renew or release", async (test) => {
  let now = 100000;
  test.mock.method(Date, "now", () => now);
  const h = await fixture();
  const granted = OwnershipLeaseSchema.parse(await h.claim("one"));
  const args = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: granted.streamKey,
    epoch: granted.epoch,
  };
  now = 129999;
  await assert.rejects(h.claim("two"));
  now = 130000;
  await assert.rejects(h.call("renewSource", args));
  await assert.rejects(h.call("releaseSource", args));
  assert.equal(OwnershipLeaseSchema.parse(await h.claim("two")).epoch, 2);
});

it("publication is transactional with ownership and monotonic output, and takeover preserves continuity", async (test) => {
  let now = 100000;
  test.mock.method(Date, "now", () => now);
  const h = await fixture();
  const l = OwnershipLeaseSchema.parse(await h.claim("one"));
  const args = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: l.streamKey,
    epoch: l.epoch,
  };
  const snapshot = {
    streamKey: l.streamKey,
    epoch: 1,
    rendition: "video",
    targetDurationSeconds: 2,
    sequence: 4,
    discontinuitySequence: 2,
    generatedAt: now,
    segments: [
      {
        sequence: 4,
        objectKey: "vrcdn/Alpha/1/epochs/1/attempt-1-abc/video-4.ts",
        durationSeconds: 2,
        programDateTime: now,
        discontinuity: true,
      },
    ],
  };
  await h.call("commitSnapshot", {
    ...args,
    snapshot,
    objectKey: "vrcdn/Alpha/1/epochs/1/snapshots/video-4.json",
  });
  await assert.rejects(
    h.call("commitSnapshot", {
      ...args,
      snapshot,
      objectKey: "vrcdn/Alpha/1/epochs/1/snapshots/video-4.json",
    }),
  );
  await assert.rejects(
    h.call("commitSnapshot", {
      ...args,
      snapshot: { ...snapshot, generatedAt: now - 20000 },
      objectKey: "bad",
    }),
  );
  await h.call("commitSnapshot", {
    ...args,
    snapshot: {
      ...snapshot,
      rendition: "audio",
      segments: [
        {
          ...snapshot.segments[0],
          objectKey: "vrcdn/Alpha/1/epochs/1/attempt-1-abc/audio-4.ts",
        },
      ],
    },
    objectKey: "vrcdn/Alpha/1/epochs/1/snapshots/audio-4.json",
  });
  now = 130000;
  const next = OwnershipLeaseSchema.parse(await h.claim("two"));
  await assert.rejects(
    h.call("commitSnapshot", {
      ...args,
      snapshot,
      objectKey: "vrcdn/Alpha/1/epochs/1/snapshots/video-4.json",
    }),
  );
  const session = await h.call("readSource", {
    workerId: "two",
    workerEpoch: 1,
    streamKey: l.streamKey,
    epoch: next.epoch,
  });
  assert.equal(session.continuity.video.nextSequence, 5);
  assert.equal(session.continuity.video.discontinuitySequence, 3);
  assert.equal(session.progressAt, 100000);
  assert.equal(session.recoveryStartedAt, 100000);
});
it("service discovery is bounded, rejects browser credentials and omits terminal/unowned active sources", async () => {
  const h = await fixture();
  await h.claim("one");
  const args = { workerId: "two", workerEpoch: 1 };
  const list = await h.call("listSources", args);
  assert.equal(list.length, 2);
  assert(
    !list.some(
      (r: { source: { streamId: string } }) => r.source.streamId === "Alpha",
    ),
  );
  await assert.rejects(
    h.call("listSources", { ...args, credential: "browser" }),
  );
});

it("expired exact-owner cleanup acknowledges only terminal state without advancing progress", async (test) => {
  let now = 100000;
  test.mock.method(Date, "now", () => now);
  const h = await fixture();
  const l = OwnershipLeaseSchema.parse(await h.claim("one"));
  const args = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: l.streamKey,
    epoch: l.epoch,
  };
  await h.call("observeSource", {
    ...args,
    state: "ready",
    progressAt: 100000,
  });
  now = 130000;
  await assert.rejects(
    h.call("observeSource", { ...args, state: "ready", progressAt: 130000 }),
  );
  await assert.rejects(
    h.call("observeSource", {
      ...args,
      state: "unavailable",
      progressAt: 130000,
    }),
  );
  await h.call("observeSource", {
    ...args,
    state: "unavailable",
    progressAt: 100000,
    terminalReason: "unsupported",
  });
  const rows = await h.t.run((ctx) =>
    ctx.db.query("mediaRelaySources").collect(),
  );
  const row = rows.find((r) => r.streamKey === l.streamKey);
  assert.equal(row?.progressAt, 100000);
  assert.equal(row?.state, "unavailable");
  assert.equal(row?.terminalReason, "unsupported");
  assert.equal(row?.owner, undefined);
});
it("expired cleanup racing takeover cannot overwrite a newer owner", async (test) => {
  let now = 100000;
  test.mock.method(Date, "now", () => now);
  const h = await fixture();
  const l = OwnershipLeaseSchema.parse(await h.claim("one"));
  now = 130000;
  const cleanup = {
    workerId: "one",
    workerEpoch: 1,
    streamKey: l.streamKey,
    epoch: l.epoch,
    state: "unavailable",
    progressAt: 0,
  };
  const results = await Promise.allSettled([
    h.claim("two"),
    h.call("observeSource", cleanup),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const rows = await h.t.run((ctx) =>
    ctx.db.query("mediaRelaySources").collect(),
  );
  const row = rows.find((r) => r.streamKey === l.streamKey);
  assert(row);
  if (row.owner) {
    assert.equal(row.owner.workerId, "two");
    assert.equal(row.epoch, 2);
    await assert.rejects(h.call("observeSource", cleanup));
  } else assert.equal(row.state, "unavailable");
});

it("bounded discovery skips live leases without starving a later expired source", async () => {
  const h = await fixture();
  await h.claim("one", "Alpha");
  await h.claim("one", "Bravo");
  await h.t.run(async (ctx) => {
    for (const row of await ctx.db.query("mediaRelaySources").collect())
      await ctx.db.patch(row._id, { state: "ready" });
  });
  const rows = await h.call("listSources", { workerId: "two", workerEpoch: 1 });
  assert.deepEqual(
    rows.map((r: { source: { streamId: string } }) => r.source.streamId),
    ["Charlie"],
  );
});
