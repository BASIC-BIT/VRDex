import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/_communityAuthority.ts": () => import("../../convex/_communityAuthority"),
  "../../convex/_communityTelemetry.ts": () => import("../../convex/_communityTelemetry"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-07-21T12:00:00.000Z");
const identity = { subject: "telemetry-operator", issuer: "test", tokenIdentifier: "test|telemetry-operator" };

async function seedCommunity(t: ReturnType<typeof convexTest>, slug = "faceless") {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId,
      email: `${slug}@example.test`,
      emailVerificationTime: NOW,
    });
    identity.subject = clerkUserId;
    const communityProfileId = await ctx.db.insert("profiles", {
      slug,
      displayName: slug === "faceless" ? "The Faceless" : "Second Community",
      sortName: slug === "faceless" ? "the faceless" : "second community",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: NOW,
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
      grantedAt: NOW,
      updatedAt: NOW,
    });
    return communityProfileId;
  });
}

async function registerAccount(t: ReturnType<typeof convexTest>, capacity = 3, sequence = 1) {
  const suffix = String(sequence).padStart(12, "0");
  return t.mutation(internal.communityTelemetry.registerCollectorAccount, {
    vrchatUserId: `usr_00000000-0000-4000-8000-${suffix}`,
    accountAlias: `proof-${sequence}`,
    secretRef: `arn:aws:secretsmanager:us-east-1:000000000000:secret:telemetry-${sequence}`,
    workerKeyHash: (sequence === 1 ? "a" : "b").repeat(64),
    capacity,
    reservedHeadroom: 1,
    requestsPerMinute: 30,
    now: NOW,
  });
}

