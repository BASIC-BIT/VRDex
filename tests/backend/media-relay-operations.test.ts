import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import * as operations from "../../convex/mediaRelayOperations";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/mediaRelayOperations.ts": () =>
    import("../../convex/mediaRelayOperations"),
  "../../convex/mediaRelayWorker.ts": () =>
    import("../../convex/mediaRelayWorker"),
};
const ref = (name: string) =>
  makeFunctionReference<"mutation">(`mediaRelayOperations:${name}`);
test("operator endpoints are internal and reject impersonated public identities and service arguments", async () => {
  assert.equal(
    (operations.drainWorker as unknown as { isInternal: boolean }).isInternal,
    true,
  );
  assert.equal(
    (operations.setRelayEnabled as unknown as { isInternal: boolean })
      .isInternal,
    true,
  );
  const t = convexTest({ schema, modules });
  await assert.rejects(
    t
      .withIdentity({ subject: "public-owner" })
      .mutation(ref("setRelayEnabled"), { enabled: false }),
    /operator/i,
  );
  for (const credential of ["worker-token", "gateway-token"]) {
    await assert.rejects(
      t.mutation(ref("setRelayEnabled"), { enabled: false, credential }),
    );
    await assert.rejects(
      t.mutation(ref("drainWorker"), { workerId: "slot-0", credential }),
    );
  }
});
test("missing, synthetic or incomplete measurements cannot enable; emergency disable is idempotent", async () => {
  const t = convexTest({ schema, modules });
  process.env.MEDIA_RELAY_ENABLED = "true";
  for (const evidence of [
    undefined,
    "{}",
    JSON.stringify({ target: "local", evidenceId: "local-proof" }),
  ]) {
    if (evidence === undefined) delete process.env.MEDIA_RELAY_RELEASE_EVIDENCE;
    else process.env.MEDIA_RELAY_RELEASE_EVIDENCE = evidence;
    await assert.rejects(
      t.mutation(ref("setRelayEnabled"), { enabled: true }),
      /evidence|measurement|release/i,
    );
  }
  await t.mutation(ref("setRelayEnabled"), { enabled: false });
  await t.mutation(ref("setRelayEnabled"), { enabled: false });
  const rows = await t.run((ctx) =>
    ctx.db.query("mediaRelayOperations").collect(),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.enabled, false);
});
test("drain persists independently of worker observations and rejects unknown slots", async () => {
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "slot-0",
      workerEpoch: 1,
      allocation: { cpuUnits: 1024, memoryMiB: 2048, evidenceId: "proof-0001" },
      maxSources: 2,
      draining: false,
    },
  ]);
  const t = convexTest({ schema, modules });
  await assert.rejects(
    t.mutation(ref("drainWorker"), { workerId: "missing" }),
    /worker/i,
  );
  await t.mutation(ref("drainWorker"), { workerId: "slot-0" });
  await t.mutation(ref("drainWorker"), { workerId: "slot-0" });
  const rows = await t.run((ctx) =>
    ctx.db.query("mediaRelayOperations").collect(),
  );
  assert.deepEqual(rows[0]?.drainingWorkers, ["slot-0"]);
});
test("operator drain denies new claims but permits renewal; disable fences renewal, discovery and publication", async () => {
  process.env.MEDIA_RELAY_ENABLED = "true";
  process.env.MEDIA_RELAY_WORKER_TOKEN = "worker-token";
  process.env.MEDIA_RELAY_GATEWAY_TOKEN = "gateway-token";
  const allocation = {
    cpuUnits: 1024,
    memoryMiB: 2048,
    evidenceId: "proof-0001",
  };
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    {
      workerId: "slot-0",
      workerEpoch: 1,
      allocation,
      maxSources: 2,
      draining: false,
    },
  ]);
  const t = convexTest({ schema, modules });
  const worker = (name: string, args: Record<string, unknown>) =>
    t.mutation(makeFunctionReference<"mutation">(`mediaRelayWorker:${name}`), {
      credential: "worker-token",
      ...args,
    });
  await worker("registerWorker", {
    observation: {
      workerId: "slot-0",
      workerEpoch: 1,
      observedAt: Date.now(),
      allocation,
      activeJobs: 0,
      resources: null,
      jobs: [],
    },
  });
  const identity = { workerId: "slot-0", workerEpoch: 1 };
  await t.run(async (ctx) => {
    for (const streamId of ["Alpha", "Bravo"])
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
  await assert.rejects(
    worker("claimSource", { ...identity, streamKey: "vrcdn/Alpha/1" }),
    /disabled/,
  );
  // Test-only in-memory fixture; no enable operation against a deployment.
  await t.run((ctx) =>
    ctx.db.insert("mediaRelayOperations", {
      key: "global",
      enabled: true,
      drainingWorkers: [],
      updatedAt: Date.now(),
    }),
  );
  process.env.MEDIA_RELAY_ENABLED = "false";
  await assert.rejects(
    worker("claimSource", { ...identity, streamKey: "vrcdn/Alpha/1" }),
    /disabled/,
  );
  process.env.MEDIA_RELAY_ENABLED = "true";
  const lease = (await worker("claimSource", {
    ...identity,
    streamKey: "vrcdn/Alpha/1",
  })) as { epoch: number };
  await t.mutation(ref("drainWorker"), { workerId: "slot-0" });
  await assert.rejects(
    worker("claimSource", { ...identity, streamKey: "vrcdn/Bravo/1" }),
    /draining/,
  );
  await worker("renewSource", {
    ...identity,
    streamKey: "vrcdn/Alpha/1",
    epoch: lease.epoch,
  });
  await t.mutation(ref("setRelayEnabled"), { enabled: false });
  await assert.rejects(
    worker("renewSource", {
      ...identity,
      streamKey: "vrcdn/Alpha/1",
      epoch: lease.epoch,
    }),
    /disabled/,
  );
  await assert.rejects(worker("listSources", identity), /disabled/);
  await assert.rejects(
    worker("commitSnapshot", {
      ...identity,
      streamKey: "vrcdn/Alpha/1",
      epoch: lease.epoch,
      snapshot: {},
      objectKey: "ignored",
    }),
    /disabled/,
  );
});
import { ReleaseEvidenceSchema } from "../../packages/media-relay/src/worker/release-evidence";
test("release evidence cannot turn sampled disk, alerts, or local measurements into hosted safety approval", () => {
  const evidence = {
    target: "hosted",
    evidenceId: "reviewed-proof",
    measuredAt: Date.now(),
    deployment: "https://selected.convex.cloud",
    sourceCap: 2,
    cpuPeakPercent: 50,
    memoryPeakBytes: 500000000,
    diskPeakBytes: 4000000,
    partialDiskPeakBytes: 3000000,
    diskLimitBytes: 10000000,
    partialDiskBoundVerified: true,
    queuePeak: 2,
    upstreamBytes: 10000000,
    videoBytes: 9000000,
    audioBytes: 1000000,
    coldStartupMs: 4000,
    warmStartupMs: 2000,
    reconnectMs: 5000,
    remoteOperations: 20,
    cleanupPassed: true,
    timestampWarnings: 0,
    trafficDecision: "owner-accepted-payg-exposure",
    ownerApprovalReference: "review-ticket-123",
    monthlyBudgetUsd: 200,
  };
  assert.equal(ReleaseEvidenceSchema.safeParse(evidence).success, true);
  for (const patch of [
    { target: "local" },
    { partialDiskBoundVerified: false },
    { trafficDecision: "billing-alert-hard-stop" },
    { timestampWarnings: 1 },
    { cpuPeakPercent: 90 },
    { diskLimitBytes: 1000 },
    { remoteOperations: 0 },
  ])
    assert.equal(
      ReleaseEvidenceSchema.safeParse({ ...evidence, ...patch }).success,
      false,
    );
});
function configureReviewedRelease() {
  process.env.MEDIA_RELAY_ENABLED = "true";
  process.env.MEDIA_RELAY_MAX_SOURCES = "2";
  process.env.CONVEX_CLOUD_URL = "https://selected.convex.cloud";
  process.env.MEDIA_RELAY_RELEASE_EVIDENCE = JSON.stringify({
    target: "hosted",
    evidenceId: "reviewed-proof",
    measuredAt: Date.now(),
    deployment: "https://selected.convex.cloud",
    sourceCap: 2,
    cpuPeakPercent: 50,
    memoryPeakBytes: 500000000,
    diskPeakBytes: 4000000,
    partialDiskPeakBytes: 3000000,
    diskLimitBytes: 10000000,
    partialDiskBoundVerified: true,
    queuePeak: 2,
    upstreamBytes: 10000000,
    videoBytes: 9000000,
    audioBytes: 1000000,
    coldStartupMs: 4000,
    warmStartupMs: 2000,
    reconnectMs: 5000,
    remoteOperations: 20,
    cleanupPassed: true,
    timestampWarnings: 0,
    trafficDecision: "owner-accepted-payg-exposure",
    ownerApprovalReference: "review-ticket-123",
    monthlyBudgetUsd: 200,
  });
}
test("enable cannot count configured or persisted drained slots as recovery capacity", async () => {
  configureReviewedRelease();
  for (const persisted of [true, false]) {
    process.env.MEDIA_RELAY_WORKERS = JSON.stringify(
      ["slot-0", "slot-1"].map((workerId) => ({
        workerId,
        workerEpoch: 1,
        allocation: {
          cpuUnits: 1024,
          memoryMiB: 2048,
          evidenceId: "reviewed-proof",
        },
        maxSources: 2,
        draining: !persisted && workerId === "slot-0",
      })),
    );
    const t = convexTest({ schema, modules });
    await t.run((ctx) =>
      ctx.db.insert("mediaRelayOperations", {
        key: "global",
        enabled: false,
        drainingWorkers: persisted ? ["slot-0"] : [],
        updatedAt: Date.now(),
      }),
    );
    await assert.rejects(
      t.mutation(ref("setRelayEnabled"), { enabled: true }),
      /capacity/,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.query("mediaRelayOperations").first()))
        ?.enabled,
      false,
    );
  }
});

