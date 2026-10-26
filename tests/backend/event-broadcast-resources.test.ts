import assert from "node:assert/strict";
import { test } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { bindVrcdnTestAccount } from "./_eventOutputAccountFixture";
import { newClerkUserId } from "./_clerkTestIdentity";
import { resolveDestinationProfile } from "../../workers/restream/broadcast-profiles.mjs";
const samplerModule = () =>
  import("../../workers/restream/resource-sampler.mjs");
const allocation = {
  cpuUnits: 4096,
  memoryMiB: 8192,
  evidenceId: "unit-resource-shape",
};
const bridgeToken = "resources-test-token";
process.env.VRDEX_EVENT_MEDIA_BRIDGE_TOKEN = bridgeToken;
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const worker = (name: string) =>
  makeFunctionReference<"mutation">(`eventMediaWorker:${name}`);
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
  "../../convex/eventMediaWorker.ts": () =>
    import("../../convex/eventMediaWorker"),
};
async function fixture() {
  const t = convexTest({ schema, modules });
  const subject = newClerkUserId();
  const profileId = await t.run(async ({ db }) => {
    const now = Date.now();
    const userId = await db.insert("users", {
      clerkUserId: subject,
      name: "Owner",
      email: "owner@example.test",
      emailVerificationTime: now,
    });
    const profileId = await db.insert("profiles", {
      slug: "club",
      displayName: "Club",
      sortName: "club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: now,
      profileType: "community",
      community: { categoryTags: [] },
    });
    bindVrcdnTestAccount(profileId, "event-media/vrcdn/main");
    await db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    return profileId;
  });
  const owner = t.withIdentity({
    subject,
    emailVerified: true,
    issuer: "test",
    tokenIdentifier: `test|${subject}`,
  });
  const event = await owner.mutation(api.events.createCommunityEvent, {
    title: "Resources event",
    communitySlug: "club",
    startAt: Date.now() + 600_000,
    timezone: "UTC",
  });
  const output = await owner.mutation(api.events.configureVrcdnOutput, {
    currentSlug: event.slug,
    key: "main",
    label: "Main",
    credentialRef: "event-media/vrcdn/main",
    sourceConsentAccepted: true,
    destinationAuthorityAccepted: true,
    providerRulesAccepted: true,
    rightsClearedMediaAccepted: true,
    playbackLinks: [{ platform: "browser", url: "https://example.test/watch" }],
  });
  // Explicit trusted unit shape. This fixture never exercises or bypasses production admission.
  const sessionId = await t.run(async ({ db }) => {
    const mediaSettings = {
      videoPreset: "720p30" as const,
      audioBitrateKbps: 320 as const,
    };
    const id = await db.insert("eventMediaSessions", {
      eventId: event.eventId,
      programId: output.programId,
      outputId: output.outputId,
      status: "starting",
      allocation,
      mediaSettings,
      controlProtocolVersion: 2,
      committedIntent: { kind: "slate" },
      intentSequence: 0,
      destinationProfiles: [
        {
          outputId: output.outputId,
          destination: "vrcdn",
          profile: resolveDestinationProfile({
            settings: mediaSettings,
            destination: "vrcdn",
          }),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.patch(output.programId, { activeSessionId: id });
    return id;
  });
  const initial = {
    protocolVersion: 2,
    bridgeToken,
    eventId: event.eventId,
    sessionId,
    workerId: "worker-a",
    epoch: 0,
  };
  const lease = await t.mutation(worker("acquireSession"), initial);
  assert.equal(lease.granted, true);
  return {
    t,
    owner,
    profileId,
    event,
    output,
    args: { ...initial, epoch: lease.epoch },
    session: () => t.run((ctx) => ctx.db.get(sessionId)),
  };
}
const sample = {
  sampleSequence: 1,
  windowMs: 10000,
  sampleAgeMs: 1000,
  cpuUsagePercent: 25,
  memoryUsedBytes: 1024,
};

test("one child-inclusive core on four allocated cores is 25%, normalized by actual elapsed window", async () => {
  const { createResourceSampler } = await samplerModule();
  let now = 0,
    cpuUsageNs = 0;
  const mutable = { ...allocation };
  const sampler = createResourceSampler({
    allocation: mutable,
    clock: () => now,
    readCounters: async () => ({ cpuUsageNs, memoryUsedBytes: 2048 }),
  });
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, undefined);
  assert.equal(sampler.latest().memoryUsedBytes, 2048);
  mutable.cpuUnits = 8192;
  now = 10000;
  cpuUsageNs = 10e9;
  await sampler.sample();
  const sample = sampler.latest();
  assert.equal(sample.cpuUsagePercent, 25);
  assert.equal(sample.windowMs, 10000);
  now = 30000;
  cpuUsageNs = 30e9;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, 25);
  assert.equal(sampler.latest().windowMs, 20000);
  now = 40000;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, 0);
});
test("counter reset, unavailable measurements and failure keep independent readings honest", async () => {
  const { createResourceSampler } = await samplerModule();
  let now = 0;
  let counters: Record<string, number> = {
    cpuUsageNs: 10e9,
    memoryUsedBytes: 0,
  };
  let fail = false;
  const sampler = createResourceSampler({
    allocation,
    clock: () => now,
    readCounters: async () => {
      if (fail) throw Error("unsupported");
      return counters;
    },
  });
  await sampler.sample();
  assert.equal(sampler.latest().memoryUsedBytes, 0);
  now = 10000;
  counters = { cpuUsageNs: 1e9, memoryUsedBytes: 123 };
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, undefined);
  now = 20000;
  counters = { cpuUsageNs: 11e9 };
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, 25);
  assert.equal(sampler.latest().memoryUsedBytes, undefined);
  now = 30000;
  counters = { memoryUsedBytes: 456 };
  await sampler.sample();
  assert.equal(sampler.latest().memoryUsedBytes, 456);
  assert.equal(sampler.latest().cpuUsagePercent, undefined);
  now = 40000;
  fail = true;
  await sampler.sample();
  assert.equal(sampler.latest().sampleSequence, 4);
  assert.equal(sampler.latest().sampleAgeMs, 10000);
  now = 60000;
  assert.equal(sampler.latest().sampleAgeMs, 30000);
  fail = false;
  counters = { cpuUsageNs: NaN, memoryUsedBytes: -1 };
  await sampler.sample();
  assert.equal(sampler.latest().sampleSequence, 4);
});
test("zero and backwards clock windows cannot produce CPU; delayed collections retain their starting age", async () => {
  const { createResourceSampler } = await samplerModule();
  let now = 10000,
    cpuUsageNs = 1e9;
  const sampler = createResourceSampler({
    allocation,
    clock: () => now,
    readCounters: async () => ({ cpuUsageNs }),
  });
  await sampler.sample();
  cpuUsageNs = 2e9;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, undefined);
  now = 0;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, undefined);
  now = 20000;
  cpuUsageNs = 22e9;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, 25);
  const delayed = createResourceSampler({
    allocation,
    clock: () => now,
    readCounters: async () => {
      now += 5000;
      return { memoryUsedBytes: 12 };
    },
  });
  await delayed.sample();
  assert.equal(delayed.latest().sampleAgeMs, 5000);
});
test("one pending read and reset discard old completions", async () => {
  const { createResourceSampler } = await samplerModule();
  let reads = 0;
  let finish!: (value: { memoryUsedBytes: number }) => void;
  const sampler = createResourceSampler({
    allocation,
    clock: () => 0,
    readCounters: () => {
      reads++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const first = sampler.sample();
  const second = sampler.sample();
  await Promise.resolve();
  assert.equal(reads, 1);
  sampler.reset();
  finish({ memoryUsedBytes: 55 });
  await Promise.all([first, second]);
  assert.equal(sampler.latest(), undefined);
  const third = sampler.sample();
  await Promise.resolve();
  finish({ memoryUsedBytes: 66 });
  await third;
  assert.equal(sampler.latest().sampleSequence, 1);
});
test("cgroup v2 and v1 totals include children and page cache with explicit units and independent failures", async () => {
  const { readCgroupCounters } = await samplerModule();
  for (const [files, expected] of [
    [
      {
        "/sys/fs/cgroup/cpu.stat":
          "usage_usec 123456\nuser_usec 3\nsystem_usec 4",
        "/sys/fs/cgroup/memory.current": "4096\n",
      },
      { cpuUsageNs: 123456000, memoryUsedBytes: 4096 },
    ],
    [
      {
        "/sys/fs/cgroup/cpuacct/cpuacct.usage": "987654321",
        "/sys/fs/cgroup/memory/memory.usage_in_bytes": "8192",
      },
      { cpuUsageNs: 987654321, memoryUsedBytes: 8192 },
    ],
    [{ "/sys/fs/cgroup/memory.current": "0" }, { memoryUsedBytes: 0 }],
    [{ "/sys/fs/cgroup/cpu.stat": "usage_usec 100" }, { cpuUsageNs: 100000 }],
    [
      {
        "/sys/fs/cgroup/cpu.stat": "usage_usec 9007199254740992",
        "/sys/fs/cgroup/memory.current": "-1",
      },
      {},
    ],
    [{}, {}],
  ] as const) {
    const result = await readCgroupCounters({
      readFile: async (path: string) => {
        if (!(path in files)) throw Error("unsupported");
        return Reflect.get(files, path);
      },
    });
    assert.deepEqual(result, expected);
  }
});

test("renewal stores only latest and preserves measured age plus conservative request allowance", async () => {
  const f = await fixture();
  const before = Date.now();
  const result = await f.t.mutation(worker("renewSession"), {
    ...f.args,
    sample,
  });
  assert.equal(result.granted, true);
  assert.deepEqual(
    Object.keys(schema.tables).filter((name) =>
      /resource.*snapshot|resource.*history/i.test(name),
    ),
    [],
  );
  const first = (await f.session())!;
  assert.equal(first.resourceSnapshot?.cpuUsagePercent, 25);
  assert.ok(
    first.resourceObservedAt! >= before - 4000 &&
      first.resourceObservedAt! <= Date.now() - 4000,
  );
  for (const value of [
    sample,
    { ...sample, sampleSequence: 0 },
    { ...sample, sampleSequence: 2, sampleAgeMs: 27000 },
  ]) {
    assert.equal(
      (await f.t.mutation(worker("renewSession"), { ...f.args, sample: value }))
        .granted,
      true,
    );
    assert.deepEqual(
      (await f.session())!.resourceSnapshot,
      first.resourceSnapshot,
    );
    assert.equal(
      (await f.session())!.resourceObservedAt,
      first.resourceObservedAt,
    );
  }
  await f.t.mutation(worker("renewSession"), {
    ...f.args,
    sample: { ...sample, sampleSequence: 2, memoryUsedBytes: 2048 },
  });
  assert.equal((await f.session())!.resourceSnapshot!.sampleSequence, 2);
  assert.equal(
    (await f.t.run((ctx) => ctx.db.query("eventMediaSessions").collect()))
      .length,
    1,
  );
});
test("malformed optional telemetry never rejects valid renewal or writes partial observations", async () => {
  const f = await fixture();
  for (const value of [
    null,
    "bad",
    [],
    { ...sample, extra: true },
    { ...sample, windowMs: -1 },
    { ...sample, sampleAgeMs: Infinity },
    { ...sample, cpuUsagePercent: NaN },
    { ...sample, memoryUsedBytes: -1 },
    { ...sample, sampleSequence: 1.5 },
    { ...sample, sampleSequence: Number.MAX_SAFE_INTEGER + 1 },
    ...[
      "windowMs",
      "sampleAgeMs",
      "cpuUsagePercent",
      "memoryUsedBytes",
    ].flatMap((field) =>
      [-1, NaN, Infinity].map((value) => ({ ...sample, [field]: value })),
    ),
    { ...sample, windowMs: 43200001 },
    { ...sample, memoryUsedBytes: Number.MAX_SAFE_INTEGER + 1 },
    { sampleSequence: 1, windowMs: 0, sampleAgeMs: 0 },
  ]) {
    assert.equal(
      (await f.t.mutation(worker("renewSession"), { ...f.args, sample: value }))
        .granted,
      true,
    );
    assert.equal((await f.session())!.resourceSnapshot, undefined);
  }
  await assert.rejects(
    f.t.mutation(worker("renewSession"), {
      ...f.args,
      bridgeToken: "wrong",
      sample,
    }),
    /token/i,
  );
});
test("ownership rejection and epoch replacement cannot revive old resources", async () => {
  const f = await fixture();
  await f.t.mutation(worker("renewSession"), { ...f.args, sample });
  for (const patch of [{ epoch: 0 }, { workerId: "other" }])
    assert.equal(
      (
        await f.t.mutation(worker("renewSession"), {
          ...f.args,
          ...patch,
          sample: { ...sample, sampleSequence: 2 },
        })
      ).granted,
      false,
    );
  await f.t.mutation(worker("acquireSession"), f.args);
  assert.ok((await f.session())!.resourceSnapshot);
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, { leaseExpiresAt: Date.now() - 1 }),
  );
  assert.equal(
    (await f.t.mutation(worker("renewSession"), { ...f.args, sample })).granted,
    false,
  );
  const replacement = await f.t.mutation(worker("acquireSession"), {
    ...f.args,
    workerId: "other",
  });
  assert.equal(replacement.epoch, 2);
  assert.equal((await f.session())!.resourceSnapshot, undefined);
  assert.equal((await f.session())!.resourceObservedAt, undefined);
  assert.equal(
    (
      await f.t.mutation(worker("renewSession"), {
        ...f.args,
        sample: { ...sample, sampleSequence: 999 },
      })
    ).granted,
    false,
  );
  await f.t.mutation(worker("renewSession"), {
    ...f.args,
    workerId: "other",
    epoch: 2,
    sample,
  });
  assert.equal((await f.session())!.resourceSnapshot!.sampleSequence, 1);
});
test("authorized reader sees actual encoded facts, resource freshness and trusted allocation pricing; public projections do not", async () => {
  const f = await fixture();
  const subject = newClerkUserId();
  await f.t.run(async ({ db }) => {
    await db.insert("users", { clerkUserId: subject, name: "Reader" });
    await db.insert("communityAuthorities", {
      communityProfileId: f.profileId,
      subjectTokenIdentifier: `test|${subject}`,
      subject: { subject, issuer: "test", tokenIdentifier: `test|${subject}` },
      capabilities: ["view_event_operations"],
      state: "active",
      grantedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await db.patch(f.args.sessionId, {
      observedSourceRevision: 7,
      observedSlotKey: "actual-slot",
      observedOutputMs: 12345,
      dispatchId: "dispatch",
    });
    await db.patch(f.event.eventId, { publicationState: "published" });
  });
  const reader = f.t.withIdentity({
    subject,
    issuer: "test",
    tokenIdentifier: `test|${subject}`,
  });
  const query = () =>
    reader.query(api.events.getEventMediaControlStatus, {
      currentSlug: f.event.slug,
    });
  assert.equal(
    (await query())!.sessions[0]!.resources.computeEstimate,
    undefined,
  );
  const computeRuntime = {
    region: "us-east-1",
    os: "linux",
    architecture: "x86_64",
    purchaseModel: "on_demand",
  };
  await f.t.mutation(worker("recordDispatchedTask"), {
    bridgeToken,
    sessionId: f.args.sessionId,
    dispatchId: "dispatch",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/abc",
    taskDefinitionArn:
      "arn:aws:ecs:us-east-1:123456789012:task-definition/test:1",
    computeRuntime,
  });
  await f.t.mutation(worker("renewSession"), { ...f.args, sample });
  const projected = (await query())!;
  const current = projected.sessions[0]!;
  assert.equal(projected.canControl, false);
  assert.deepEqual(
    [
      current.observedSourceRevision,
      current.observedSlotKey,
      current.observedOutputMs,
    ],
    [7, "actual-slot", 12345],
  );
  assert.equal(current.resources.fresh, true);
  assert.equal(current.resources.cpuUsagePercent, 25);
  assert.equal(current.resources.staleAfterMs, 30000);
  assert.deepEqual(current.resources.allocation, allocation);
  assert.equal(current.resources.region, "us-east-1");
  assert.equal(current.resources.provider, "aws_ecs");
  assert.ok(
    Math.abs(current.resources.computeEstimate!.usdPerHour - 0.19748) < 1e-10,
  );
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, { resourceObservedAt: Date.now() - 30000 }),
  );
  const stale = (await query())!.sessions[0]!.resources;
  assert.equal(stale.fresh, false);
  assert.equal(stale.cpuUsagePercent, undefined);
  assert.equal(stale.memoryUsedBytes, undefined);
  assert.ok(stale.computeEstimate);
  for (const value of [
    await f.t.query(api.events.getPublicBySlug, { slug: f.event.slug }),
    await f.t.query(api.events.getHostBySlug, {
      slug: f.event.slug,
      communitySlug: "club",
    }),
    await f.t.query(api.events.getPublicShareCardBySlug, {
      communitySlug: "club",
      eventSlug: f.event.slug,
    }),
  ]) {
    assert.ok(value);
    assert.doesNotMatch(
      JSON.stringify(value),
      /resourceSnapshot|resources|cpuUsagePercent|memoryUsedBytes|computeEstimate|usdPerHour|rateDate|evidenceId/,
    );
  }
});

test("deferred or rejected counters cannot block publishing, renewal, Cut or Stop", async () => {
  const { createEventWorker } =
    await import("../../workers/restream/event-worker.mjs");
  const { syntheticInputs } =
    await import("../../scripts/event-proof-fixtures.mjs");
  for (const mode of ["deferred", "rejected"] as const) {
    const f = await fixture();
    let time = 0,
      outputMs = 100,
      stops = 0,
      reads = 0;
    let finish: ((value: { memoryUsedBytes: number }) => void) | undefined;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const runtime = createEventWorker({
      identity: { ...f.args },
      clock: () => time,
      inputs: syntheticInputs(),
      checkEnabled: async () => true,
      validateConfiguration: (config: { allocation: typeof allocation }) =>
        config.allocation,
      readCounters: () => {
        reads++;
        return mode === "rejected"
          ? Promise.reject(Error("injected counter failure"))
          : new Promise((resolve) => {
              finish = resolve;
            });
      },
      renderer: {
        start: async () => {},
        stop: async () => {},
        subscribe: () => () => {},
        reconcileSources: () => {},
        getInputs: () => [],
        selectSource: () => false,
        hold: () => {},
        getState: () => ({ running: true, outputMs: ++outputMs }),
      },
      outputs: {
        start: async () => {},
        stop: async () => {},
        stopNow: () => {
          stops++;
        },
        getState: () => ({ publishing: stops === 0 }),
      },
      control: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args: structuredClone(args) });
        return f.t.mutation(worker(name), args);
      },
    });
    const tick = async () => {
      await runtime.tick();
      for (let i = 0; i < 4; i++)
        await new Promise<void>((resolve) => setImmediate(resolve));
    };
    try {
      await runtime.start();
      await tick();
      for (time = 5000; time <= 10000; time += 5000) await tick();
      assert.equal(calls.filter((c) => c.name === "renewSession").length, 1);
      assert.equal(stops, 0);
      assert.ok((await f.session())!.observedOutputMs! > 100);
      assert.equal(reads, mode === "deferred" ? 1 : 2);
      const cut = await f.owner.mutation(api.events.queueEventMediaCommand, {
        currentSlug: f.event.slug,
        type: "switch_hold",
        idempotencyKey: "cut",
      });
      await tick();
      await tick();
      assert.equal(
        (await f.t.run((ctx) => ctx.db.get(cut.commandId)))!.status,
        "succeeded",
      );
      await f.owner.mutation(api.events.stopEventMediaWorker, {
        currentSlug: f.event.slug,
        sessionId: f.args.sessionId,
      });
      await tick();
      assert.equal(runtime.getState().stopped, true);
      assert.equal(stops, 1);
      finish?.({ memoryUsedBytes: 999 });
      await tick();
      assert.equal((await f.session())!.resourceSnapshot, undefined);
      assert.ok(
        calls.every((c) =>
          [
            "acquireSession",
            "renewSession",
            "refreshConfiguration",
            "claimCommands",
            "observeProgram",
            "beginPreparation",
            "acknowledgeCommand",
          ].includes(c.name),
        ),
      );
    } finally {
      await runtime.stop();
    }
  }
});

