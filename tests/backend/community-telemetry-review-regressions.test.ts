import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/_communityAuthority.ts": () => import("../../convex/_communityAuthority"),
  "../../convex/_communityTelemetry.ts": () => import("../../convex/_communityTelemetry"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const identity = {
  subject: "telemetry-review-operator",
  issuer: "test",
  tokenIdentifier: "test|telemetry-review-operator",
};

async function seedCommunity(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "faceless",
      displayName: "The Faceless",
      sortName: "the faceless",
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
    await ctx.db.insert("communityAuthorities", {
      communityProfileId,
      subjectTokenIdentifier: identity.tokenIdentifier,
      subject: identity,
      roleKey: "admin",
      roleLabel: "Admin",
      capabilities: ["manage_integrations"],
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    return communityProfileId;
  });
}

async function registerAccount(t: ReturnType<typeof convexTest>) {
  return t.mutation(internal.communityTelemetry.registerCollectorAccount, {
    vrchatUserId: "usr_00000000-0000-4000-8000-999999999999",
    accountAlias: "review-proof",
    secretRef: "arn:aws:secretsmanager:us-east-1:000000000000:secret:telemetry-review",
    workerKeyHash: "c".repeat(64),
    capacity: 3,
    reservedHeadroom: 1,
    requestsPerMinute: 30,
    now: Date.now(),
  });
}

function rollup(bucketStartAt: number, grain: "hour" | "day" | "event") {
  return {
    grain,
    bucketStartAt,
    bucketEndAt: bucketStartAt + 60 * 60_000,
    rollupVersion: "telemetry-v1",
    currentPopulation: 10,
    activeInstanceCount: 1,
    peakConcurrency: 10,
    playerMinutes: 10,
    coverageRatio: 1,
    worldDistribution: [],
    computedAt: bucketStartAt,
  };
}

describe("community telemetry review regressions", () => {
  it("starts a fresh telemetry epoch on reconnect and supports lean public profile reads", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    const accountId = await registerAccount(t);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "private",
      joinPolicy: "request",
    });

    const firstEpoch = await t.run(async (ctx) => {
      const integration = await ctx.db.get(integrationId);
      assert.ok(integration);
      const epoch = integration.telemetryEpochStartedAt ?? integration.createdAt;
      await ctx.db.insert("communityPopulationObservations", {
        integrationId,
        idempotencyKey: "old-population",
        totalPopulation: 10,
        activeInstanceCount: 1,
        worldDistribution: [],
        observedAt: epoch,
        source: "first_party",
        collectorVersion: "test",
        coverageState: "observed",
        fencingToken: 1,
      });
      await ctx.db.insert("communityMemberCountObservations", {
        integrationId,
        communityProfileId,
        idempotencyKey: "old-members",
        vrchatGroupId: integration.vrchatGroupId,
        memberCount: 100,
        observedAt: epoch,
        source: "first_party",
        collectorVersion: "test",
        coverageState: "observed",
        fencingToken: 1,
      });
      await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId,
        providerInstanceId: "old-instance",
        providerLocation: "wrld_old:1",
        vrchatWorldId: "wrld_old",
        source: "first_party",
        state: "closed",
        openedAt: epoch,
        lastObservedAt: epoch,
        closedAt: epoch,
        consecutiveMisses: 2,
        updatedAt: epoch,
      });
      await ctx.db.insert("collectionCoverageWindows", {
        integrationId,
        state: "observed",
        source: "first_party",
        collectorVersion: "test",
        startedAt: epoch,
        endedAt: epoch,
        updatedAt: epoch,
      });
      await ctx.db.insert("communityTelemetryRollups", {
        communityProfileId,
        ...rollup(epoch, "hour"),
      });
      await ctx.db.patch(integrationId, {
        state: "disconnected",
        assignedCollectorAccountId: undefined,
        lastSuccessfulObservationAt: epoch,
        disconnectedAt: epoch,
        nextPollAt: undefined,
      });
      await ctx.db.patch(accountId, { assignedGroupCount: 0, updatedAt: epoch });
      return epoch;
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const reconnectedId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000002",
      groupVisibility: "public",
      joinPolicy: "free",
    });
    assert.equal(reconnectedId, integrationId);

    const dashboard = await t.withIdentity(identity).query(api.communityTelemetry.getPrivateDashboard, {
      communitySlug: "faceless",
      now: Date.now(),
    });
    assert.equal(dashboard?.integration.vrchatGroupId, "grp_00000000-0000-4000-8000-000000000002");
    assert.equal(dashboard?.integration.lastSuccessfulObservationAt, undefined);
    assert.deepEqual(dashboard?.population, []);
    assert.deepEqual(dashboard?.memberCounts, []);
    assert.deepEqual(dashboard?.sessions, []);
    assert.deepEqual(dashboard?.coverage, []);
    assert.deepEqual(dashboard?.rollups, []);
    const reconnected = await t.run((ctx) => ctx.db.get(integrationId));
    assert.ok((reconnected?.telemetryEpochStartedAt ?? 0) > firstEpoch);

    await t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless",
      metric: "currentPopulation",
      enabled: true,
    });
    const leanProfile = await t.query(api.profiles.getPublicBySlug, {
      slug: "faceless",
      includeTelemetry: false,
    });
    const fullProfile = await t.query(api.profiles.getPublicBySlug, { slug: "faceless" });
    assert.ok(leanProfile);
    assert.ok(fullProfile);
    assert.equal("telemetry" in leanProfile, false);
    assert.equal("telemetry" in fullProfile, true);
  });

  it("loads dashboard rollups independently for every grain", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    await registerAccount(t);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "private",
      joinPolicy: "request",
    });
    const epoch = await t.run(async (ctx) => {
      const integration = await ctx.db.get(integrationId);
      assert.ok(integration);
      const startedAt = integration.telemetryEpochStartedAt ?? integration.createdAt;
      for (let index = 0; index < 401; index += 1) {
        await ctx.db.insert("communityTelemetryRollups", {
          communityProfileId,
          ...rollup(startedAt + index * 60 * 60_000, "hour"),
        });
      }
      await ctx.db.insert("communityTelemetryRollups", {
        communityProfileId,
        ...rollup(startedAt, "day"),
      });
      await ctx.db.insert("communityTelemetryRollups", {
        communityProfileId,
        ...rollup(startedAt, "event"),
      });
      return startedAt;
    });

    const dashboard = await t.withIdentity(identity).query(api.communityTelemetry.getPrivateDashboard, {
      communitySlug: "faceless",
      now: epoch + 402 * 60 * 60_000,
    });
    assert.equal(dashboard?.rollups.filter((item) => item.grain === "hour").length, 400);
    assert.equal(dashboard?.rollups.filter((item) => item.grain === "day").length, 1);
    assert.equal(dashboard?.rollups.filter((item) => item.grain === "event").length, 1);
  });
});