function reviewedBinding(workerId: string, workerEpoch = 1) {
  return {
    workerId,
    workerEpoch,
    allocation: {
      cpuUnits: 1024,
      memoryMiB: 2048,
      evidenceId: "reviewed-proof",
    },
    maxSources: 2,
    draining: false,
  };
}
test("duplicate worker IDs cannot enable or supply recovery capacity, including different epochs", async () => {
  configureReviewedRelease();
  for (const secondEpoch of [1, 2]) {
    process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
      reviewedBinding("slot-0"),
      reviewedBinding("slot-0", secondEpoch),
    ]);
    const t = convexTest({ schema, modules });
    await t.run((ctx) =>
      ctx.db.insert("mediaRelayOperations", {
        key: "global",
        enabled: false,
        drainingWorkers: [],
        updatedAt: Date.now(),
      }),
    );
    await assert.rejects(
      t.mutation(ref("setRelayEnabled"), { enabled: true }),
      /unique|duplicate/i,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.query("mediaRelayOperations").first()))
        ?.enabled,
      false,
    );
  }
});
test("unique reviewed worker slots enable only the in-memory operator fixture", async () => {
  configureReviewedRelease();
  process.env.MEDIA_RELAY_WORKERS = JSON.stringify([
    reviewedBinding("slot-0"),
    reviewedBinding("slot-1"),
  ]);
  const t = convexTest({ schema, modules });
  await t.mutation(ref("setRelayEnabled"), { enabled: true });
  const rows = await t.run((ctx) =>
    ctx.db.query("mediaRelayOperations").collect(),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.enabled, true);
  assert.equal(rows[0]?.evidenceId, "reviewed-proof");
});

test("deployment-only guard rejects registered and unregistered browser impersonation before writes", async () => {
  const t = convexTest({ schema, modules });
  await t.run(ctx => ctx.db.insert("users", {clerkUserId:"registered-operator"}));
  for (const subject of ["registered-operator", "unregistered-operator"]) {
    const browser = t.withIdentity({subject});
    await assert.rejects(browser.mutation(ref("setRelayEnabled"), {enabled:false}), /impersonation is forbidden/);
    await assert.rejects(browser.mutation(ref("drainWorker"), {workerId:"slot-0"}), /impersonation is forbidden/);
  }
  assert.deepEqual(await t.run(ctx => ctx.db.query("mediaRelayOperations").collect()), []);
  // Internal dispatch is the deployment-admin boundary; no browser identity is expected.
  await t.mutation(ref("setRelayEnabled"), {enabled:false});
  assert.equal((await t.run(ctx => ctx.db.query("mediaRelayOperations").unique()))?.enabled, false);
});