test("variable read duration normalizes CPU by measurement completion, while freshness remains conservative", async () => {
  const { createResourceSampler } = await samplerModule();
  let now = 0,
    duration = 5000,
    cpuUsageNs = 0;
  const sampler = createResourceSampler({
    allocation,
    clock: () => now,
    readCounters: async () => {
      now += duration;
      cpuUsageNs = now * 1e6;
      return { cpuUsageNs, memoryUsedBytes: 1 };
    },
  });
  await sampler.sample();
  now = 10000;
  duration = 10000;
  await sampler.sample();
  assert.equal(sampler.latest().cpuUsagePercent, 25);
  assert.equal(sampler.latest().windowMs, 15000);
  assert.equal(sampler.latest().sampleAgeMs, 10000);
});
test("provenance is absent for generic Fargate registration and rejected for mismatched actual regions", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.args.sessionId, { dispatchId: "dispatch" }),
  );
  const registration = {
    bridgeToken,
    sessionId: f.args.sessionId,
    dispatchId: "dispatch",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/test/abc",
    taskDefinitionArn:
      "arn:aws:ecs:us-east-1:123456789012:task-definition/test:1",
  };
  assert.equal(
    (await f.t.mutation(worker("recordDispatchedTask"), registration)).accepted,
    true,
  );
  assert.equal((await f.session())!.computeRuntime, undefined);
  assert.equal(
    (
      await f.t.mutation(worker("recordDispatchedTask"), {
        ...registration,
        computeRuntime: {
          region: "eu-west-1",
          os: "linux",
          architecture: "x86_64",
          purchaseModel: "on_demand",
        },
      })
    ).accepted,
    true,
  );
  assert.equal((await f.session())!.computeRuntime, undefined);
  await assert.rejects(
    f.t.mutation(worker("recordDispatchedTask"), {
      ...registration,
      bridgeToken: "bad",
    }),
    /token/i,
  );
});

