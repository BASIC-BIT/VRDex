import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { proofShareOf } from "../../convex/communityTelemetry";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
  "../../convex/claimAnalytics.ts": () => import("../../convex/claimAnalytics"),
  "../../convex/claimAnalyticsDelivery.ts": () => import("../../convex/claimAnalyticsDelivery"),
  "../../convex/http.ts": () => import("../../convex/http"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

const HOUR = 3_600_000;

async function seedCollector(ctx: never, alias: string, now: number) {
  const db = (ctx as unknown as { db: { insert: (t: string, v: unknown) => Promise<string> } }).db;

  return await db.insert("collectorAccounts", {
    vrchatUserId: `usr_${alias}`,
    accountAlias: alias,
    state: "ready",
    capacity: 100,
    reservedHeadroom: 15,
    assignedGroupCount: 0,
    requestsPerMinute: 30,
    secretRef: `secret://${alias}`,
    workerKeyHash: "a".repeat(64),
    lastWorkerReleaseSha: "a".repeat(40),
    credentialGeneration: 1,
    killSwitchEnabled: false,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedAttempt(
  ctx: never,
  { targetType, now, lastCheckedAt }: { targetType: string; now: number; lastCheckedAt?: number },
) {
  const db = (ctx as unknown as {
    db: { insert: (t: string, v: unknown) => Promise<string> };
  }).db;
  const clerkUserId = newClerkUserId();
  const userId = await db.insert("users", {
    clerkUserId: clerkUserId,
    email: `${targetType}-${Math.round(now)}-${Math.random()}@example.test`,
    emailVerificationTime: now,
  });
  const profileId = await db.insert("profiles", {
    profileType: "person",
    slug: `p-${Math.random().toString(36).slice(2, 12)}`,
    displayName: "Proof Target",
    sortName: "proof target",
    aliases: [],
    tags: [],
    claimState: "unclaimed",
    publicationState: "published",
    publicSurfacingState: "public",
    creationSource: "concierge",
    person: { roleTags: [] },
    updatedAt: now,
  });

  return await db.insert("profileVerificationAttempts", {
    profileId,
    userId,
    method: targetType === "vrclinking" ? "vrclinking_attestation" : "vrchat_user_proof",
    targetType,
    targetExternalId: `target-${Math.random().toString(36).slice(2, 10)}`,
    proofCode: "VRDEX-AAAAAAAAAAAA",
    state: "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 24 * HOUR,
    ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
  });
}

async function webSessionIdentity(ctx: never, userId: string) {
  const db = (ctx as unknown as {
    db: { get: (id: string) => Promise<{ clerkUserId: string } | null> };
  }).db;
  // Clerk owns sessions, so the subject is the user's Clerk id; read it back
  // rather than fabricating a session row that no longer exists.
  const user = await db.get(userId);

  if (user === null) {
    throw new Error("Seeded user was not found.");
  }

  return {
    subject: user.clerkUserId,
    emailVerified: true,
    issuer: "test",
    tokenIdentifier: `test|${user.clerkUserId}`,
  };
}

describe("collector proof check queue", () => {
  it("separates dispatch from a completed provider check on the attempt", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => ({
      collectorAccountId: await seedCollector(ctx as never, "lifecycle", now),
      attemptId: await seedAttempt(ctx as never, { targetType: "vrchat_user", now }),
    }));
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.attemptId, {
        analyticsJourneyId: "3f77bd1c-4e10-4fc5-a2cc-0309d3952cf4",
        analyticsEntrySource: "profile",
      });
    });

    const claimed = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId: seeded.collectorAccountId,
      workerId: "worker-lifecycle",
      releaseSha: "b".repeat(40),
      limit: 1,
      now: now + 1,
    });
    assert.equal(claimed.attempts[0]?.attemptId, seeded.attemptId);

    await t.run(async (ctx) => {
      const attempt = await ctx.db.get(seeded.attemptId);
      assert.equal(attempt?.firstDispatchedAt, now + 1);
      assert.equal(attempt?.dispatchCount, 1);
      assert.equal(attempt?.firstCheckAt, undefined);
      assert.equal(attempt?.checkCount, undefined);
      assert.equal((await ctx.db.query("claimAnalyticsOutbox").collect()).length, 0);
    });

    assert.deepEqual(
      await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
        collectorAccountId: seeded.collectorAccountId,
        attemptId: seeded.attemptId,
        found: false,
        releaseSha: "b".repeat(40),
        workerKeyHash: "a".repeat(64),
        now: now + 2,
      }),
      { state: "pending" },
    );

    await t.run(async (ctx) => {
      const attempt = await ctx.db.get(seeded.attemptId);
      assert.equal(attempt?.firstCheckAt, now + 2);
      assert.equal(attempt?.lastCheckOutcome, "not_found");
      assert.equal(attempt?.checkCount, 1);
      const events = await ctx.db
        .query("profileClaimLifecycleEvents")
        .withIndex("by_attemptId_createdAt", (q) => q.eq("attemptId", seeded.attemptId))
        .collect();
      assert.deepEqual(events, []);
      const analytics = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.deepEqual(analytics.map((event) => event.event), ["claim_verification_started"]);
      assert.equal(analytics[0]?.timeToFirstCheckBucket, "under_1m");
    });
  });

  it("reports proof-path readiness for the exact configured collector account", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const releaseSha = "b".repeat(40);
    const collectorAccountId = await t.run(async (ctx) =>
      await seedCollector(ctx as never, "readiness", now),
    );

    assert.equal(
      await t.query(internal.communityTelemetry.collectorProofAvailable, { now }),
      false,
    );
    await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-readiness",
      releaseSha,
      now,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, { requestsPerMinute: 2 });
    });
    assert.equal(
      await t.query(internal.communityTelemetry.collectorProofAvailable, { now }),
      false,
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, { requestsPerMinute: 30 });
      await ctx.db.insert("collectorFleetSettings", {
        key: "global",
        killSwitchEnabled: false,
        globalRequestsPerMinute: 2,
        updatedAt: now,
      });
    });
    assert.equal(
      await t.query(internal.communityTelemetry.collectorProofAvailable, { now }),
      false,
    );
    await t.run(async (ctx) => {
      const fleet = await ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      assert.ok(fleet);
      await ctx.db.patch(fleet._id, { globalRequestsPerMinute: 30 });
    });
    assert.equal(
      await t.query(internal.communityTelemetry.collectorProofAvailable, { now }),
      true,
    );

    const before = await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    });
    assert.equal(before.healthy, false);
    assert.deepEqual(before.issues, ["configured_collector_heartbeat_stale"]);

    assert.deepEqual(
      await t.mutation(internal.communityTelemetry.recordCollectorHeartbeat, {
        collectorAccountId,
        workerId: "worker-readiness",
        releaseSha,
        collectorVersion: "group-telemetry-v1",
        capabilities: ["telemetry_v1", "vrchat_proof_v1"],
        consecutiveControlFailures: 0,
        workerKeyHash: "a".repeat(64),
        now,
      }),
      { recorded: true },
    );
    const ready = await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha.toUpperCase(),
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    });
    assert.deepEqual(ready, {
      healthy: true,
      issues: [],
      freshCollectorCount: 1,
      matchingReleaseCount: 1,
      authRequiredCount: 0,
    });
    const unrelatedCollectorAccountId = await t.run(async (ctx) =>
      await seedCollector(ctx as never, "unrelated-readiness", now),
    );
    await t.mutation(internal.communityTelemetry.recordCollectorHeartbeat, {
      collectorAccountId: unrelatedCollectorAccountId,
      workerId: "worker-unrelated-readiness",
      releaseSha,
      collectorVersion: "group-telemetry-v1",
      capabilities: ["telemetry_v1", "vrchat_proof_v1"],
      consecutiveControlFailures: 0,
      workerKeyHash: "a".repeat(64),
      now,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, { lastWorkerHeartbeatAt: now - 120_001 });
    });
    assert.deepEqual(
      (await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
        collectorAccountId,
        expectedReleaseSha: releaseSha,
        requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
        maxHeartbeatAgeMs: 120_000,
        now,
      })).issues,
      ["configured_collector_heartbeat_stale"],
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, {
        cooldownUntil: now + 5 * 60_000,
        lastWorkerHeartbeatAt: now,
      });
    });
    assert.deepEqual((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    })).issues, ["configured_collector_cooldown_active"]);
    assert.equal((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    })).healthy, true);

    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, {
        cooldownUntil: undefined,
        requestsPerMinute: 2,
      });
    });
    assert.deepEqual((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    })).issues, ["configured_collector_proof_budget_disabled"]);

    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, { requestsPerMinute: 30 });
      const fleet = await ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      assert.ok(fleet);
      await ctx.db.patch(fleet._id, { globalRequestsPerMinute: 2 });
    });
    assert.deepEqual((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    })).issues, ["fleet_proof_budget_disabled"]);

    await t.run(async (ctx) => {
      const fleet = await ctx.db
        .query("collectorFleetSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
      assert.ok(fleet);
      await ctx.db.patch(fleet._id, { globalRequestsPerMinute: 30 });
      await ctx.db.patch(collectorAccountId, {
        lastProofPollReleaseSha: "c".repeat(40),
      });
    });
    assert.deepEqual((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 120_000,
      now,
    })).issues, ["configured_collector_proof_release_mismatch"]);

    await t.run(async (ctx) => {
      await ctx.db.patch(collectorAccountId, {
        lastProofPollReleaseSha: releaseSha,
        lastProofPollAt: now - 120_001,
      });
    });
    assert.deepEqual((await t.query(internal.communityTelemetry.collectorDeploymentReadiness, {
      collectorAccountId,
      expectedReleaseSha: releaseSha,
      requiredCapabilities: ["telemetry_v1", "vrchat_proof_v1"],
      maxHeartbeatAgeMs: 10 * 60_000,
      now,
    })).issues, ["configured_collector_proof_poll_stale"]);
    assert.equal(JSON.stringify(ready).includes("readiness"), false);
  });

  it("authenticates and binds heartbeat identity through the worker HTTP route", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const workerKey = "worker-secret-that-is-at-least-32-bytes";
    const workerKeyHash = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workerKey)),
    )].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "http-heartbeat", now);
      await ctx.db.patch(id as never, { workerKeyHash });
      return id;
    });
    const body = {
      operation: "heartbeat",
      workerId: "worker-http",
      vrchatUserId: "usr_http-heartbeat",
      releaseSha: "c".repeat(40),
      collectorVersion: "group-telemetry-v1",
      capabilities: ["telemetry_v1", "vrchat_proof_v1"],
      consecutiveControlFailures: 0,
    };
    const request = async (authorization: string, requestBody: unknown = body) =>
      await t.fetch("/telemetry/worker", {
        method: "POST",
        headers: {
          authorization: `Bearer ${authorization}`,
          "content-type": "application/json",
          "x-vrdex-collector-account": collectorAccountId,
        },
        body: JSON.stringify(requestBody),
      });

    assert.equal((await request("wrong-secret-that-is-at-least-32-bytes")).status, 401);
    assert.equal((await request(workerKey, { ...body, vrchatUserId: "usr_other" })).status, 401);
    const response = await request(workerKey);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { recorded: true });
    await t.run(async (ctx) => {
      const account = await ctx.db.get(collectorAccountId);
      assert.equal(account?.lastWorkerId, "worker-http");
      assert.equal(account?.lastWorkerReleaseSha, "c".repeat(40));
    });

    const legacyAttemptId = await t.run(async (ctx) =>
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now }),
    );
    const legacyProofClaim = await request(workerKey, {
      operation: "proof_claim",
      workerId: "worker-from-rollback-image",
      vrchatUserId: "usr_http-heartbeat",
      limit: 1,
    });
    assert.equal(legacyProofClaim.status, 200);
    assert.equal((await legacyProofClaim.json()).attempts[0]?.attemptId, legacyAttemptId);
    const legacyProofResult = await request(workerKey, {
      operation: "proof_result",
      workerId: "worker-from-rollback-image",
      vrchatUserId: "usr_http-heartbeat",
      attemptId: legacyAttemptId,
      found: false,
    });
    assert.equal(legacyProofResult.status, 200);
    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("profileClaimLifecycleEvents")
        .withIndex("by_attemptId_createdAt", (q) => q.eq("attemptId", legacyAttemptId))
        .collect();
      assert.ok(events.every((event) => event.workerReleaseSha === undefined));
      assert.equal(
        (await ctx.db.get(collectorAccountId))?.lastWorkerReleaseSha,
        "c".repeat(40),
      );
    });
  });

  it("does not let never-stamped vrclinking attempts starve the queue", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "starve", now);

      // More vrclinking rows than the scan window. These are never stamped, so
      // an implementation that scans all pending rows and filters afterwards
      // sees a window that is entirely vrclinking and returns nothing.
      for (let index = 0; index < 120; index += 1) {
        await seedAttempt(ctx as never, { targetType: "vrclinking", now });
      }

      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });

      return id;
    });

    const result = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-1",
      limit: 5,
      now: now + 1,
    });

    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0]?.targetType, "vrchat_user");
  });

  it("refuses a verdict from a collector the attempt was not served to", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => ({
      claimant: await seedCollector(ctx as never, "claimant", now),
      impostor: await seedCollector(ctx as never, "impostor", now),
    }));

    await t.run(async (ctx) => {
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });
    });

    const claimed = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId: seeded.claimant,
      workerId: "worker-1",
      limit: 5,
      now: now + 1,
    });
    const attemptId = claimed.attempts[0]!.attemptId;

    // A different authorized collector must not be able to attest an attempt it
    // was never given, or one leaked worker key mints verified ownership.
    const impostorResult = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
      collectorAccountId: seeded.impostor,
      attemptId,
      found: true,
      workerKeyHash: "a".repeat(64),
      now: now + 2,
    });
    assert.equal(impostorResult.state, "unauthorized");

    await t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      assert.equal(attempt?.state, "pending");
    });

    const claimantResult = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
      collectorAccountId: seeded.claimant,
      attemptId,
      found: true,
      workerKeyHash: "a".repeat(64),
      now: now + 3,
    });
    assert.equal(claimantResult.state, "verified");
  });

  // `recordVrchatProofVerification` settles an ownership race rather than
  // throwing, deliberately — a throw would have the collector retry an attempt
  // that can never succeed. The catch in `recordProofCheckResult` therefore
  // never sees it, so reporting `verified` regardless told the worker a claim
  // had been granted while the attempt row read `failed`.
  it("reports a lost ownership race to the collector rather than a false success", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "race", now);
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });

      return id;
    });
    const claimed = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-race",
      limit: 1,
      now: now + 1,
    });
    const attemptId = claimed.attempts[0]!.attemptId;

    // Somebody else takes the profile while the code is being looked for.
    await t.run(async (ctx) => {
      const attempt = await ctx.db.get(attemptId);
      const rivalId = await ctx.db.insert("users", {
        clerkUserId: `user_test_${globalThis.crypto.randomUUID()}`,
        email: `rival-${Math.random()}@example.test`,
        emailVerificationTime: now,
      });
      await ctx.db.insert("profileOwners", {
        profileId: attempt!.profileId,
        userId: rivalId,
        roleKey: "owner",
        state: "active",
        grantedAt: now + 1,
        updatedAt: now + 1,
      });
    });

    const result = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
      collectorAccountId,
      attemptId,
      found: true,
      workerKeyHash: "a".repeat(64),
      now: now + 2,
    });

    assert.equal(result.state, "already_owned");
    assert.equal((await t.run(async (ctx) => await ctx.db.get(attemptId)))?.state, "failed");
  });

  // An emergency stop that halts reads but still accepts in-flight verdicts is
  // not a stop: the fleet would keep granting verified ownership.
  it("refuses a verdict once the fleet kill switch is on", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "killswitch", now);
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });

      return id;
    });
    const claimed = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-1",
      limit: 5,
      now: now + 1,
    });
    const attemptId = claimed.attempts[0]!.attemptId;

    await t.run(async (ctx) => {
      await ctx.db.insert("collectorFleetSettings", {
        key: "global",
        killSwitchEnabled: true,
        globalRequestsPerMinute: 30,
        updatedAt: now,
      });
    });

    const result = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
      collectorAccountId,
      attemptId,
      found: true,
      workerKeyHash: "a".repeat(64),
      now: now + 2,
    });

    assert.equal(result.state, "unauthorized");
    await t.run(async (ctx) => {
      assert.equal((await ctx.db.get(attemptId))?.state, "pending");
    });
  });

  // The HTTP layer authenticates before it reads the request body, so a caller
  // can hold that body open across a re-registration. Rotation has to
  // supersede the verdict, or a replaced key still grants ownership.
  it("refuses a verdict carrying a superseded worker key", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "rotated", now);
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });

      return id;
    });
    const claimed = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-rotated",
      limit: 1,
      now: now + 1,
    });
    const attemptId = claimed.attempts[0]!.attemptId;

    const result = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {
      collectorAccountId,
      attemptId,
      found: true,
      // The digest the seeded account no longer holds.
      workerKeyHash: "b".repeat(64),
      now: now + 2,
    });

    assert.equal(result.state, "unauthorized");
    await t.run(async (ctx) => {
      assert.equal((await ctx.db.get(attemptId))?.state, "pending");
    });
  });

  it("rotates attempts by last check so one batch does not repeat", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "rotate", now);

      for (let index = 0; index < 3; index += 1) {
        await seedAttempt(ctx as never, { targetType: "vrchat_user", now });
      }

      return id;
    });

    const first = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-1",
      limit: 2,
      now: now + 1,
    });
    const second = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-1",
      limit: 2,
      now: now + 2,
    });

    assert.equal(first.attempts.length, 2);
    // The first batch is inside its cooldown, so the second call returns only
    // the attempt that has never been checked.
    assert.equal(second.attempts.length, 1);
    const firstIds = new Set(first.attempts.map((attempt) => attempt.attemptId));
    assert.equal(firstIds.has(second.attempts[0]!.attemptId), false);
  });
});

