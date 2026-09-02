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
      await t.mutation(internal.claimAnalytics.recoverFailedDeliveries, {}),
      { recoveredCount: 1 },
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.get(outboxId);
      assert.equal(row?.state, "pending");
      assert.equal(row?.attemptCount, 0);
      assert.ok((row?.nextAttemptAt ?? 0) >= now);
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