test("renewals carry existing samples without increasing sequence or refreshing stale readings", async () => {
  const { createEventWorker } =
    await import("../../workers/restream/event-worker.mjs");
  const { syntheticInputs } =
    await import("../../scripts/event-proof-fixtures.mjs");
  const f = await fixture();
  let time = 0,
    outputMs = 100,
    reads = 0;
  const renewals: Record<string, unknown>[] = [];
  const runtime = createEventWorker({
    identity: { ...f.args },
    clock: () => time,
    inputs: syntheticInputs(),
    checkEnabled: async () => true,
    validateConfiguration: (config: { allocation: typeof allocation }) =>
      config.allocation,
    readCounters: () => {
      reads++;
      return reads === 1
        ? Promise.resolve({ memoryUsedBytes: 2048 })
        : new Promise(() => {});
    },
    renderer: {
      start: async () => {},
      stop: async () => {},
      subscribe: () => () => {},
      reconcileSources: () => {},
      getInputs: () => [],
      selectSource: () => false,
      hold: () => {},
      getState: () => ({ running: true, outputMs: ++outputMs }),
    },
    outputs: {
      start: async () => {},
      stop: async () => {},
      stopNow: () => {},
      getState: () => ({ publishing: true }),
    },
    control: async (name: string, args: Record<string, unknown>) => {
      if (name === "renewSession") renewals.push(structuredClone(args));
      return f.t.mutation(worker(name), args);
    },
  });
  try {
    await runtime.start();
    for (let i = 0; i < 4; i++) await runtime.tick();
    assert.equal(reads, 1);
    for (time = 5000; time <= 10000; time += 5000) await runtime.tick();
    const observedAt = (await f.session())!.resourceObservedAt;
    assert.ok(observedAt);
    for (time = 15000; time <= 30000; time += 5000) await runtime.tick();
    assert.equal(reads, 2);
    assert.equal(runtime.getState().stopped, false);
    assert.equal(renewals.length, 3);
    assert.deepEqual(
      renewals.map((r) => r.sample),
      [10000, 20000, 30000].map((sampleAgeMs) => ({
        sampleSequence: 1,
        windowMs: 0,
        sampleAgeMs,
        memoryUsedBytes: 2048,
      })),
    );
    assert.equal((await f.session())!.resourceObservedAt, observedAt);
  } finally {
    await runtime.stop();
  }
});

test("resource recording independently rejects cross-event and cross-program ownership", async () => {
  const { recordResourceSnapshot } =
    await import("../../convex/_eventBroadcastResources");
  const f = await fixture();
  const other = await f.owner.mutation(api.events.createCommunityEvent, {
    title: "Other",
    communitySlug: "club",
    startAt: Date.now() + 600000,
    timezone: "UTC",
  });
  await f.t.run((ctx) =>
    recordResourceSnapshot(ctx, { ...f.args, eventId: other.eventId, sample }),
  );
  assert.equal((await f.session())!.resourceSnapshot, undefined);
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.output.programId, { eventId: other.eventId });
    await recordResourceSnapshot(ctx, { ...f.args, sample });
  });
  assert.equal((await f.session())!.resourceSnapshot, undefined);
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.output.programId, {
      eventId: f.event.eventId,
      activeSessionId: undefined,
    });
    await recordResourceSnapshot(ctx, { ...f.args, sample });
  });
  assert.equal((await f.session())!.resourceSnapshot, undefined);
});