// The collector fleet polls every pending VRChat attempt against one shared
// service-account budget, so an unbounded backlog from a single claimant is the
// same abuse as draining a community's delegated VRC Linking quota.
// A worker's 429 backoff is process-local, and two tasks share one collector
// account, so the sibling would otherwise reclaim the released tail and keep
// sending requests straight through the provider's Retry-After window.
describe("provider rate-limit cooldown", () => {
  it("stops serving proof work to a throttled account", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const collectorAccountId = await t.run(async (ctx) => {
      const id = await seedCollector(ctx as never, "throttled", now);
      await seedAttempt(ctx as never, { targetType: "vrchat_user", now });

      return id;
    });

    const before = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-1",
      limit: 5,
      now: now + 1,
    });
    assert.equal(before.attempts.length, 1);

    const recorded = await t.mutation(internal.communityTelemetry.recordProofRateLimit, {
      workerKeyHash: "a".repeat(64),
      collectorAccountId,
      retryAfterMs: 120_000,
      now: now + 2,
    });
    assert.equal(recorded.recorded, true);

    await t.run(async (ctx) => {
      // Released so a healthy account can take it, rather than parked.
      const attempts = await ctx.db.query("profileVerificationAttempts").collect();
      await ctx.db.patch(attempts[0]!._id, { lastCheckedAt: undefined });
    });

    const during = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-2",
      limit: 5,
      now: now + 3,
    });
    assert.deepEqual(during.attempts, []);

    // The account is still `ready` — this is throughput backoff, not a trust
    // event — so it resumes on its own once the window passes.
    const after = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
      collectorAccountId,
      workerId: "worker-2",
      limit: 5,
      now: now + 2 + 120_000 + 1,
    });
    assert.equal(after.attempts.length, 1);
  });
});

