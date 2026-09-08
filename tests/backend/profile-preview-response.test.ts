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
    expectedUpdatedAt: now, slug: "preview-community", displayName: "Unsaved Community",
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
  const hiddenPreview = await owner.query(api.profiles.previewProfileFromBrowser, { expectedUpdatedAt: now, slug: "preview-community", displayName: "Unsaved Community" });
  assert.equal(hiddenPreview.telemetry, undefined);
  await t.run((ctx) => ctx.db.insert("profileSuppressionRequests", {
    displayName: "Withdrawn Community", profileType: "community", requestType: "owner_opt_out",
    state: "accepted", createdAt: now, updatedAt: now,
  }));
  await assert.rejects(owner.query(api.profiles.previewProfileFromBrowser, {
    expectedUpdatedAt: now, slug: "preview-community", displayName: "Withdrawn Community",
  }), (error: { data?: { code?: string } }) => error.data?.code === "IDENTITY_SUPPRESSED");
  assert.equal((await t.run((ctx) => ctx.db.get(profileId)))?.displayName, "Preview Community");
  await t.run((ctx) => ctx.db.patch(profileId, { bio: "A concurrent update", updatedAt: now + 1 }));
  await assert.rejects(owner.query(api.profiles.previewProfileFromBrowser, {
    slug: "preview-community", expectedUpdatedAt: now, displayName: "Unsaved Community",
  }), (error: { data?: { code?: string } }) => error.data?.code === "PROFILE_CHANGED");
  const refreshedPreview = await owner.query(api.profiles.previewProfileFromBrowser, {
    slug: "preview-community", expectedUpdatedAt: now + 1, displayName: "Unsaved Community",
  });
  assert.equal(refreshedPreview.bio, "A concurrent update");
  assert.equal(refreshedPreview.displayName, "Unsaved Community");
  assert.equal((await t.run((ctx) => ctx.db.get(profileId)))?.displayName, "Preview Community");
});

it("uses authenticated asset routes for hidden owner previews without widening public access", async () => {
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
  const t = convexTest({ schema, modules: { ...modules, "../../convex/profileAssets.ts": () => import("../../convex/profileAssets") } });
  const now = Date.now();
  const ownerId = newClerkUserId();
  const otherId = newClerkUserId();
  const { profileId, assetId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkUserId: ownerId, emailVerificationTime: now });
    await ctx.db.insert("users", { clerkUserId: otherId, emailVerificationTime: now });
    const profileId = await ctx.db.insert("profiles", {
      slug: "preview-assets", displayName: "Preview Assets", sortName: "preview assets",
      aliases: [], tags: [], claimState: "claimed_verified", publicationState: "published",
      publicSurfacingState: "public", creationSource: "self", updatedAt: now,
      profileType: "person", person: { roleTags: [] },
    });
    await ctx.db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    const assetId = await ctx.db.insert("profileAssets", {
      profileId, storageKey: "preview/asset.png", mimeType: "image/png", byteSize: 128,
      contentSha256: "hash", label: "Gallery image", visibility: "public", source: "owner_authored",
      uploadedBy: { tokenIdentifier: "test", issuer: "test", subject: ownerId }, uploadedAt: now, state: "active", updatedAt: now,
    });
    for (const placement of ["profile_image", "banner", "primary_logo", "additional_logo", "gallery", "featured"] as const) {
      await ctx.db.insert("profileAssetPlacements", { profileId, assetId, placement, position: 0, state: "active", updatedAt: now });
    }
    return { profileId, assetId };
  });
  const owner = t.withIdentity({ subject: ownerId, issuer: "test", emailVerified: true });
  const other = t.withIdentity({ subject: otherId, issuer: "test", emailVerified: true });
  const path = `/api/account/media-kit/${profileId}/assets/${assetId}/file`;
  for (const patch of [
    { publicationState: "draft_private" as const },
    { publicationState: "published" as const, publicSurfacingState: "opted_out" as const },
    { publicSurfacingState: "suppressed" as const },
  ]) {
    await t.run((ctx) => ctx.db.patch(profileId, patch));
    const preview = await owner.query(api.profiles.previewProfileFromBrowser, { expectedUpdatedAt: now, slug: "preview-assets", displayName: "Preview Assets" });
    assert.equal(preview.avatarImageUrl, path);
    assert.equal(preview.bannerImageUrl, path);
    assert.equal(preview.mediaKit.logoZipUrl, undefined);
    for (const asset of [preview.mediaKit.profileImage, preview.mediaKit.banner, preview.mediaKit.primaryLogo,
      preview.mediaKit.featuredAsset, ...preview.mediaKit.logos, ...preview.mediaKit.assets, ...preview.mediaKit.galleryAssets]) {
      assert.ok(asset);
      assert.equal(asset.imageUrl, path);
      assert.equal(asset.downloadUrl, `${path}?download=1`);
      assert.equal(asset.label, "Gallery image");
    }
    assert.equal(await t.query(api.profileAssets.getPublicAssetForStorage, { slug: "preview-assets", assetId }), null);
    assert.equal((await owner.query(api.profileAssets.getOwnedAssetForStorage, { profileId, assetId }))?.storageKey, "preview/asset.png");
    assert.equal(await other.query(api.profileAssets.getOwnedAssetForStorage, { profileId, assetId }), null);
    await assert.rejects(other.query(api.profiles.previewProfileFromBrowser, { expectedUpdatedAt: now - 1, slug: "preview-assets", displayName: "Preview Assets" }), /Profile was not found/);
  }
  await t.run((ctx) => ctx.db.patch(profileId, { publicSurfacingState: "public" }));
  const mediaFlag = process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;
  try {
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    const publicOwnerPreview = await owner.query(api.profiles.previewProfileFromBrowser, {
      expectedUpdatedAt: now, slug: "preview-assets", displayName: "Preview Assets",
    });
    const publicPath = `/api/v0/profiles/preview-assets/assets/${assetId}/file`;
    assert.equal(publicOwnerPreview.avatarImageUrl, publicPath);
    assert.equal(publicOwnerPreview.bannerImageUrl, publicPath);
    assert.equal(publicOwnerPreview.mediaKit.profileImage?.downloadUrl, `${publicPath}?download=1`);
    assert.equal(publicOwnerPreview.mediaKit.logoZipUrl, "/api/v0/profiles/preview-assets/logos.zip");
    assert.equal((await t.query(api.profileAssets.getPublicAssetForStorage, { slug: "preview-assets", assetId }))?.storageKey, "preview/asset.png");
  } finally {
    if (mediaFlag === undefined) delete process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;
    else process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = mediaFlag;
  }
  await t.run((ctx) => ctx.db.patch(profileId, { publicSurfacingState: "public", claimState: "unclaimed" }));
  const contributor = await other.query(api.profiles.previewProfileFromBrowser, { expectedUpdatedAt: now, slug: "preview-assets", aliases: ["Alias"] });
  assert.equal(contributor.mediaKit.profileImage?.imageUrl, `/api/v0/profiles/preview-assets/assets/${assetId}/file`);
  await t.run((ctx) => ctx.db.patch(profileId, { claimState: "claimed_verified", fieldVisibility: { avatarImageUrl: "private", bannerImageUrl: "private", mediaKit: "private" } }));
  const privateFields = await owner.query(api.profiles.previewProfileFromBrowser, { expectedUpdatedAt: now, slug: "preview-assets", displayName: "Preview Assets" });
  assert.equal(privateFields.avatarImageUrl, undefined);
  assert.equal(privateFields.bannerImageUrl, undefined);
  assert.deepEqual(privateFields.mediaKit.assets, []);
});