async function finishImmediateSchedules(t: ReturnType<typeof convexTest>, iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

describe("community telemetry control plane", () => {
  it("enforces authority and keeps every public metric private by default", async () => {
    const t = convexTest({ schema, modules });
    await seedCommunity(t);
    await registerAccount(t);

    await assert.rejects(
      t.mutation(api.communityTelemetry.connectGroup, {
        communitySlug: "faceless",
        vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
        groupVisibility: "public",
        joinPolicy: "free",
      }),
      /signed-in user/,
    );

    await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public",
      joinPolicy: "free",
    });

    const dashboard = await t.withIdentity(identity).query(api.communityTelemetry.getPrivateDashboard, {
      communitySlug: "faceless",
      now: NOW,
    });
    assert.deepEqual(dashboard?.integration.publicMetrics, {
      currentPopulation: false,
      populationHistory: false,
      groupMemberCount: false,
      groupMemberGrowth: false,
      eventRecaps: false,
    });
    assert.equal(await t.query(api.communityTelemetry.getPublicForCommunity, { communitySlug: "faceless", now: NOW }), null);
    await assert.rejects(
      t.query(api.communityTelemetry.getPrivateDashboard, { communitySlug: "faceless", now: NOW }),
      /signed-in user/,
    );
  });

  it("allows the singleton community owner to manage telemetry without a delegated authority row", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    const ownerIdentity = await t.run(async (ctx) => {
      const clerkUserId2 = newClerkUserId();
      const userId = await ctx.db.insert("users", {
        clerkUserId: clerkUserId2,
        name: "Community Owner",
        email: "owner@example.com",
        emailVerificationTime: NOW,
      });
      await ctx.db.insert("profileOwners", {
        profileId: communityProfileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW,
        updatedAt: NOW,
      });
      return { subject: clerkUserId2, emailVerified: true, issuer: "test", tokenIdentifier: `test|${userId}` };
    });
    await registerAccount(t);

    await t.withIdentity(ownerIdentity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public",
      joinPolicy: "free",
    });
    const dashboard = await t.withIdentity(ownerIdentity).query(api.communityTelemetry.getPrivateDashboard, {
      communitySlug: "faceless",
      now: NOW,
    });
    assert.equal(dashboard?.community.slug, "faceless");
  });

  it("defers unresolved membership states before releasing their leases", async () => {
    for (const state of ["connecting", "awaiting_approval", "awaiting_invite"] as const) {
      const t = convexTest({ schema, modules });
      await seedCommunity(t);
      const accountId = await registerAccount(t);
      const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
        communitySlug: "faceless",
        vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
        groupVisibility: "private",
        joinPolicy: state === "awaiting_approval" ? "request" : state === "awaiting_invite" ? "invite" : "free",
      });
      const claimAt = Date.now() + 1_000;
      const [claim] = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
        collectorAccountId: accountId,
        workerId: "membership-worker",
        now: claimAt,
      });
      assert.ok(claim);
      await t.mutation(internal.communityTelemetry.recordMembershipResult, {
        integrationId,
        collectorAccountId: accountId,
        workerId: "membership-worker",
        fencingToken: claim.fencingToken,
        state,
        groupVisibility: "private",
        joinPolicy: state === "awaiting_approval" ? "request" : state === "awaiting_invite" ? "invite" : "free",
        now: claimAt + 1,
      });
      await t.mutation(internal.communityTelemetry.releaseLease, {
        integrationId,
        collectorAccountId: accountId,
        workerId: "membership-worker",
        fencingToken: claim.fencingToken,
        now: claimAt + 2,
      });
      const deferredUntil = (await t.run((ctx) => ctx.db.get(integrationId)))?.nextPollAt;
      assert.equal(deferredUntil, claimAt + 1 + 3 * 60_000);
      assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
        collectorAccountId: accountId,
        workerId: "early-worker",
        now: deferredUntil! - 1,
      }), []);
      assert.equal((await t.mutation(internal.communityTelemetry.claimDueAssignments, {
        collectorAccountId: accountId,
        workerId: "due-worker",
        now: deferredUntil,
      })).length, 1);
    }
  });

  it("binds lease operations to the authenticated collector account and trusted server time", async () => {
    const t = convexTest({ schema, modules });
    await seedCommunity(t);
    const firstAccountId = await registerAccount(t, 3, 1);
    const secondAccountId = await registerAccount(t, 3, 2);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public",
      joinPolicy: "free",
    });
    const claimAt = Date.now() + 1_000;
    const [claim] = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: firstAccountId,
      workerId: "isolated-worker",
      leaseMs: 30_000,
      now: claimAt,
    });
    assert.ok(claim);

    const poll = {
      integrationId,
      workerId: "isolated-worker",
      fencingToken: claim.fencingToken,
      pollId: "account-isolation",
      observedAt: claimAt + 1_000,
      collectorVersion: "test-v1",
      source: "first_party" as const,
      groupMemberCount: 10,
      instances: [],
      nextPollAt: claimAt + 60_000,
    };
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      collectorAccountId: secondAccountId,
      now: claimAt + 2_000,
    }), /lease is stale/);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      collectorAccountId: firstAccountId,
      now: claimAt + 31_000,
    }), /lease is stale/);
  });

  it("starts a new session after reconnect and backfills a world discovered later", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    const accountId = await registerAccount(t);
    const vrchatGroupId = "grp_00000000-0000-4000-8000-000000000001";
    const vrchatWorldId = "wrld_00000000-0000-4000-8000-000000000001";
    const providerInstanceId = `12345~group(${vrchatGroupId})`;
    const providerLocation = `${vrchatWorldId}:${providerInstanceId}`;
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId,
      groupVisibility: "public",
      joinPolicy: "free",
    });
    const oldSessionId = await t.run(async (ctx) => {
      const integration = await ctx.db.get(integrationId);
      assert.ok(integration);
      const openedAt = integration.telemetryEpochStartedAt ?? integration.createdAt;
      const sessionId = await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId,
        providerInstanceId,
        providerLocation,
        vrchatWorldId,
        source: "first_party",
        state: "open",
        openedAt,
        lastObservedAt: openedAt,
        consecutiveMisses: 0,
        updatedAt: openedAt,
      });
      await ctx.db.patch(integrationId, {
        state: "disconnected",
        assignedCollectorAccountId: undefined,
        nextPollAt: undefined,
        disconnectedAt: openedAt,
        updatedAt: openedAt,
      });
      await ctx.db.patch(accountId, { assignedGroupCount: 0, updatedAt: openedAt });
      return sessionId;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId,
      groupVisibility: "public",
      joinPolicy: "free",
    }), integrationId);
    const integration = await t.run((ctx) => ctx.db.get(integrationId));
    assert.ok(integration?.telemetryEpochStartedAt);
    const claimAt = integration.telemetryEpochStartedAt + 1_000;
    const [claim] = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId,
      workerId: "reconnect-worker",
      now: claimAt,
    });
    assert.ok(claim);
    const poll = {
      integrationId,
      collectorAccountId: accountId,
      workerId: "reconnect-worker",
      fencingToken: claim.fencingToken,
      collectorVersion: "test-v1",
      source: "first_party" as const,
      groupMemberCount: 10,
      instances: [{ providerInstanceId, providerLocation, vrchatWorldId, population: 4 }],
      nextPollAt: claimAt + 60_000,
    };
    await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      pollId: "reconnect-poll-1",
      observedAt: claimAt + 1_000,
      now: claimAt + 1_000,
    });
    const newSession = await t.run(async (ctx) => {
      const sessions = await ctx.db
        .query("instanceSessions")
        .withIndex("by_integrationId_providerLocation_state_openedAt", (query) =>
          query
            .eq("integrationId", integrationId)
            .eq("providerLocation", providerLocation)
            .eq("state", "open")
            .gte("openedAt", integration.telemetryEpochStartedAt!),
        )
        .collect();
      assert.equal(sessions.length, 1);
      return sessions[0]!;
    });
    assert.notEqual(newSession._id, oldSessionId);
    assert.ok(newSession.openedAt >= integration.telemetryEpochStartedAt);
    assert.equal(newSession.worldId, undefined);

    const worldId = await t.run((ctx) => ctx.db.insert("worlds", {
      slug: "late-world",
      displayName: "Late World",
      sortName: "late world",
      tags: [],
      vrchatWorldId,
      visibilityStatus: "public",
      platformCompatibility: [],
      media: [],
      creatorAttributions: [],
      outboundLinks: [],
      publicationState: "published",
      creationSource: "self",
      updatedAt: claimAt + 2_000,
    }));
    await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      pollId: "reconnect-poll-2",
      observedAt: claimAt + 2_000,
      now: claimAt + 2_000,
    });
    assert.equal((await t.run((ctx) => ctx.db.get(newSession._id)))?.worldId, worldId);
  });

  it("fences stale workers, deduplicates polls, compacts heartbeats, and closes missing instances", async () => {
    const t = convexTest({ schema, modules });
    await seedCommunity(t);
    const accountId = await registerAccount(t);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "private",
      joinPolicy: "request",
    });
    const rollupStart = Math.ceil(Date.now() / (60 * 60_000)) * 60 * 60_000;
    const claimAt = rollupStart + 1_000;
    const firstClaims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId,
      workerId: "worker-one",
      now: claimAt,
    });
    assert.equal(firstClaims.length, 1);
    assert.equal(firstClaims[0]?.fencingToken, 1);

    const poll = {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker-one",
      fencingToken: 1,
      collectorVersion: "test-v1",
      source: "first_party" as const,
      groupMemberCount: 100,
      nextPollAt: claimAt + 60_000,
      now: claimAt + 1_000,
    };
    const first = await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      pollId: "poll-1",
      observedAt: claimAt + 1_000,
      instances: [{
        providerInstanceId: "12345~group(grp_00000000-0000-4000-8000-000000000001)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000001:12345~group(grp_00000000-0000-4000-8000-000000000001)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        population: 12,
      }, {
        providerInstanceId: "12345~group(grp_00000000-0000-4000-8000-000000000001)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000002:12345~group(grp_00000000-0000-4000-8000-000000000001)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000002",
        population: 5,
      }],
    });
    assert.equal(first.duplicate, false);
    await t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless", metric: "currentPopulation", enabled: true,
    });
    const publicCurrent = await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: claimAt + 2_000,
    });
    assert.equal(publicCurrent?.currentPopulation?.value, 17);
    assert.equal("groupMemberCount" in publicCurrent!, false);
    const publicAtQuietCadence = await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: claimAt + 5 * 60_000,
    });
    assert.equal(publicAtQuietCadence?.freshness, "current");
    assert.equal(publicAtQuietCadence?.currentPopulation?.value, 17);
    const publicStale = await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: claimAt + 7 * 60_000,
    });
    assert.equal(publicStale?.freshness, "stale");
    assert.equal("currentPopulation" in publicStale!, false);
    assert.equal((await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      pollId: "poll-1",
      observedAt: claimAt + 1_000,
      instances: [],
    })).duplicate, true);

    await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll, pollId: "poll-2", observedAt: claimAt + 61_000, instances: [],
    });
    await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll, pollId: "poll-3", observedAt: claimAt + 121_000, instances: [],
    });
    await t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      ...poll,
      pollId: "poll-4",
      observedAt: claimAt + 181_000,
      instances: [{
        providerInstanceId: "12345~group(grp_00000000-0000-4000-8000-000000000001)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000001:12345~group(grp_00000000-0000-4000-8000-000000000001)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        population: 3,
      }],
    });
    const compacted = await t.run(async (ctx) => ({
      population: await ctx.db.query("communityPopulationObservations").collect(),
      members: await ctx.db.query("communityMemberCountObservations").collect(),
      sessions: await ctx.db.query("instanceSessions").collect(),
    }));
    assert.deepEqual(compacted.population.map((point) => point.totalPopulation), [17, 0, 0, 3]);
    assert.equal(compacted.members.length, 1);
    assert.equal(compacted.sessions.length, 3);
    assert.equal(compacted.sessions.filter((session) => session.providerInstanceId.startsWith("12345")).length, 3);
    assert.equal(new Set(compacted.sessions.map((session) => session.providerLocation)).size, 2);
    assert.equal(compacted.sessions.filter((session) => session.state === "closed").length, 2);

    const rollupId = await t.mutation(internal.communityTelemetry.recomputeRollup, {
      communityProfileId: (await t.run((ctx) => ctx.db.query("profiles").withIndex("by_slug", (query) => query.eq("slug", "faceless")).unique()))!._id,
      grain: "hour",
      bucketStartAt: rollupStart,
      bucketEndAt: rollupStart + 60 * 60_000,
      now: claimAt + 182_000,
    });
    const initialRollup = await t.run((ctx) => ctx.db.get(rollupId));
    assert.equal(initialRollup?.peakConcurrency, 17);
    await t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless", metric: "populationHistory", enabled: true,
    });
    const publicHistory = await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: claimAt + 182_000,
    });
    assert.equal(publicHistory?.populationHistory?.length, 1);
    assert.equal("groupMemberCount" in publicHistory!.populationHistory![0]!, false);
    assert.equal("groupMemberGrowth" in publicHistory!.populationHistory![0]!, false);
    await t.run((ctx) => ctx.db.insert("communityPopulationObservations", {
      integrationId,
      idempotencyKey: "late-poll",
      totalPopulation: 20,
      activeInstanceCount: 2,
      worldDistribution: [],
      observedAt: claimAt + 30_000,
      source: "first_party",
      collectorVersion: "test-v1",
      coverageState: "observed",
      fencingToken: 1,
    }));
    const recomputedId = await t.mutation(internal.communityTelemetry.recomputeRollup, {
      communityProfileId: initialRollup!.communityProfileId,
      grain: "hour",
      bucketStartAt: rollupStart,
      bucketEndAt: rollupStart + 60 * 60_000,
      now: claimAt + 183_000,
    });
    assert.equal(recomputedId, rollupId);
    assert.equal((await t.run((ctx) => ctx.db.get(rollupId)))?.peakConcurrency, 20);

    await t.mutation(internal.communityTelemetry.releaseLease, {
      integrationId, collectorAccountId: accountId, workerId: "worker-one", fencingToken: 1, now: claimAt + 182_000,
    });
    await t.run(async (ctx) => ctx.db.patch(integrationId, { nextPollAt: claimAt + 182_000 }));
    const secondClaims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId,
      workerId: "worker-two",
      now: claimAt + 183_000,
    });
    assert.equal(secondClaims[0]?.fencingToken, 2);
    await assert.rejects(
      t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
        ...poll, pollId: "stale-poll", observedAt: claimAt + 184_000, instances: [],
      }),
      /lease is stale/,
    );
    const health = await t.query(internal.communityTelemetry.fleetHealth, {});
    assert.equal(JSON.stringify(health).includes("secret:telemetry"), false);
    assert.equal(JSON.stringify(health).includes("a".repeat(64)), false);
    const removed = await t.mutation(internal.communityTelemetry.compactRawTelemetry, {
      integrationId,
      rawBeforeAt: rollupStart + 60 * 60_000,
      limit: 1,
    });
    assert.equal(removed.aggregateDeleted, 1);
    assert.equal(removed.instanceDeleted, 0);
    assert.equal(removed.isDone, false);
    await finishImmediateSchedules(t);
    const retainedRaw = await t.run(async (ctx) => ({
      aggregate: await ctx.db.query("communityPopulationObservations")
        .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integrationId).lt("observedAt", rollupStart + 60 * 60_000))
        .collect(),
      instances: await ctx.db.query("instancePopulationObservations")
        .withIndex("by_integrationId_observedAt", (query) => query.eq("integrationId", integrationId).lt("observedAt", rollupStart + 60 * 60_000))
        .collect(),
    }));
    assert.equal(retainedRaw.aggregate.length, 0);
    assert.equal(retainedRaw.instances.length, 0);
    await t.withIdentity(identity).mutation(api.communityTelemetry.disconnectGroup, { communitySlug: "faceless" });
    assert.equal(await t.query(api.communityTelemetry.getPublicForCommunity, { communitySlug: "faceless", now: claimAt + 125_000 }), null);
    await assert.rejects(t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless", metric: "currentPopulation", enabled: true,
    }), /disconnecting or disconnected/);
    const cleanupClaims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker-three", now: claimAt + 185_000,
    });
    assert.equal(cleanupClaims[0]?.state, "disconnecting");
    assert.equal(cleanupClaims[0]?.fencingToken, 3);
    await t.mutation(internal.communityTelemetry.recordMembershipResult, {
      integrationId, collectorAccountId: accountId, workerId: "worker-three", fencingToken: 3, state: "disconnected",
      groupVisibility: "private", joinPolicy: "request", detail: "service_account_left_group", now: claimAt + 186_000,
    });
    const account = await t.run((ctx) => ctx.db.get(accountId));
    assert.equal(account?.assignedGroupCount, 0);
    assert.equal((await t.run((ctx) => ctx.db.get(integrationId)))?.assignedCollectorAccountId, undefined);
  });

  it("uses half-open rollup windows and keeps event suggestions private until review", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    await registerAccount(t);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "private",
      joinPolicy: "request",
    });
    const dayStart = Date.UTC(2030, 0, 2);
    const seeded = await t.run(async (ctx) => {
      const worldId = await ctx.db.insert("worlds", {
        slug: "telemetry-world",
        displayName: "Telemetry World",
        sortName: "telemetry world",
        tags: [],
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        visibilityStatus: "public",
        platformCompatibility: [],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "self",
        updatedAt: dayStart,
      });
      const eventId = await ctx.db.insert("events", {
        slug: "telemetry-event",
        title: "Telemetry Event",
        sortTitle: "telemetry event",
        startAt: dayStart + 60_000,
        endAt: dayStart + 4 * 60_000,
        communityProfileId,
        sourceType: "manual",
        sourceLabel: "test",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: dayStart,
        updatedAt: dayStart,
      });
      const conflictingEventId = await ctx.db.insert("events", {
        slug: "other-event",
        title: "Other Event",
        sortTitle: "other event",
        startAt: dayStart + 60_000,
        endAt: dayStart + 4 * 60_000,
        communityProfileId,
        sourceType: "manual",
        sourceLabel: "test",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: dayStart,
        updatedAt: dayStart,
      });
      const draftEventId = await ctx.db.insert("events", {
        slug: "draft-telemetry-event",
        title: "Private Draft Event",
        sortTitle: "private draft event",
        startAt: dayStart + 60_000,
        endAt: dayStart + 4 * 60_000,
        communityProfileId,
        sourceType: "manual",
        sourceLabel: "test",
        eventStatus: "scheduled",
        publicationState: "draft_private",
        updatedAt: dayStart,
      });
      await ctx.db.insert("eventWorlds", {
        eventId,
        worldId,
        eventStartAt: dayStart + 60_000,
        eventEndAt: dayStart + 4 * 60_000,
        eventPublicationState: "published",
        eventStatus: "scheduled",
        sourceType: "manual",
        confidence: 1,
        confirmationState: "confirmed",
        confirmedAt: dayStart,
        updatedAt: dayStart,
      });
      const sessions = [];
      for (const [index, providerInstanceId] of ["one", "two", "three"].entries()) {
        sessions.push(await ctx.db.insert("instanceSessions", {
          integrationId,
          communityProfileId,
          providerInstanceId: `${providerInstanceId}~group(grp_example)`,
          providerLocation: `wrld_00000000-0000-4000-8000-000000000001:${providerInstanceId}~group(grp_example)`,
          vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
          worldId,
          source: "first_party",
          state: "closed",
          openedAt: dayStart + 60_000 + index,
          lastObservedAt: dayStart + 3 * 60_000,
          closedAt: dayStart + 4 * 60_000,
          consecutiveMisses: 2,
          updatedAt: dayStart + 4 * 60_000,
        }));
      }
      await ctx.db.insert("communityPopulationObservations", {
        integrationId, idempotencyKey: "inside-day", totalPopulation: 5, activeInstanceCount: 1,
        worldDistribution: [], observedAt: dayStart + 1_000, source: "first_party",
        collectorVersion: "test-v1", coverageState: "observed", fencingToken: 1,
      });
      await ctx.db.insert("communityPopulationObservations", {
        integrationId, idempotencyKey: "next-day", totalPopulation: 99, activeInstanceCount: 1,
        worldDistribution: [], observedAt: dayStart + 24 * 60 * 60_000, source: "first_party",
        collectorVersion: "test-v1", coverageState: "observed", fencingToken: 1,
      });
      await ctx.db.insert("communityMemberCountObservations", {
        integrationId, communityProfileId, idempotencyKey: "member-inside", vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
        memberCount: 100, observedAt: dayStart + 1_000, source: "first_party", collectorVersion: "test-v1", coverageState: "observed", fencingToken: 1,
      });
      await ctx.db.insert("communityMemberCountObservations", {
        integrationId, communityProfileId, idempotencyKey: "member-next-day", vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
        memberCount: 999, observedAt: dayStart + 24 * 60 * 60_000, source: "first_party", collectorVersion: "test-v1", coverageState: "observed", fencingToken: 1,
      });
      for (const [sessionIndex, sessionId] of sessions.slice(0, 2).entries()) {
        for (const [pointIndex, population] of [6 + sessionIndex * 4, 8 + sessionIndex * 5].entries()) {
          await ctx.db.insert("instancePopulationObservations", {
            integrationId, sessionId, idempotencyKey: `session-${sessionIndex}-${pointIndex}`,
            providerInstanceId: `${sessionIndex}~group(grp_example)`, vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
            population, observedAt: dayStart + (pointIndex + 1) * 60_000, source: "first_party",
            collectorVersion: "test-v1", coverageState: "observed", fencingToken: 1,
          });
        }
      }
      return { eventId, conflictingEventId, draftEventId, sessions };
    });

    const dayRollupId = await t.mutation(internal.communityTelemetry.recomputeRollup, {
      communityProfileId, grain: "day", bucketStartAt: dayStart, bucketEndAt: dayStart + 24 * 60 * 60_000, now: dayStart + 1,
    });
    const dayRollup = await t.run((ctx) => ctx.db.get(dayRollupId));
    assert.equal(dayRollup?.peakConcurrency, 5);
    assert.equal(dayRollup?.groupMemberCount, 100);

    await assert.rejects(t.mutation(api.communityTelemetry.associateEventInstance, {
      communitySlug: "faceless", eventId: seeded.eventId, sessionId: seeded.sessions[0]!,
    }), /signed-in user/);
    const confirmedAssociations: Id<"eventInstanceAssociations">[] = [];
    for (const sessionId of seeded.sessions.slice(0, 2)) {
      confirmedAssociations.push(await t.withIdentity(identity).mutation(api.communityTelemetry.associateEventInstance, {
        communitySlug: "faceless", eventId: seeded.eventId, sessionId,
      }));
    }
    const eventRollupId = await t.mutation(internal.communityTelemetry.recomputeRollup, {
      communityProfileId, eventId: seeded.eventId, grain: "event",
      bucketStartAt: dayStart + 60_000, bucketEndAt: dayStart + 4 * 60_000, now: dayStart + 5 * 60_000,
    });
    const eventRollup = await t.run((ctx) => ctx.db.get(eventRollupId));
    assert.equal(eventRollup?.peakConcurrency, 21);
    assert.equal(eventRollup?.activeInstanceCount, 2);
    assert.equal(eventRollup?.worldDistribution[0]?.samples, 4);
    await t.mutation(internal.communityTelemetry.recomputeRollup, {
      communityProfileId, eventId: seeded.draftEventId, grain: "event",
      bucketStartAt: dayStart + 60_000, bucketEndAt: dayStart + 4 * 60_000, now: dayStart + 5 * 60_000,
    });

    await t.mutation(internal.communityTelemetry.suggestEventAssociations, {
      eventId: seeded.eventId,
      now: dayStart + 5 * 60_000,
      limit: 1,
    });
    await finishImmediateSchedules(t);
    const [suggestion] = await t.run((ctx) => ctx.db.query("eventInstanceAssociations")
      .withIndex("by_eventId_state", (query) => query.eq("eventId", seeded.eventId).eq("state", "suggested"))
      .collect());
    assert.ok(suggestion);
    await t.withIdentity(identity).mutation(api.communityTelemetry.reviewAssociationSuggestion, {
      communitySlug: "faceless", associationId: suggestion._id, state: "rejected",
    });
    assert.equal((await t.run((ctx) => ctx.db.get(suggestion._id)))?.state, "rejected");
    assert.deepEqual(await t.mutation(internal.communityTelemetry.suggestEventAssociations, {
      eventId: seeded.eventId,
      now: dayStart + 6 * 60_000,
    }), []);
    await assert.rejects(t.withIdentity(identity).mutation(api.communityTelemetry.associateEventInstance, {
      communitySlug: "faceless", eventId: seeded.conflictingEventId, sessionId: seeded.sessions[0]!,
    }), /already confirmed/);
    await t.withIdentity(identity).mutation(api.communityTelemetry.reviewAssociationSuggestion, {
      communitySlug: "faceless", associationId: confirmedAssociations[0]!, state: "rejected",
    });
    await finishImmediateSchedules(t);
    const recomputedEventRollup = await t.run((ctx) => ctx.db.get(eventRollupId));
    assert.equal(recomputedEventRollup?.peakConcurrency, 13);
    assert.equal(recomputedEventRollup?.activeInstanceCount, 1);

    await t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless", metric: "eventRecaps", enabled: true,
    });
    const publicTelemetry = await t.query(api.communityTelemetry.getPublicForCommunity, { communitySlug: "faceless", now: dayStart + 5 * 60_000 });
    assert.equal(publicTelemetry?.eventRecaps?.length, 1);
    assert.equal(publicTelemetry?.eventRecaps?.[0]?.event?.title, "Telemetry Event");
    assert.equal(publicTelemetry?.eventRecaps?.[0]?.durationMinutes, 3);
    assert.equal("groupMemberCount" in publicTelemetry!.eventRecaps![0]!, false);
    assert.equal("groupMemberGrowth" in publicTelemetry!.eventRecaps![0]!, false);
    assert.equal("currentPopulation" in publicTelemetry!, false);
    await t.withIdentity(identity).mutation(api.communityTelemetry.reviewAssociationSuggestion, {
      communitySlug: "faceless", associationId: confirmedAssociations[1]!, state: "rejected",
    });
    await finishImmediateSchedules(t);
    assert.equal(await t.run((ctx) => ctx.db.get(eventRollupId)), null);
    assert.deepEqual((await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: dayStart + 5 * 60_000,
    }))?.eventRecaps, []);
    await t.run((ctx) => ctx.db.patch(communityProfileId, { publicSurfacingState: "opted_out" }));
    assert.equal(await t.query(api.communityTelemetry.getPublicForCommunity, {
      communitySlug: "faceless", now: dayStart + 5 * 60_000,
    }), null);
  });

  it("pages recent event work to refresh confirmed rollups and create suggestions", async () => {
    const t = convexTest({ schema, modules });
    const communityProfileId = await seedCommunity(t);
    await registerAccount(t);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public",
      joinPolicy: "free",
    });
    const eventNow = await t.run(async (ctx) => {
      const integration = await ctx.db.get(integrationId);
      assert.ok(integration);
      return (integration.telemetryEpochStartedAt ?? integration.createdAt) + 3 * 60 * 60_000;
    });
    const seeded = await t.run(async (ctx) => {
      const worldId = await ctx.db.insert("worlds", {
        slug: "event-work-world",
        displayName: "Event Work World",
        sortName: "event work world",
        tags: [],
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        visibilityStatus: "public",
        platformCompatibility: [],
        media: [],
        creatorAttributions: [],
        outboundLinks: [],
        publicationState: "published",
        creationSource: "self",
        updatedAt: eventNow,
      });
      const createEvent = (slug: string, startAt: number) => ctx.db.insert("events", {
        slug,
        title: slug,
        sortTitle: slug,
        startAt,
        endAt: startAt + 30 * 60_000,
        communityProfileId,
        sourceType: "manual" as const,
        sourceLabel: "test",
        eventStatus: "scheduled" as const,
        publicationState: "published" as const,
        publishedAt: eventNow,
        updatedAt: eventNow,
      });
      await createEvent("first-unassociated", eventNow - 2 * 60 * 60_000);
      const confirmedEventId = await createEvent("second-confirmed", eventNow - 60 * 60_000);
      const suggestionEventId = await createEvent("third-suggestion", eventNow - 30 * 60_000);
      await ctx.db.insert("eventWorlds", {
        eventId: suggestionEventId,
        worldId,
        eventStartAt: eventNow - 30 * 60_000,
        eventEndAt: eventNow,
        eventPublicationState: "published",
        eventStatus: "scheduled",
        sourceType: "manual",
        confidence: 1,
        confirmationState: "confirmed",
        confirmedAt: eventNow,
        updatedAt: eventNow,
      });
      const confirmedSessionId = await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId,
        providerInstanceId: "confirmed~group(grp_example)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000001:confirmed~group(grp_example)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        worldId,
        source: "first_party",
        state: "closed",
        openedAt: eventNow - 60 * 60_000,
        lastObservedAt: eventNow - 45 * 60_000,
        closedAt: eventNow - 30 * 60_000,
        consecutiveMisses: 2,
        updatedAt: eventNow - 30 * 60_000,
      });
      const suggestionSessionId = await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId,
        providerInstanceId: "suggestion~group(grp_example)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000001:suggestion~group(grp_example)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        worldId,
        source: "first_party",
        state: "closed",
        openedAt: eventNow - 40 * 60_000,
        lastObservedAt: eventNow - 10 * 60_000,
        closedAt: eventNow - 10 * 60_000,
        consecutiveMisses: 2,
        updatedAt: eventNow - 10 * 60_000,
      });
      await ctx.db.insert("instancePopulationObservations", {
        integrationId,
        sessionId: confirmedSessionId,
        idempotencyKey: "confirmed-event-point",
        providerInstanceId: "confirmed~group(grp_example)",
        vrchatWorldId: "wrld_00000000-0000-4000-8000-000000000001",
        population: 8,
        observedAt: eventNow - 45 * 60_000,
        source: "first_party",
        collectorVersion: "test-v1",
        coverageState: "observed",
        fencingToken: 1,
      });
      await ctx.db.insert("eventInstanceAssociations", {
        eventId: confirmedEventId,
        sessionId: confirmedSessionId,
        communityProfileId,
        source: "manual",
        confidence: 1,
        state: "confirmed",
        createdAt: eventNow,
        updatedAt: eventNow,
      });
      return { confirmedEventId, suggestionEventId, suggestionSessionId };
    });

    const firstPage = await t.mutation(
      internal.communityTelemetry.scheduleTelemetryEventWorkForCommunity,
      { communityProfileId, now: eventNow, limit: 1 },
    );
    assert.equal(firstPage.events, 1);
    assert.equal(firstPage.isDone, false);
    await finishImmediateSchedules(t);
    const result = await t.run(async (ctx) => ({
      confirmedRollup: await ctx.db.query("communityTelemetryRollups")
        .withIndex("by_eventId_rollupVersion", (query) =>
          query.eq("eventId", seeded.confirmedEventId).eq("rollupVersion", "community-telemetry-v1"),
        )
        .first(),
      suggestion: await ctx.db.query("eventInstanceAssociations")
        .withIndex("by_eventId_state", (query) =>
          query.eq("eventId", seeded.suggestionEventId).eq("state", "suggested"),
        )
        .first(),
    }));
    assert.equal(result.confirmedRollup?.peakConcurrency, 8);
    assert.equal(result.suggestion?.sessionId, seeded.suggestionSessionId);
  });

  it("pages rollup scheduling across every connected integration", async () => {
    const t = convexTest({ schema, modules });
    const lastCommunityProfileId = await t.run(async (ctx) => {
      let lastProfileId: Id<"profiles"> | undefined;
      for (let index = 0; index < 201; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const communityProfileId = await ctx.db.insert("profiles", {
          slug: `telemetry-${suffix}`,
          displayName: `Telemetry ${suffix}`,
          sortName: `telemetry ${suffix}`,
          aliases: [],
          tags: [],
          claimState: "claimed_verified",
          publicationState: "published",
          publicSurfacingState: "public",
          creationSource: "self",
          updatedAt: NOW,
          profileType: "community",
          community: { categoryTags: [] },
        });
        await ctx.db.insert("communityVrchatIntegrations", {
          communityProfileId,
          vrchatGroupId: `grp_schedule_${suffix}`,
          groupVisibility: "public",
          joinPolicy: "free",
          state: "active",
          killSwitchEnabled: false,
          requestsPerMinute: 4,
          leaseGeneration: 0,
          publicMetrics: {
            currentPopulation: false,
            populationHistory: false,
            groupMemberCount: false,
            groupMemberGrowth: false,
            eventRecaps: false,
          },
          consecutiveFailures: 0,
          createdAt: NOW,
          updatedAt: NOW,
        });
        lastProfileId = communityProfileId;
      }
      return lastProfileId!;
    });

    const firstPage = await t.mutation(internal.communityTelemetry.scheduleTelemetryRollups, { now: NOW });
    assert.equal(firstPage.integrations, 200);
    assert.equal(firstPage.isDone, false);
    await finishImmediateSchedules(t);
    const lastRollups = await t.run((ctx) => ctx.db.query("communityTelemetryRollups")
      .withIndex("by_communityProfileId_grain_bucketStartAt", (query) => query.eq("communityProfileId", lastCommunityProfileId))
      .collect());
    assert.deepEqual(new Set(lastRollups.map((rollup) => rollup.grain)), new Set(["hour", "day"]));
  });

  it("reserves account headroom and turns fleet or account failures into honest gaps", async () => {
    const t = convexTest({ schema, modules });
    await seedCommunity(t);
    await seedCommunity(t, "second-community");
    const accountId = await registerAccount(t, 2);
    const integrationId = await t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
      communitySlug: "faceless",
      vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public",
      joinPolicy: "free",
    });
    const claimAt = Date.now() + 1_000;
    await assert.rejects(
      t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
        communitySlug: "second-community",
        vrchatGroupId: "grp_00000000-0000-4000-8000-000000000002",
        groupVisibility: "public",
        joinPolicy: "free",
      }),
      /reserved capacity/,
    );
    await t.mutation(internal.communityTelemetry.setIntegrationKillSwitch, {
      integrationId, enabled: true, reason: "test", now: claimAt,
    });
    assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker", now: claimAt,
    }), []);
    await t.mutation(internal.communityTelemetry.setIntegrationKillSwitch, {
      integrationId, enabled: false, now: claimAt + 1,
    });
    await t.mutation(internal.communityTelemetry.setCollectorAccountState, {
      collectorAccountId: accountId, state: "ready", killSwitchEnabled: true, now: claimAt + 2,
    });
    assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker", now: claimAt + 2,
    }), []);
    await t.mutation(internal.communityTelemetry.setCollectorAccountState, {
      collectorAccountId: accountId, state: "ready", killSwitchEnabled: false, now: claimAt + 3,
    });
    await t.mutation(internal.communityTelemetry.configureFleet, {
      killSwitchEnabled: true, globalRequestsPerMinute: 20, now: claimAt + 4,
    });
    assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker", now: claimAt + 4,
    }), []);
    await t.mutation(internal.communityTelemetry.configureFleet, {
      killSwitchEnabled: false, globalRequestsPerMinute: 20, now: claimAt + 5,
    });
    const claims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker", now: claimAt + 5,
    });
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.requestsPerMinute, 4);
    const budgetAt = claimAt + 6;
    await t.mutation(internal.communityTelemetry.configureFleet, {
      killSwitchEnabled: false, globalRequestsPerMinute: 3, now: budgetAt,
    });
    const firstReservation = await t.mutation(internal.communityTelemetry.reserveRequestBudget, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      requestCount: 2,
      now: budgetAt,
    });
    assert.equal(firstReservation.granted, true);
    const exhaustedReservation = await t.mutation(internal.communityTelemetry.reserveRequestBudget, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      requestCount: 2,
      now: budgetAt + 1,
    });
    assert.equal(exhaustedReservation.granted, false);
    assert.equal(exhaustedReservation.reason, "budget_exhausted");
    const counters = await t.run((ctx) => ctx.db.query("collectorRequestBudgetCounters").collect());
    assert.equal(counters.length, 3);
    assert.ok(counters.every((counter) => counter.requestCount === 2));
    await t.mutation(internal.communityTelemetry.deferAssignment, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      nextPollAt: budgetAt + 10 * 60_000,
      now: budgetAt + 2,
    });
    assert.equal(
      (await t.run((ctx) => ctx.db.get(integrationId)))?.nextPollAt,
      budgetAt + 2 + 5 * 60_000,
    );
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      pollId: "malformed",
      observedAt: claimAt + 6,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [{ providerInstanceId: "123", providerLocation: "wrld_example:123", vrchatWorldId: "wrld_example", population: -1 }],
      nextPollAt: claimAt + 60_000,
    }), /malformed/);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      pollId: "control-character-world",
      observedAt: claimAt + 6,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [{
        providerInstanceId: "123",
        providerLocation: "wrld_example\nforged:123",
        vrchatWorldId: "wrld_example\nforged",
        population: 1,
      }],
      nextPollAt: claimAt + 60_000,
    }), /malformed/);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      pollId: "legacy-person-bearing-location",
      observedAt: claimAt + 6,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [{
        providerInstanceId: "123~hidden(legacy-user-id)",
        providerLocation: "wrld_example:123~hidden(legacy-user-id)",
        vrchatWorldId: "wrld_example",
        population: 1,
      }],
      nextPollAt: claimAt + 60_000,
    }), /malformed/);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      pollId: "person-bearing-location",
      observedAt: claimAt + 6,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [{
        providerInstanceId: "123~hidden(usr_example)",
        providerLocation: "wrld_example:123~hidden(usr_example)",
        vrchatWorldId: "wrld_example",
        population: 1,
      }],
      nextPollAt: claimAt + 60_000,
    }), /malformed/);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      pollId: "wrong-group-location",
      observedAt: claimAt + 6,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [{
        providerInstanceId: "123~group(grp_other)",
        providerLocation: "wrld_example:123~group(grp_other)",
        vrchatWorldId: "wrld_example",
        population: 1,
      }],
      nextPollAt: claimAt + 60_000,
    }), /malformed/);
    await t.mutation(internal.communityTelemetry.recordPollFailure, {
      integrationId,
      collectorAccountId: accountId,
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      statusClass: "401",
      coverageState: "degraded",
      nextPollAt: claimAt + 120_000,
      backoffUntil: claimAt + 120_000,
      collectorVersion: "test-v1",
      detail: "authorization=Bearer must-not-leak",
      now: claimAt + 7,
    });
    const state = await t.run(async (ctx) => ({
      account: await ctx.db.get(accountId),
      integration: await ctx.db.get(integrationId),
      coverage: await ctx.db.query("collectionCoverageWindows").withIndex("by_integrationId_startedAt", (query) => query.eq("integrationId", integrationId)).collect(),
      leases: await ctx.db.query("collectorAccountLeases").withIndex("by_integrationId_state", (query) => query.eq("integrationId", integrationId).eq("state", "released")).collect(),
    }));
    assert.equal(state.account?.state, "auth_required");
    assert.equal(state.integration?.state, "auth_required");
    assert.equal(state.coverage.at(-1)?.state, "degraded");
    assert.equal(state.leases.length, 1);
    assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "other-worker", now: claimAt + 8,
    }), []);
    const rotatedAccountId = await t.mutation(internal.communityTelemetry.registerCollectorAccount, {
      vrchatUserId: "usr_00000000-0000-4000-8000-000000000001",
      accountAlias: "proof-1",
      secretRef: "arn:aws:secretsmanager:us-east-1:000000000000:secret:telemetry-rotated",
      workerKeyHash: "b".repeat(64),
      capacity: 2,
      reservedHeadroom: 1,
      requestsPerMinute: 30,
      now: claimAt + 9,
    });
    assert.equal(rotatedAccountId, accountId);
    const recovered = await t.run(async (ctx) => ({
      account: await ctx.db.get(accountId),
      integration: await ctx.db.get(integrationId),
    }));
    assert.equal(recovered.account?.credentialGeneration, 2);
    assert.equal(recovered.account?.state, "ready");
    assert.equal(recovered.integration?.state, "connecting");
    const recoveredClaims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "rotated-worker", now: claimAt + 10,
    });
    assert.equal(recoveredClaims[0]?.fencingToken, 2);
  });

  it("serializes capacity allocation and safely reassigns work from a quarantined account", async () => {
    const t = convexTest({ schema, modules });
    await seedCommunity(t);
    await seedCommunity(t, "second-community");
    const firstAccountId = await registerAccount(t, 2);
    const connections = await Promise.allSettled([
      t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
        communitySlug: "faceless",
        vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
        groupVisibility: "private",
        joinPolicy: "request",
      }),
      t.withIdentity(identity).mutation(api.communityTelemetry.connectGroup, {
        communitySlug: "second-community",
        vrchatGroupId: "grp_00000000-0000-4000-8000-000000000002",
        groupVisibility: "private",
        joinPolicy: "request",
      }),
    ]);
    assert.equal(connections.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(connections.filter((result) => result.status === "rejected").length, 1);
    const fulfilled = connections.find((result): result is PromiseFulfilledResult<Id<"communityVrchatIntegrations">> => result.status === "fulfilled")!;
    const integrationId = fulfilled.value;
    const claimAt = Date.now() + 1_000;
    const firstClaim = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: firstAccountId,
      workerId: "first-worker",
      now: claimAt,
    });
    assert.equal(firstClaim[0]?.fencingToken, 1);

    await t.mutation(internal.communityTelemetry.setCollectorAccountState, {
      collectorAccountId: firstAccountId,
      state: "quarantined",
      result: "operator_quarantine",
      now: claimAt + 1_000,
    });
    assert.deepEqual(await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: firstAccountId,
      workerId: "first-worker",
      now: claimAt + 2_000,
    }), []);
    const secondAccountId = await registerAccount(t, 3, 2);
    assert.equal(await t.mutation(internal.communityTelemetry.reassignIntegration, {
      integrationId,
      targetCollectorAccountId: secondAccountId,
      reason: "source_account_quarantined",
      now: claimAt + 3_000,
    }), secondAccountId);
    const reassigned = await t.run(async (ctx) => ({
      integration: await ctx.db.get(integrationId),
      firstAccount: await ctx.db.get(firstAccountId),
      secondAccount: await ctx.db.get(secondAccountId),
      coverage: await ctx.db.query("collectionCoverageWindows")
        .withIndex("by_integrationId_startedAt", (query) => query.eq("integrationId", integrationId))
        .order("desc")
        .first(),
    }));
    assert.equal(reassigned.integration?.assignedCollectorAccountId, secondAccountId);
    assert.equal(reassigned.integration?.state, "connecting");
    assert.equal(reassigned.firstAccount?.assignedGroupCount, 0);
    assert.equal(reassigned.secondAccount?.assignedGroupCount, 1);
    assert.equal(reassigned.coverage?.state, "unknown");
    assert.equal(reassigned.coverage?.reason, "collector_account_reassigned");
    const secondClaim = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: secondAccountId,
      workerId: "second-worker",
      now: claimAt + 4_000,
    });
    assert.equal(secondClaim[0]?.fencingToken, 2);
    await assert.rejects(t.mutation(internal.communityTelemetry.ingestAggregatePoll, {
      integrationId,
      collectorAccountId: firstAccountId,
      workerId: "first-worker",
      fencingToken: 1,
      pollId: "stale-after-reassignment",
      observedAt: claimAt + 5_000,
      collectorVersion: "test-v1",
      source: "first_party",
      groupMemberCount: 10,
      instances: [],
      nextPollAt: claimAt + 60_000,
    }), /lease is stale/);

    await t.mutation(internal.communityTelemetry.registerCollectorAccount, {
      vrchatUserId: "usr_00000000-0000-4000-8000-000000000001",
      accountAlias: "proof-1",
      secretRef: "arn:aws:secretsmanager:us-east-1:000000000000:secret:telemetry-recovered",
      workerKeyHash: "c".repeat(64),
      capacity: 2,
      reservedHeadroom: 1,
      requestsPerMinute: 30,
      now: claimAt + 6_000,
    });
    assert.equal((await t.run((ctx) => ctx.db.get(firstAccountId)))?.state, "quarantined");
  });

  it("treats malformed collector account IDs as unauthorized", async () => {
    const t = convexTest({ schema, modules });
    assert.equal(await t.query(internal.communityTelemetry.collectorWorkerAuthorization, {
      collectorAccountId: "not-a-convex-id",
    }), null);
  });
});
