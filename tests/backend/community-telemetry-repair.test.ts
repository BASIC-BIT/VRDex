import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/communityTelemetryRepair.ts": () =>
    import("../../convex/communityTelemetryRepair"),
  "../../convex/communityTelemetry.ts": () =>
    import("../../convex/communityTelemetry"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
it("repair dry runs preserve data and apply stays bound to the inventory", async () => {
  const t = convexTest({ schema, modules });
  const start = Date.UTC(2026, 9, 1);
  const integrationId = await t.run((ctx) =>
    ctx.db.insert("communityVrchatIntegrations", {
      vrchatGroupId: "grp_example",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      collectionScope: { kind: "automatic" },
      killSwitchEnabled: false,
      requestsPerMinute: 30,
      leaseGeneration: 0,
      consecutiveFailures: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      createdAt: start - 60000,
      telemetryEpochStartedAt: start - 60000,
      updatedAt: start,
    }),
  );
  await t.run(async (ctx) => {
    for (let n = -1; n <= 61; n += 2)
      await ctx.db.insert("communityPopulationObservations", {
        integrationId,
        idempotencyKey: `r-${n}`,
        totalPopulation: 10,
        activeInstanceCount: 1,
        worldDistribution: [],
        observedAt: start + n * 60000,
        source: "first_party",
        collectorVersion: "test",
        coverageState: "observed",
        fencingToken: 1,
      });
  });
  const target = {
    grain: "hour" as const,
    bucketStartAt: start,
    bucketEndAt: start + 3600000,
  };
  const before = await t.run((ctx) =>
    ctx.db.query("communityPopulationObservations").collect(),
  );
  const preview = await t.query(internal.communityTelemetryRepair.preview, {
    integrationId,
    ...target,
  });
  assert.equal(preview.status, "ready");
  assert.equal(preview.proposed?.playerMinutes, 600);
  assert.deepEqual(
    await t.run((ctx) =>
      ctx.db.query("communityPopulationObservations").collect(),
    ),
    before,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.query("communityTelemetryRollups").collect()))
      .length,
    0,
  );
  const scope = {
    integrationId,
    startAt: start,
    endAt: start + 3600000,
    inventoryId: "test-inventory",
    expectedTargets: 1,
  };
  const runId = await t.mutation(
    internal.communityTelemetryRepair.begin,
    scope,
  );
  assert.equal(
    await t.mutation(internal.communityTelemetryRepair.begin, scope),
    runId,
  );
  await assert.rejects(
    t.mutation(internal.communityTelemetryRepair.append, {
      runId,
      targets: [{ ...target, bucketEndAt: start + 7200000 }],
    }),
    /scope/,
  );
  await t.mutation(internal.communityTelemetryRepair.append, {
    runId,
    targets: [target],
  });
  await t.mutation(internal.communityTelemetryRepair.append, {
    runId,
    targets: [target],
  });
  await t.mutation(internal.communityTelemetryRepair.seal, { runId });
  const saved = await t.run((ctx) =>
    ctx.db.query("communityTelemetryRepairTargets").first(),
  );
  assert.ok(saved);
  await t.mutation(internal.communityTelemetryRepair.repairTarget, {
    targetId: saved._id,
  });
  await t.mutation(internal.communityTelemetryRepair.repairTarget, {
    targetId: saved._id,
  });
  const status = await t.mutation(internal.communityTelemetryRepair.refresh, {
    runId,
  });
  assert.equal(status.corrected, 1);
  assert.equal(status.pending, 0);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("communityTelemetryRollups").collect()))
      .length,
    1,
  );
  assert.deepEqual(
    await t.run((ctx) =>
      ctx.db.query("communityPopulationObservations").collect(),
    ),
    before,
  );
});

