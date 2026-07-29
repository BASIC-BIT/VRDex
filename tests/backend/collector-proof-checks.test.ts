import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
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
  const userId = await db.insert("users", {
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

async function webSessionIdentity(ctx: never, userId: string, now: number) {
  const db = (ctx as unknown as { db: { insert: (t: string, v: unknown) => Promise<string> } }).db;
  // The active-session guard resolves the session row named by the subject, so
  // a fabricated `|web-session` suffix no longer authenticates.
  const sessionId = await db.insert("authSessions", { userId, expirationTime: now + 60_000 });

  return {
    subject: `${userId}|${sessionId}`,
    issuer: "test",
    tokenIdentifier: `test|${userId}`,
  };
}

describe("collector proof check queue", () => {
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
      const userId = await db.insert("users", {
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
        identity: await webSessionIdentity(ctx as never, userId, now),
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
