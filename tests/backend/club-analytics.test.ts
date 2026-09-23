import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { summarizeSeries, timeBuckets } from "../../convex/_clubAnalyticsMath";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubAnalytics.ts": () => import("../../convex/clubAnalytics"),
  "../../convex/clubStaff.ts": () => import("../../convex/clubStaff"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const epoch = Date.UTC(2026, 2, 1);
it("accepts a display attempt nonce and returns server evaluation time", async () => {
  const s = await setup();
  const before = Date.now();
  const result = await s.owner.query(api.clubAnalytics.getContext, {
    communitySlug: "analytics",
    freshnessNonce: "display-attempt",
  });
  assert.ok(result.now >= before && result.now <= Date.now());
});
async function setup() {
  const t = convexTest({ schema, modules });
  const owner = {
      subject: "user_owner",
      issuer: "https://test.clerk.accounts.dev",
      tokenIdentifier: "https://test.clerk.accounts.dev|user_owner",
    },
    staff = {
      subject: "user_staff",
      issuer: "https://test.clerk.accounts.dev",
      tokenIdentifier: "https://test.clerk.accounts.dev|user_staff",
    };
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: owner.subject });
    await ctx.db.insert("users", { clerkUserId: staff.subject });
    const communityProfileId = await ctx.db.insert("profiles", {
      slug: "analytics",
      displayName: "Analytics club",
      sortName: "analytics club",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: epoch,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId: communityProfileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: epoch,
      updatedAt: epoch,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId,
      vrchatGroupId: "grp_example",
      groupVisibility: "public",
      joinPolicy: "free",
      state: "active",
      killSwitchEnabled: false,
      requestsPerMinute: 30,
      leaseGeneration: 0,
      publicMetrics: {
        currentPopulation: false,
        populationHistory: false,
        groupMemberCount: false,
        groupMemberGrowth: false,
        eventRecaps: false,
      },
      consecutiveFailures: 0,
      telemetryEpochStartedAt: epoch,
      createdAt: epoch - 86400_000,
      updatedAt: epoch,
    });
    await ctx.db.insert("communityAuthorities", {
      communityProfileId,
      subjectTokenIdentifier: staff.tokenIdentifier,
      subject: staff,
      capabilities: ["manage_events"],
      roleKey: "legacy",
      roleLabel: "Staff",
      state: "active",
      grantedAt: epoch,
      updatedAt: epoch,
    });
    return { communityProfileId, integrationId };
  });
  return {
    t,
    owner: t.withIdentity(owner),
    staff: t.withIdentity(staff),
    ...seeded,
  };
}
describe("analytics temporal math", () => {
  it("uses 23/25-hour local DST days and preserves the repeated hour", () => {
    const spring = timeBuckets(
      Date.parse("2026-03-08T05:00:00Z"),
      Date.parse("2026-03-09T04:00:00Z"),
      "America/New_York",
    );
    assert.equal(spring.length, 1);
    assert.equal(spring[0]!.endAt - spring[0]!.startAt, 23 * 3600_000);
    const fall = timeBuckets(
      Date.parse("2026-11-01T04:00:00Z"),
      Date.parse("2026-11-02T05:00:00Z"),
      "America/New_York",
      "hour",
    );
    assert.equal(fall.length, 25);
    assert.equal(new Set(fall.map((b) => b.startAt)).size, 25);
  });
  it("clips boundary intervals and excludes long gaps and estimates", () => {
    const result = summarizeSeries(
      [
        { at: -120_000, value: 0, coverage: "observed" },
        { at: 120_000, value: 20, coverage: "observed" },
      ],
      0,
      60_000,
    );
    assert.equal(result.average, 12.5);
    assert.equal(result.peak, 15);
    assert.equal(result.coverageRatio, 1);
    assert.equal(result.playerHours, 12.5 / 60);
    const missing = summarizeSeries(
      [
        { at: 0, value: 30, coverage: "observed" },
        { at: 360_000, value: 60, coverage: "observed" },
        { at: 420_000, value: 40, coverage: "estimated" },
      ],
      0,
      480_000,
    );
    assert.equal(missing.average, null);
    assert.equal(missing.playerHours, null);
    assert.equal(missing.coverageRatio, 0);
    assert.equal(missing.peak, 60);
    assert.equal(
      summarizeSeries(
        [
          { at: 0, value: 0, coverage: "observed" },
          { at: 60_000, value: 0, coverage: "observed" },
        ],
        0,
        60_000,
      ).average,
      0,
    );
  });
});
describe("club analytics range and permissions", () => {
  it("marks a dense coarse bucket incomplete instead of publishing a truncated summary", async () => {
    const { t, owner, integrationId } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 5001; index++) {
        await ctx.db.insert("communityPopulationObservations", {
          integrationId,
          idempotencyKey: `dense-${index}`,
          totalPopulation: index,
          activeInstanceCount: 1,
          worldDistribution: [],
          observedAt: epoch + index,
          source: "first_party",
          collectorVersion: "test",
          coverageState: "observed",
          fencingToken: 1,
        });
      }
    });
    const result = await owner.query(api.clubAnalytics.getBucket, {
      communitySlug: "analytics",
      startAt: epoch,
      endAt: epoch + 86400_000,
    });
    assert.equal(result.complete, false);
    assert.equal(result.population, null);
  });

  it("labels member changes as net and independently strips member fields from event recaps", async () => {
    const { t, owner, staff, communityProfileId, integrationId } =
      await setup();
    await t.run(async (ctx) => {
      for (const [offset, memberCount] of [
        [0, 100],
        [120_000, 105],
      ]) {
        await ctx.db.insert("communityMemberCountObservations", {
          integrationId,
          communityProfileId,
          idempotencyKey: `members-${offset}`,
          vrchatGroupId: "grp_example",
          memberCount: memberCount!,
          observedAt: epoch + offset!,
          source: "first_party",
          collectorVersion: "test",
          coverageState: "observed",
          fencingToken: 1,
        });
      }
      const eventId = await ctx.db.insert("events", {
        slug: "test-recap",
        title: "Test recap",
        sortTitle: "test recap",
        startAt: epoch + 60_000,
        communityProfileId,
        sourceType: "manual",
        sourceLabel: "test",
        eventStatus: "scheduled",
        publicationState: "published",
        publishedAt: epoch,
        updatedAt: epoch,
      });
      await ctx.db.insert("communityTelemetryRollups", {
        communityProfileId,
        eventId,
        grain: "event",
        bucketStartAt: epoch + 60_000,
        bucketEndAt: epoch + 180_000,
        rollupVersion: "community-telemetry-v1",
        activeInstanceCount: 1,
        peakConcurrency: 20,
        playerMinutes: 20,
        coverageRatio: 1,
        groupMemberCount: 105,
        groupMemberGrowth: 5,
        worldDistribution: [],
        computedAt: epoch + 180_000,
      });
    });
    const bucket = await staff.query(api.clubAnalytics.getBucket, {
      communitySlug: "analytics",
      startAt: epoch + 60_000,
      endAt: epoch + 180_000,
    });
    assert.equal(bucket.membership?.netChange, 5);
    assert.equal("joins" in bucket.membership!, false);
    for (const category of ["group_size", "membership_movement"] as const) {
      await owner.mutation(api.clubStaff.setCategoryVisibility, {
        communitySlug: "analytics",
        category,
        audience: "owner",
        staffRoleIds: null,
      });
    }
    const recaps = await staff.query(api.clubAnalytics.listEventRecaps, {
      communitySlug: "analytics",
      startAt: epoch,
      endAt: epoch + 86400_000,
      paginationOpts: { numItems: 10, cursor: null },
    });
    assert.equal(recaps.page.length, 1);
    assert.equal(recaps.page[0]!.peak, 20);
    assert.equal("groupMemberCount" in recaps.page[0]!, false);
    assert.equal("netChange" in recaps.page[0]!, false);
  });
  it("paginates every observation beyond the legacy 2500 cap and respects the connection epoch", async () => {
    const { t, owner, integrationId } = await setup();
    await t.run(async (ctx) => {
      for (let index = -1; index < 2601; index++)
        await ctx.db.insert("communityPopulationObservations", {
          integrationId,
          idempotencyKey: `sample-${index}`,
          totalPopulation: index < 0 ? 999 : 10,
          activeInstanceCount: 1,
          worldDistribution: [],
          observedAt: epoch + index * 1000,
          source: "first_party",
          collectorVersion: "test",
          coverageState: "observed",
          fencingToken: 1,
        });
    });
    let cursor: string | null = null;
    const points = [];
    let done = false;
    while (!done) {
      const result = await owner.query(api.clubAnalytics.getSeries, {
        communitySlug: "analytics",
        kind: "population",
        startAt: epoch - 60_000,
        endAt: epoch + 3600_000,
        paginationOpts: { numItems: 500, cursor },
      });
      points.push(...result.page);
      cursor = result.continueCursor;
      done = result.isDone;
      assert.equal(result.before, null);
    }
    assert.equal(points.length, 2601);
    assert.equal(
      points.some((p) => p.value === 999),
      false,
    );
    const bucket = await owner.query(api.clubAnalytics.getBucket, {
      communitySlug: "analytics",
      startAt: epoch - 60_000,
      endAt: epoch + 3600_000,
    });
    assert.equal(bucket.complete, true);
    assert.equal(bucket.population!.peak, 10);
    assert.equal(bucket.population!.coverageRatio, 2600_000 / 3660_000);
  });
  it("withholds denied metrics, preserves personal/default preferences and rejects default edits by staff", async () => {
    const { owner, staff } = await setup();
    await owner.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "analytics",
      category: "population_history",
      audience: "owner",
      staffRoleIds: null,
    });
    await owner.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "analytics",
      category: "group_size",
      audience: "owner",
      staffRoleIds: null,
    });
    await owner.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "analytics",
      category: "membership_movement",
      audience: "owner",
      staffRoleIds: null,
    });
    const result = await staff.query(api.clubAnalytics.getBucket, {
      communitySlug: "analytics",
      startAt: epoch,
      endAt: epoch + 86400_000,
    });
    assert.equal(result.population, null);
    assert.equal(result.membership, null);
    await assert.rejects(
      staff.query(api.clubAnalytics.getSeries, {
        communitySlug: "analytics",
        kind: "population",
        startAt: epoch,
        endAt: epoch + 3600_000,
        paginationOpts: { numItems: 10, cursor: null },
      }),
      /category/,
    );
    await owner.mutation(api.clubAnalytics.savePreferences, {
      communitySlug: "analytics",
      scope: "club",
      widgets: ["activity", "membership"],
      rangeDays: 7,
    });
    assert.equal(
      (
        await staff.query(api.clubAnalytics.getContext, {
          communitySlug: "analytics",
        })
      ).preferences.rangeDays,
      7,
    );
    await staff.mutation(api.clubAnalytics.savePreferences, {
      communitySlug: "analytics",
      scope: "personal",
      widgets: ["activity"],
      rangeDays: 90,
    });
    assert.equal(
      (
        await staff.query(api.clubAnalytics.getContext, {
          communitySlug: "analytics",
        })
      ).readableCategories.includes("population_history"),
      false,
    );
    await staff.mutation(api.clubAnalytics.resetPersonalPreferences, {
      communitySlug: "analytics",
    });
    assert.equal(
      (
        await staff.query(api.clubAnalytics.getContext, {
          communitySlug: "analytics",
        })
      ).preferences.rangeDays,
      7,
    );
    await assert.rejects(
      staff.mutation(api.clubAnalytics.savePreferences, {
        communitySlug: "analytics",
        scope: "club",
        widgets: [],
        rangeDays: 30,
      }),
      /owner/,
    );
  });
  it("pages instance history, preserves unknown closed times and rejects foreign sessions", async () => {
    const { t, owner, communityProfileId, integrationId } = await setup();
    const sessions = await t.run(async (ctx) => {
      const ids = [];
      for (let index = 0; index < 12; index++)
        ids.push(
          await ctx.db.insert("instanceSessions", {
            integrationId,
            communityProfileId,
            providerInstanceId: `session-${index}`,
            providerLocation: `wrld_example:session-${index}`,
            vrchatWorldId: "wrld_example",
            source: "first_party",
            state: "closed",
            openedAt: epoch + index,
            lastObservedAt: epoch + 60_000,
            consecutiveMisses: 3,
            updatedAt: epoch + 60_000,
          }),
        );
      return ids;
    });
    const first = await owner.query(api.clubAnalytics.listInstances, {
      communitySlug: "analytics",
      kind: "past",
      paginationOpts: { numItems: 10, cursor: null },
    });
    assert.equal(first.page.length, 10);
    assert.equal(first.isDone, false);
    assert.equal(first.page[0]!.closedAt, null);
    const second = await owner.query(api.clubAnalytics.listInstances, {
      communitySlug: "analytics",
      kind: "past",
      paginationOpts: { numItems: 10, cursor: first.continueCursor },
    });
    assert.equal(second.page.length, 2);
    assert.equal(second.isDone, true);
    await t.run((ctx) => ctx.db.patch(sessions[0]!, { openedAt: epoch - 1 }));
    assert.equal(
      await owner.query(api.clubAnalytics.getInstance, {
        communitySlug: "analytics",
        sessionId: sessions[0]!,
      }),
      null,
    );
    for (const sessionId of ["foo", "", communityProfileId]) {
      assert.equal(
        await owner.query(api.clubAnalytics.getInstance, {
          communitySlug: "analytics",
          sessionId,
        }),
        null,
      );
    }
    await t.run((ctx) => ctx.db.delete(sessions[1]!));
    assert.equal(
      await owner.query(api.clubAnalytics.getInstance, {
        communitySlug: "analytics",
        sessionId: sessions[1]!,
      }),
      null,
    );
    await owner.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "analytics",
      category: "instance_history",
      audience: "owner",
      staffRoleIds: null,
    });
    const staff = t.withIdentity({
      subject: "user_staff",
      issuer: "https://test.clerk.accounts.dev",
      tokenIdentifier: "https://test.clerk.accounts.dev|user_staff",
    });
    assert.equal(
      await staff.query(api.clubAnalytics.getInstance, {
        communitySlug: "analytics",
        sessionId: sessions[2]!,
      }),
      null,
    );
  });
});