describe("open proof attempt cap", () => {
  it("bounds new attempts per target type but still returns an existing code", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const db = (ctx as unknown as {
        db: { insert: (table: string, value: unknown) => Promise<string> };
      }).db;
      const clerkUserId2 = newClerkUserId();
      const userId = await db.insert("users", {
        clerkUserId: clerkUserId2,
        email: "capped@example.test",
        emailVerificationTime: now,
      });

      for (let index = 0; index < 4; index += 1) {
        await db.insert("profiles", {
          profileType: "person",
          slug: `cap-target-${index}`,
          displayName: `Cap Target ${index}`,
          sortName: `cap target ${index}`,
          aliases: [],
          tags: [],
          claimState: "unclaimed",
          publicationState: "published",
          publicSurfacingState: "public",
          creationSource: "concierge",
          person: { roleTags: [] },
          updatedAt: now,
        });
      }

      return {
        identity: await webSessionIdentity(ctx as never, userId),
      };
    });
    const asClaimant = t.withIdentity(seeded.identity);
    const start = (index: number) =>
      asClaimant.mutation(api.profileClaims.startVrchatProof, {
        profileSlug: `cap-target-${index}`,
        targetType: "vrchat_user" as const,
        targetExternalId: `usr_${"0".repeat(8)}-0000-4000-8000-00000000000${index}`,
      });

    const first = await start(0);
    for (let index = 1; index < 3; index += 1) {
      await start(index);
    }

    // Its own code, not `PROOF_NOT_PENDING`: nothing was created and nothing was
    // resolved, so the copy has to say something the claimant can act on.
    await assert.rejects(() => start(3), /TOO_MANY_OPEN_PROOFS/);

    // Re-requesting an attempt that already exists is a read, not new polling
    // work, so the cap must not lock a claimant out of their own proof code.
    assert.equal((await start(0)).proofCode, first.proofCode);
  });
});


// Proofs run before telemetry, so their share has to leave room for a poll:
// one reserves two requests atomically, and a share that left a single request
// behind spent it and deferred that poll every window.
describe("proof budget share", () => {
  it("never takes the capacity an atomic telemetry poll needs", () => {
    assert.equal(proofShareOf(30), 15);
    assert.equal(proofShareOf(6), 3);
    assert.equal(proofShareOf(4), 2);
    // At the supported minimum the budget serves one workload, and the one
    // holding leases and live integrations is the one that gets it.
    assert.equal(proofShareOf(3), 1);
    assert.equal(proofShareOf(2), 0);
  });
});