it("a queued recap stays pending and a legacy continuation cannot publish old arithmetic", async () => {
  const t = convexTest({ schema, modules });
  const start = Date.UTC(2026, 9, 1);
  const seed = await t.run(async (ctx) => {
    const profile = await ctx.db.insert("profiles", {
      slug: "repair",
      displayName: "Repair",
      sortName: "repair",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      profileType: "community",
      community: { categoryTags: [] },
      updatedAt: start,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: profile,
      collectionScope: { kind: "managed", communityProfileId: profile },
      vrchatGroupId: "grp_repair",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      killSwitchEnabled: false,
      requestsPerMinute: 30,
      leaseGeneration: 0,
      consecutiveFailures: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      createdAt: start,
      telemetryEpochStartedAt: start,
      updatedAt: start,
    });
    const eventId = await ctx.db.insert("events", {
      title: "Repair",
      sortTitle: "repair",
      communityProfileId: profile,
      startAt: start,
      endAt: start + 3600000,
      sourceType: "manual",
      sourceLabel: "test",
      eventStatus: "scheduled",
      publicationState: "published",
      updatedAt: start,
    });
    for (let n = 0; n < 101; n++) {
      const sessionId = await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId: profile,
        providerInstanceId: `instance-${n}`,
        providerLocation: `wrld_repair:instance-${n}`,
        vrchatWorldId: "wrld_repair",
        source: "first_party",
        state: "closed",
        openedAt: start,
        lastObservedAt: start + 60000,
        closedAt: start + 120000,
        consecutiveMisses: 2,
        updatedAt: start + 120000,
      });
      await ctx.db.insert("eventInstanceAssociations", {
        eventId,
        sessionId,
        communityProfileId: profile,
        state: "confirmed",
        source: "manual",
        confidence: 1,
        createdAt: start,
        updatedAt: start,
      });
      await ctx.db.insert("instancePopulationObservations", {
        integrationId,
        sessionId,
        providerInstanceId: `instance-${n}`,
        vrchatWorldId: "wrld_repair",
        idempotencyKey: `event-${n}`,
        population: 1,
        observedAt: start + 60000,
        source: "first_party",
        collectorVersion: "test",
        coverageState: "observed",
        fencingToken: 1,
      });
    }
    return { integrationId, eventId };
  });
  const target = {
    grain: "event" as const,
    bucketStartAt: start,
    bucketEndAt: start + 3600000,
    eventId: seed.eventId,
  };
  const preview = await t.action(
    internal.communityTelemetryRepair.previewEvent,
    { integrationId: seed.integrationId, ...target },
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.proposed.peakConcurrency, 101);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("communityTelemetryRollups").collect()))
      .length,
    0,
  );
  const runId = await t.mutation(internal.communityTelemetryRepair.begin, {
    integrationId: seed.integrationId,
    startAt: start,
    endAt: start + 3600000,
    inventoryId: "recap",
    expectedTargets: 1,
  });
  await t.mutation(internal.communityTelemetryRepair.append, {
    runId,
    targets: [target],
  });
  await t.mutation(internal.communityTelemetryRepair.seal, { runId });
  const saved = await t.run((ctx) =>
    ctx.db.query("communityTelemetryRepairTargets").first(),
  );
  assert.ok(saved);
  await t.mutation(internal.communityTelemetryRepair.repairTarget, {
    targetId: saved._id,
  });
  assert.equal(
    (await t.mutation(internal.communityTelemetryRepair.refresh, { runId }))
      .pending,
    1,
  );
  const job = await t.run((ctx) =>
    ctx.db.query("communityTelemetryEventRecapJobs").first(),
  );
  assert.ok(job);
  await t.run((ctx) =>
    ctx.db.patch(job._id, { calculationVersion: undefined }),
  );
  await t.mutation(internal.communityTelemetry.continueEventRecapJob, {
    jobId: job._id,
  });
  assert.equal(
    (await t.run((ctx) => ctx.db.query("communityTelemetryRollups").collect()))
      .length,
    0,
  );
  // Explicit retry recreates the recap with the current version.
  await t.mutation(internal.communityTelemetryRepair.refresh, { runId });
  await t.mutation(internal.communityTelemetryRepair.repairTarget, {
    targetId: saved._id,
  });
  for (let n = 0; n < 5; n++) {
    const next = await t.run((ctx) =>
      ctx.db.query("communityTelemetryEventRecapJobs").first(),
    );
    if (!next) break;
    await t.mutation(internal.communityTelemetry.continueEventRecapJob, {
      jobId: next._id,
    });
  }
  const status = await t.mutation(internal.communityTelemetryRepair.refresh, {
    runId,
  });
  assert.equal(status.corrected, 1);
  assert.equal(status.pending, 0);
  assert.equal(status.complete, true);
});
