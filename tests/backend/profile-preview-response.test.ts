import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

it("previews public community activity without exposing disabled metrics or saving the draft", async () => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const clerkUserId = newClerkUserId();
  const metrics = {
    currentPopulation: false, populationHistory: true, groupMemberCount: false,
    groupMemberGrowth: false, eventRecaps: false,
  };
  const { profileId, integrationId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId, email: "preview@example.test", emailVerificationTime: now,
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: "preview-community", displayName: "Preview Community", sortName: "preview community",
      aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published",
      publicSurfacingState: "public", creationSource: "self", updatedAt: now,
      profileType: "community", community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now,
    });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", {
      communityProfileId: profileId, vrchatGroupId: "grp_00000000-0000-4000-8000-000000000001",
      groupVisibility: "public", joinPolicy: "free", state: "active", killSwitchEnabled: false,
      requestsPerMinute: 10, leaseGeneration: 1, publicMetrics: metrics,
      consecutiveFailures: 0, lastSuccessfulObservationAt: now,
      createdAt: now - 7_200_000, updatedAt: now,
    });
    await ctx.db.insert("communityTelemetryRollups", {
      communityProfileId: profileId, grain: "hour", bucketStartAt: now - 3_600_000,
      bucketEndAt: now, rollupVersion: "telemetry-v1", currentPopulation: 12,
      activeInstanceCount: 1, peakConcurrency: 20, playerMinutes: 600,
      coverageRatio: 1, groupMemberCount: 999, groupMemberGrowth: 5,
      worldDistribution: [], computedAt: now,
    });
    return { profileId, integrationId };
  });
  const owner = t.withIdentity({ subject: clerkUserId, issuer: "test", emailVerified: true });
  const publicProfile = await t.query(api.profiles.getPublicBySlug, { slug: "preview-community" });
  const preview = await owner.query(api.profiles.previewProfileFromBrowser, {
    slug: "preview-community", displayName: "Unsaved Community",
  });
  assert.equal(preview.displayName, "Unsaved Community");
  assert.ok(publicProfile?.telemetry?.populationHistory?.length);
  assert.ok(preview.telemetry);
  assert.deepEqual(preview.telemetry, publicProfile.telemetry);
  assert.equal(preview.telemetry.populationHistory?.[0]?.peakConcurrency, 20);
  assert.equal(preview.telemetry.populationHistory?.[0]?.groupMemberCount, undefined);
  assert.equal(preview.telemetry.populationHistory?.[0]?.groupMemberGrowth, undefined);
  assert.equal((await t.run((ctx) => ctx.db.get(profileId)))?.displayName, "Preview Community");

  await t.run((ctx) => ctx.db.patch(integrationId, { publicMetrics: { ...metrics, populationHistory: false } }));
  const hiddenPreview = await owner.query(api.profiles.previewProfileFromBrowser, { slug: "preview-community", displayName: "Unsaved Community" });
  assert.equal(hiddenPreview.telemetry, undefined);
});
