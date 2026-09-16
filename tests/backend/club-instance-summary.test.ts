import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import schemaModule from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import {
  summarizeSeries,
  summarizeSeriesSegment,
  mergeSeriesSegments,
  type SeriesSegment,
} from "../../convex/_clubAnalyticsMath";
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/clubAnalytics.ts": () => import("../../convex/clubAnalytics"),
  "../../convex/clubStaff.ts": () => import("../../convex/clubStaff"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
};
const epoch = Date.UTC(2026, 2, 1);
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
describe("compact instance summaries", () => {
  it("merges clipped boundary intervals without bridging unknown or long gaps", () => {
    const points = [
      { at: 0, value: 0, coverage: "observed" },
      { at: 60_000, value: 20, coverage: "observed" },
      { at: 120_000, value: 50, coverage: "unknown" },
      { at: 180_000, value: 30, coverage: "observed" },
      { at: 600_000, value: 90, coverage: "observed" },
      { at: 660_000, value: 10, coverage: "observed" },
    ];
    const startAt = 30_000,
      endAt = 630_000;
    const pages = points.map((p) =>
      summarizeSeriesSegment([p], startAt, endAt),
    );
    const expected = summarizeSeries(points, startAt, endAt);
    const actual = mergeSeriesSegments(pages, startAt, endAt);
    assert.equal(actual.peak, expected.peak);
    assert.equal(actual.average, expected.average);
    assert.equal(actual.coverageRatio, expected.coverageRatio);
  });
  it("summarizes >5000 observations with exact page bridges and excludes gaps", async () => {
    const { t, owner, staff, integrationId, communityProfileId } =
      await setup();
    const points = Array.from({ length: 5101 }, (_, i) => ({
      at: epoch + i * 1000 + (i >= 3000 ? 600_000 : 0),
      value: i % 73,
      coverage: i === 500 ? "unknown" : "observed",
    }));
    const sessionId = await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("instanceSessions", {
        integrationId,
        communityProfileId,
        providerInstanceId: "session",
        providerLocation: "wrld_example:session",
        vrchatWorldId: "wrld_example",
        source: "first_party",
        state: "closed",
        openedAt: epoch,
        lastObservedAt: points.at(-1)!.at,
        consecutiveMisses: 3,
        updatedAt: points.at(-1)!.at,
      });
      for (const [index, p] of points.entries())
        await ctx.db.insert("instancePopulationObservations", {
          integrationId,
          sessionId,
          idempotencyKey: `sample-${index}`,
          providerInstanceId: "session",
          vrchatWorldId: "wrld_example",
          population: p.value,
          observedAt: p.at,
          source: "first_party",
          collectorVersion: "test",
          coverageState: p.coverage === "observed" ? "observed" : "unknown",
          fencingToken: 1,
        });
      return sessionId;
    });
    const startAt = epoch,
      endAt = points.at(-1)!.at + 1;
    let cursor: string | null = null;
    const segments: SeriesSegment[] = [];
    let pages = 0;
    while (true) {
      const result = await owner.query(
        api.clubAnalytics.getInstanceSummaryPage,
        {
          communitySlug: "analytics",
          sessionId,
          startAt,
          endAt,
          paginationOpts: { numItems: 500, cursor },
        },
      );
      assert.ok(
        JSON.stringify(result).length < 1800,
        "page returns statistics, not raw observations",
      );
      segments.push(...result.page);
      pages++;
      if (result.isDone) break;
      cursor = result.continueCursor;
      assert.ok(pages < 20);
    }
    assert.equal(pages, 11);
    const expected = summarizeSeries(points, startAt, endAt);
    const actual = mergeSeriesSegments(segments, startAt, endAt);
    assert.equal(actual.peak, expected.peak);
    assert.ok(Math.abs(actual.average! - expected.average!) < 1e-10);
    assert.ok(Math.abs(actual.coverageRatio - expected.coverageRatio) < 1e-12);
    const longRange = await owner.query(
      api.clubAnalytics.getInstanceSummaryPage,
      {
        communitySlug: "analytics",
        sessionId,
        startAt,
        endAt: epoch + 400 * 86400_000,
        paginationOpts: { numItems: 500, cursor: null },
      },
    );
    assert.equal(
      longRange.isDone,
      false,
      "long lifetimes remain paginated instead of truncated",
    );
    await owner.mutation(api.clubStaff.setCategoryVisibility, {
      communitySlug: "analytics",
      category: "instance_history",
      audience: "owner",
      staffRoleIds: null,
    });
    const args = {
      communitySlug: "analytics",
      sessionId,
      startAt,
      endAt,
      paginationOpts: { numItems: 500, cursor: null },
    };
    await assert.rejects(
      staff.query(api.clubAnalytics.getInstanceSummaryPage, args),
      /category/,
    );
    await t.run((ctx) =>
      ctx.db.patch(integrationId, { telemetryEpochStartedAt: epoch + 1 }),
    );
    await assert.rejects(
      owner.query(api.clubAnalytics.getInstanceSummaryPage, args),
      /not found/,
    );
  });
});
