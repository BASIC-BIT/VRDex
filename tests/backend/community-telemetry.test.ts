import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

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
      workerId: "worker-one",
      fencingToken: 1,
      collectorVersion: "test-v1",
      source: "first_party" as const,
      groupMemberCount: 100,
      nextPollAt: claimAt + 60_000,
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
        providerInstanceId: "67890~group(grp_00000000-0000-4000-8000-000000000001)",
        providerLocation: "wrld_00000000-0000-4000-8000-000000000002:67890~group(grp_00000000-0000-4000-8000-000000000001)",
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
    assert.equal(compacted.sessions.filter((session) => session.providerInstanceId.startsWith("12345")).length, 2);
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
      integrationId, workerId: "worker-one", fencingToken: 1, now: claimAt + 182_000,
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
      limit: 100,
    });
    assert.equal(removed.aggregateDeleted, 5);
    assert.equal(removed.instanceDeleted, 3);
    await t.withIdentity(identity).mutation(api.communityTelemetry.disconnectGroup, { communitySlug: "faceless" });
    assert.equal(await t.query(api.communityTelemetry.getPublicForCommunity, { communitySlug: "faceless", now: claimAt + 125_000 }), null);
    const cleanupClaims = await t.mutation(internal.communityTelemetry.claimDueAssignments, {
      collectorAccountId: accountId, workerId: "worker-three", now: claimAt + 185_000,
    });
    assert.equal(cleanupClaims[0]?.state, "disconnecting");
    assert.equal(cleanupClaims[0]?.fencingToken, 3);
    await t.mutation(internal.communityTelemetry.recordMembershipResult, {
      integrationId, workerId: "worker-three", fencingToken: 3, state: "disconnected",
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
        publicationState: "draft_private",
        updatedAt: dayStart,
      });
      await ctx.db.insert("eventWorlds", {
        eventId,
        worldId,
        eventStartAt: dayStart + 60_000,
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
    for (const sessionId of seeded.sessions.slice(0, 2)) {
      await t.withIdentity(identity).mutation(api.communityTelemetry.associateEventInstance, {
        communitySlug: "faceless", eventId: seeded.eventId, sessionId,
      });
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

    const suggestions = await t.mutation(internal.communityTelemetry.suggestEventAssociations, { eventId: seeded.eventId, now: dayStart + 5 * 60_000 });
    assert.equal(suggestions.length, 1);
    assert.equal((await t.run((ctx) => ctx.db.get(suggestions[0]!)))?.state, "suggested");
    await t.withIdentity(identity).mutation(api.communityTelemetry.reviewAssociationSuggestion, {
      communitySlug: "faceless", associationId: suggestions[0]!, state: "confirmed",
    });
    assert.equal((await t.run((ctx) => ctx.db.get(suggestions[0]!)))?.state, "confirmed");
    await assert.rejects(t.withIdentity(identity).mutation(api.communityTelemetry.associateEventInstance, {
      communitySlug: "faceless", eventId: seeded.conflictingEventId, sessionId: seeded.sessions[0]!,
    }), /already confirmed/);

    await t.withIdentity(identity).mutation(api.communityTelemetry.setPublicMetric, {
      communitySlug: "faceless", metric: "eventRecaps", enabled: true,
    });
    const publicTelemetry = await t.query(api.communityTelemetry.getPublicForCommunity, { communitySlug: "faceless", now: dayStart + 5 * 60_000 });
    assert.equal(publicTelemetry?.eventRecaps?.length, 1);
    assert.equal(publicTelemetry?.eventRecaps?.[0]?.event?.title, "Telemetry Event");
    assert.equal(publicTelemetry?.eventRecaps?.[0]?.durationMinutes, 3);
    assert.equal("currentPopulation" in publicTelemetry!, false);
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
      workerId: "worker",
      fencingToken: claims[0]!.fencingToken,
      requestCount: 2,
      now: budgetAt,
    });
    assert.equal(firstReservation.granted, true);
    const exhaustedReservation = await t.mutation(internal.communityTelemetry.reserveRequestBudget, {
      integrationId,
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
});
