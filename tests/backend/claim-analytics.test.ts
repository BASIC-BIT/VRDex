import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import {
  posthogClaimAnalyticsConfig,
  posthogClaimEvent,
} from "../../convex/claimAnalyticsDelivery";
import { claimAnalyticsContext, enqueueClaimAnalyticsEvent } from "../../convex/_claimAnalytics";
import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/claimAnalytics.ts": () => import("../../convex/claimAnalytics"),
  "../../convex/claimAnalyticsDelivery.ts": () => import("../../convex/claimAnalyticsDelivery"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

const journeyId = "4d36e96e-34d9-4f7e-9fe1-72a98aa13077";

describe("claim analytics outbox", () => {
  it("replaces a malformed client journey id instead of blocking the claim", () => {
    const analytics = claimAnalyticsContext("profile-basicbit", "search");

    assert.notEqual(analytics.journeyId, "profile-basicbit");
    assert.match(
      analytics.journeyId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(analytics.entrySource, "search");
  });

  it("deduplicates a lifecycle milestone and preserves only sanitized dimensions", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();

    await t.run(async (ctx) => {
      const analytics = claimAnalyticsContext(journeyId, "search");
      const milestone = {
        event: "claim_attempt_created" as const,
        profileType: "person" as const,
        method: "vrchat" as const,
        occurredAt: now,
      };
      await enqueueClaimAnalyticsEvent(ctx, analytics, milestone);
      await enqueueClaimAnalyticsEvent(ctx, analytics, milestone);
    });

    const row = await t.run(async (ctx) => {
      const rows = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.equal(rows.length, 1);
      return rows[0];
    });
    const payload = posthogClaimEvent(row!);

    assert.deepEqual(
      Object.keys(payload.properties).sort(),
      [
        "$insert_id",
        "$process_person_profile",
        "distinct_id",
        "entry_source",
        "journey_id",
        "method",
        "profile_type",
      ].sort(),
    );
    assert.equal(payload.properties.journey_id, journeyId);
    assert.equal(JSON.stringify(payload).includes("slug"), false);
    assert.equal(JSON.stringify(payload).includes("proof"), false);
    assert.equal(JSON.stringify(payload).includes("target"), false);
  });

  it("leases one event, dead-letters at the fast retry cap, and recovers it", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const outboxId = await t.run(async (ctx) => await ctx.db.insert("claimAnalyticsOutbox", {
      eventKey: `${journeyId}:claim_resolved`,
      journeyId,
      event: "claim_resolved",
      profileType: "community",
      method: "discord",
      entrySource: "account",
      outcome: "rejected",
      connectionOnly: false,
      timeToResolutionBucket: "under_5m",
      occurredAt: now,
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
    }));

    const claimed = await t.mutation(internal.claimAnalytics.claimNextForDelivery, {});
    assert.equal(claimed.row?._id, outboxId);
    assert.equal(claimed.row?.attemptCount, 1);

    await t.mutation(internal.claimAnalytics.recordDeliveryFailure, { outboxId });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(outboxId);
      assert.equal(row?.state, "pending");
      assert.equal(row?.attemptCount, 1);
      assert.ok((row?.nextAttemptAt ?? 0) > now);
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(outboxId, { state: "delivering", attemptCount: 5 });
    });
    await t.mutation(internal.claimAnalytics.recordDeliveryFailure, { outboxId });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(outboxId);
      assert.equal(row?.state, "failed");
      assert.equal(row?.attemptCount, 5);
    });

    assert.deepEqual(
      await t.mutation(internal.claimAnalytics.recoverUndeliveredDeliveries, {
        recoverDisabled: false,
      }),
      { recoveredCount: 1 },
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.get(outboxId);
      assert.equal(row?.state, "pending");
      assert.equal(row?.attemptCount, 0);
      assert.ok((row?.nextAttemptAt ?? 0) >= now);
    });
  });

  it("recovers disabled deliveries only after configuration returns", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const outboxId = await t.run(async (ctx) => await ctx.db.insert("claimAnalyticsOutbox", {
      eventKey: `${journeyId}:claim_attempt_created`,
      journeyId,
      event: "claim_attempt_created",
      profileType: "person",
      method: "vrchat",
      entrySource: "profile",
      occurredAt: now,
      state: "disabled",
      attemptCount: 1,
      nextAttemptAt: now,
    }));

    assert.deepEqual(
      await t.mutation(internal.claimAnalytics.recoverUndeliveredDeliveries, {
        recoverDisabled: false,
      }),
      { recoveredCount: 0 },
    );
    assert.deepEqual(
      await t.mutation(internal.claimAnalytics.recoverUndeliveredDeliveries, {
        recoverDisabled: true,
      }),
      { recoveredCount: 1 },
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.get(outboxId);
      assert.equal(row?.state, "pending");
      assert.equal(row?.attemptCount, 0);
    });
  });

  it("reclaims an expired delivery lease ahead of a sustained pending backlog", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const expiredLeaseId = await t.run(async (ctx) => {
      const base = {
        journeyId,
        event: "claim_attempt_created" as const,
        profileType: "person" as const,
        method: "vrchat" as const,
        entrySource: "profile" as const,
        occurredAt: now - 60_000,
        attemptCount: 1,
        nextAttemptAt: now - 60_000,
      };
      const id = await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "expired-lease",
        state: "delivering",
        leaseUntil: now - 1,
      });
      await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "pending-backlog",
        state: "pending",
        attemptCount: 0,
      });
      return id;
    });

    const claimed = await t.mutation(internal.claimAnalytics.claimNextForDelivery, {});
    assert.equal(claimed.row?._id, expiredLeaseId);
  });

  it("deletes only delivered analytics rows past the retention window", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const oldDeliveredId = await t.run(async (ctx) => {
      const base = {
        journeyId,
        event: "claim_attempt_created" as const,
        profileType: "person" as const,
        method: "vrchat" as const,
        entrySource: "profile" as const,
        occurredAt: now - 40 * 24 * 60 * 60 * 1_000,
        attemptCount: 1,
        nextAttemptAt: now,
      };
      const id = await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "old-delivered",
        state: "delivered",
        deliveredAt: now - 31 * 24 * 60 * 60 * 1_000,
      });
      await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "recent-delivered",
        state: "delivered",
        deliveredAt: now - 29 * 24 * 60 * 60 * 1_000,
      });
      await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "old-failed",
        state: "failed",
      });
      await ctx.db.insert("claimAnalyticsOutbox", {
        ...base,
        eventKey: "old-disabled",
        state: "disabled",
      });
      return id;
    });

    assert.deepEqual(
      await t.mutation(internal.claimAnalytics.sweepDeliveredEvents, { now }),
      { deletedCount: 2 },
    );
    await t.run(async (ctx) => {
      assert.equal(await ctx.db.get(oldDeliveredId), null);
      assert.equal((await ctx.db.query("claimAnalyticsOutbox").collect()).length, 2);
    });
  });

  it("deletes detailed lifecycle events after the diagnostic retention window", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const oldId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: newClerkUserId(),
        email: "lifecycle-retention@example.test",
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "lifecycle-retention",
        displayName: "Lifecycle Retention",
        sortName: "lifecycle retention",
        aliases: [], tags: [], claimState: "unclaimed",
        publicationState: "published", publicSurfacingState: "public",
        creationSource: "concierge", person: { roleTags: [] }, updatedAt: now,
      });
      const attemptId = await ctx.db.insert("profileVerificationAttempts", {
        profileId, userId, method: "vrchat_user_proof", targetType: "vrchat_user",
        targetExternalId: "usr_01234567-89ab-cdef-0123-456789abcdef",
        proofCode: "VRDEX-RETENTION", state: "pending",
        createdAt: now, updatedAt: now, expiresAt: now + 60_000,
      });
      const base = {
        profileId, attemptId, method: "vrchat_user_proof" as const,
        targetType: "vrchat_user" as const, event: "attempt_created" as const,
        actorSurface: "web" as const,
      };
      const id = await ctx.db.insert("profileClaimLifecycleEvents", {
        ...base, createdAt: now - 31 * 24 * 60 * 60 * 1_000,
      });
      await ctx.db.insert("profileClaimLifecycleEvents", {
        ...base, createdAt: now - 29 * 24 * 60 * 60 * 1_000,
      });
      return id;
    });

    assert.deepEqual(
      await t.mutation(internal.claimAnalytics.sweepClaimLifecycleEvents, { now }),
      { deletedCount: 1 },
    );
    await t.run(async (ctx) => {
      assert.equal(await ctx.db.get(oldId), null);
      assert.equal((await ctx.db.query("profileClaimLifecycleEvents").collect()).length, 1);
    });
  });

  it("aligns browser correlation with created, first-check, and terminal server milestones", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const clerkUserId = newClerkUserId();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId,
        email: "claim-analytics@example.test",
        emailVerificationTime: now,
      });
      await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "claim-analytics-target",
        displayName: "Claim Analytics Target",
        sortName: "claim analytics target",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "concierge",
        person: { roleTags: [] },
        updatedAt: now,
      });
    });
    const identity = {
      subject: clerkUserId,
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${clerkUserId}`,
    };

    const attempt = await t.withIdentity(identity).mutation(api.profileClaims.startVrchatProof, {
      profileSlug: "claim-analytics-target",
      targetType: "vrchat_user",
      targetExternalId: "usr_01234567-89ab-cdef-0123-456789abcdef",
      analyticsJourneyId: journeyId,
      analyticsEntrySource: "search",
    });
    await t.withIdentity(identity).mutation(internal.profileClaims.reserveAdapterCheck, {
      attemptId: attempt.attemptId,
      cooldownMs: 60_000,
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.deepEqual(rows.map((row) => row.event), ["claim_attempt_created"]);
    });
    await t.mutation(internal.profileClaims.recordAdapterProofCheckOutcome, {
      attemptId: attempt.attemptId,
      outcome: "not_found",
      now: now + 1,
    });
    await t.mutation(internal.profileClaims.recordVrchatProofFailure, {
      attemptId: attempt.attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Bounded test outcome.",
    });

    await t.run(async (ctx) => {
      const rows = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.deepEqual(
        rows.map((row) => row.event).sort(),
        ["claim_attempt_created", "claim_resolved", "claim_verification_started"],
      );
      assert.ok(rows.every((row) => row.journeyId === journeyId));
      assert.ok(rows.every((row) => row.entrySource === "search"));
      assert.ok(rows.every((row) => row.method === "vrchat"));
      assert.equal(rows.find((row) => row.event === "claim_resolved")?.outcome, "rejected");
    });
  });

  it("adopts a resumed legacy VRChat proof into the browser journey", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const clerkUserId = newClerkUserId();
    const attemptId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId,
        email: "legacy-proof-analytics@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "legacy-proof-analytics",
        displayName: "Legacy Proof Analytics",
        sortName: "legacy proof analytics",
        aliases: [], tags: [], claimState: "unclaimed",
        publicationState: "published", publicSurfacingState: "public",
        creationSource: "concierge", person: { roleTags: [] }, updatedAt: now,
      });
      return await ctx.db.insert("profileVerificationAttempts", {
        profileId, userId, method: "vrchat_user_proof", targetType: "vrchat_user",
        targetExternalId: "usr_01234567-89ab-cdef-0123-456789abcdef",
        proofCode: "VRDEX-LEGACY", state: "pending",
        createdAt: now - 5_000, updatedAt: now - 5_000, expiresAt: now + 60_000,
      });
    });
    const identity = {
      subject: clerkUserId,
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${clerkUserId}`,
    };

    assert.deepEqual(
      await t.withIdentity(identity).mutation(
        api.profileClaims.adoptPendingProofAnalyticsJourney,
        {
          attemptId,
          analyticsJourneyId: journeyId,
          analyticsEntrySource: "profile",
        },
      ),
      { analyticsJourneyId: journeyId, adopted: true },
    );
    await t.run(async (ctx) => {
      assert.equal((await ctx.db.get(attemptId))?.analyticsJourneyId, journeyId);
      const rows = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.event, "claim_attempt_created");
      assert.equal(rows[0]?.occurredAt, now - 5_000);
    });
  });

  it("adopts a legacy pending Discord request into the resumed journey", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const clerkUserId = newClerkUserId();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId,
        email: "legacy-discord-analytics@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "community",
        slug: "legacy-discord-analytics",
        displayName: "Legacy Discord Analytics",
        sortName: "legacy discord analytics",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "concierge",
        community: { categoryTags: [] },
        updatedAt: now,
      });
      await ctx.db.insert("discordVerificationWatermarks", {
        userId,
        discordUserId: "123456789012345678",
        issuedGeneration: 1,
        appliedGeneration: 1,
        appliedAt: now,
        issuedAt: now,
        updatedAt: now,
      });
      const claimRequestId = await ctx.db.insert("profileClaimRequests", {
        profileId,
        profileSlug: "legacy-discord-analytics",
        profileType: "community",
        requestedDisplayName: "Legacy Discord Analytics",
        userId,
        method: "discord_community_admin",
        state: "pending",
        discordGuildId: "123456789012345678",
        evidenceSource: "discord_api",
        evidenceSummary: "Legacy pending request.",
        createdAt: now - 5_000,
        updatedAt: now - 5_000,
      });
      return { claimRequestId };
    });
    const identity = {
      subject: clerkUserId,
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${clerkUserId}`,
    };

    const result = await t.withIdentity(identity).mutation(
      api.profileClaims.requestCommunityDiscordAdminClaim,
      {
        profileSlug: "legacy-discord-analytics",
        discordGuildId: "123456789012345678",
        analyticsJourneyId: journeyId,
        analyticsEntrySource: "profile",
      },
    );
    assert.equal(result.claimRequestId, seeded.claimRequestId);

    await t.run(async (ctx) => {
      const request = await ctx.db.get(seeded.claimRequestId);
      assert.equal(request?.analyticsJourneyId, journeyId);
      const rows = await ctx.db.query("claimAnalyticsOutbox").collect();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.event, "claim_attempt_created");
      assert.equal(rows[0]?.occurredAt, now - 5_000);
    });
  });

  it("reports aggregate delivery failures without journey identifiers", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("claimAnalyticsOutbox", {
        eventKey: "opaque-test-key",
        journeyId,
        event: "claim_attempt_created",
        profileType: "person",
        method: "vrchat",
        entrySource: "profile",
        occurredAt: now - 30_000,
        state: "failed",
        attemptCount: 5,
        nextAttemptAt: now,
      });
    });

    const health = await t.query(internal.claimAnalytics.deliveryOperationalHealth, { now });
    assert.deepEqual(health, {
      pendingCount: 0,
      deliveringCount: 0,
      failedCount: 1,
      disabledCount: 0,
      oldestPendingAgeMs: null,
      scanLimitReached: false,
    });
    assert.equal(JSON.stringify(health).includes(journeyId), false);
    assert.equal(JSON.stringify(health).includes("opaque-test-key"), false);
  });

  it("disables delivery safely when a fork has no project key", async () => {
    assert.equal(posthogClaimAnalyticsConfig({}), null);
    assert.equal(
      posthogClaimAnalyticsConfig({ POSTHOG_PROJECT_API_KEY: "not-a-project-key" }),
      null,
    );
    assert.equal(
      posthogClaimAnalyticsConfig({
        POSTHOG_PROJECT_API_KEY: "phc_example",
        POSTHOG_INGEST_HOST: "http://posthog.invalid",
      }),
      null,
    );
    assert.deepEqual(
      posthogClaimAnalyticsConfig({ POSTHOG_PROJECT_API_KEY: "phc_example" }),
      {
        projectKey: "phc_example",
        captureUrl: "https://us.i.posthog.com/i/v0/e/",
      },
    );
  });
});
