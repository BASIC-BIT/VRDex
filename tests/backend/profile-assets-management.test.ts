import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

async function seedOwnedProfile(assetCount = 2) {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "media-owner@example.test",
      emailVerificationTime: now,
    });
    const otherUserId = await ctx.db.insert("users", {
      email: "media-other@example.test",
      emailVerificationTime: now,
    });
    const profileId = await ctx.db.insert("profiles", {
      profileType: "person",
      slug: "media-owner",
      displayName: "Media Owner",
      sortName: "media owner",
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      person: { roleTags: [] },
      updatedAt: now,
    });
    await ctx.db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    const assetIds = [];
    for (let index = 0; index < assetCount; index += 1) {
      const assetId = await ctx.db.insert("profileAssets", {
        profileId,
        storageKey: `profile-assets/test/${index}.png`,
        mimeType: "image/png",
        byteSize: 128,
        contentSha256: `hash-${index}`,
        label: `Asset ${index + 1}`,
        altText: `Test asset ${index + 1}.`,
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: `api:${userId}`,
          issuer: "vrdex:api",
          subject: String(userId),
        },
        uploadedAt: now,
        state: "active",
        updatedAt: now,
      });
      assetIds.push(assetId);
      await ctx.db.insert("profileAssetPlacements", {
        profileId,
        assetId,
        placement: "gallery",
        position: index,
        state: "active",
        updatedAt: now,
      });
    }
    return {
      profileId,
      userId,
      assetIds,
      ownerIdentity: {
        subject: `${userId}|web-session`,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
      otherIdentity: {
        subject: `${otherUserId}|web-session`,
        issuer: "test",
        tokenIdentifier: `test|${otherUserId}`,
      },
    };
  });
  return { t, ...seeded };
}

describe("profile media-kit owner management", () => {
  it("keeps owner gallery mutations disabled until the launch flag is enabled", async () => {
    const seeded = await seedOwnedProfile(0);
    const previous = process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;
    delete process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;

    try {
      await assert.rejects(
        seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
          profileId: seeded.profileId,
          originalFileName: "disabled.png",
          mimeType: "image/png",
          byteSize: 128,
          label: "Disabled image",
          altText: "A test image.",
        }),
        /not enabled/,
      );
    } finally {
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = previous ?? "true";
    }
  });

  it("enforces owner authority and the active asset quota", async () => {
    const seeded = await seedOwnedProfile(12);

    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
        profileId: seeded.profileId,
        originalFileName: "thirteenth.png",
        mimeType: "image/png",
        byteSize: 128,
      }),
      /up to 12/,
    );
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.createUploadIntentForApiProfileOwner, {
        actorKind: "personal_api_token",
        ownerUserId: seeded.userId,
        slug: "media-owner",
        originalFileName: "api-thirteenth.png",
        mimeType: "image/png",
        byteSize: 128,
      }),
      /up to 12/,
    );
    await assert.rejects(
      seeded.t.withIdentity(seeded.otherIdentity).mutation(api.profileAssets.updateOwnedAssetMetadata, {
        profileId: seeded.profileId,
        assetId: seeded.assetIds[0]!,
        label: "Not allowed",
      }),
      /Only the profile owner/,
    );
  });

  it("authorizes owner previews without requiring public profile visibility", async () => {
    const seeded = await seedOwnedProfile(1);
    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        publicSurfacingState: "suppressed",
      });
      await ctx.db.patch(seeded.assetIds[0]!, { visibility: "private" });
    });

    const ownerAsset = await seeded.t.withIdentity(seeded.ownerIdentity).query(
      api.profileAssets.getOwnedAssetForStorage,
      { profileId: seeded.profileId, assetId: seeded.assetIds[0]! },
    );
    const otherAsset = await seeded.t.withIdentity(seeded.otherIdentity).query(
      api.profileAssets.getOwnedAssetForStorage,
      { profileId: seeded.profileId, assetId: seeded.assetIds[0]! },
    );

    assert.equal(ownerAsset?.storageKey, "profile-assets/test/0.png");
    assert.equal(otherAsset, null);
  });

  it("releases a failed owner upload reservation for an immediate retry", async () => {
    const seeded = await seedOwnedProfile(11);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "failed.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Failed upload",
      altText: "A synthetic failed upload.",
    });

    assert.equal(await owner.mutation(api.profileAssets.cancelOwnedUploadIntent, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
    }), true);
    await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "retry.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Retry upload",
      altText: "A synthetic retry upload.",
    });
  });

  it("enforces quota when a removed asset is restored", async () => {
    const seeded = await seedOwnedProfile(12);
    const deletedAssetId = await seeded.t.run(async (ctx) => {
      return await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/test/deleted.png",
        mimeType: "image/png",
        byteSize: 128,
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: `api:${seeded.userId}`,
          issuer: "vrdex:api",
          subject: String(seeded.userId),
        },
        uploadedAt: Date.now(),
        state: "deleted",
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.setOwnedAssetDeleted, {
        profileId: seeded.profileId,
        assetId: deletedAssetId,
        deleted: false,
      }),
      /up to 12/,
    );
  });

  it("rechecks duplicate content and replaces singleton featured placement during completion", async () => {
    const seeded = await seedOwnedProfile(2);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    await owner.mutation(api.profileAssets.setOwnedFeaturedAsset, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
    });

    const duplicateIntent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "duplicate.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Duplicate",
      altText: "Duplicate image.",
    });
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
        intentId: duplicateIntent.intentId,
        uploadToken: duplicateIntent.uploadToken,
        mimeType: "image/png",
        byteSize: 128,
        contentSha256: "hash-0",
        width: 20,
        height: 20,
      }),
      /already exists/,
    );

    const featuredIntent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "new-featured.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "New featured",
      altText: "New featured image.",
      placements: ["gallery", "featured"],
    });
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: featuredIntent.intentId,
      uploadToken: featuredIntent.uploadToken,
      mimeType: "image/png",
      byteSize: 128,
      contentSha256: "new-featured-hash",
      width: 20,
      height: 20,
    });
    const activeFeatured = await seeded.t.run(async (ctx) => {
      return await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", seeded.profileId).eq("placement", "featured").eq("state", "active"),
        )
        .collect();
    });
    assert.equal(completed.assetIds.length, 1);
    assert.equal(activeFeatured.length, 1);
    assert.equal(activeFeatured[0]?.assetId, completed.assetIds[0]);
  });

  it("requires accessible metadata before reserving a public gallery upload", async () => {
    const seeded = await seedOwnedProfile();
    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
        profileId: seeded.profileId,
        originalFileName: "missing-alt.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Missing alt",
      }),
      /accessibility description/,
    );
    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
        profileId: seeded.profileId,
        originalFileName: "missing-featured-alt.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Missing featured alt",
        placements: ["gallery", "featured"],
      }),
      /accessibility description/,
    );
    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
        profileId: seeded.profileId,
        originalFileName: "featured-only.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Featured only",
        altText: "A valid but featured-only test image.",
        placements: ["featured"],
      }),
      /must also be a gallery item/,
    );
  });

  it("keeps unplaced assets out of gallery and featured owner controls", async () => {
    const seeded = await seedOwnedProfile(1);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const unplacedAssetId = await seeded.t.run(async (ctx) => {
      return await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/test/unplaced.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Unplaced",
        altText: "An unplaced test asset.",
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: `api:${seeded.userId}`,
          issuer: "vrdex:api",
          subject: String(seeded.userId),
        },
        uploadedAt: Date.now(),
        state: "active",
        updatedAt: Date.now(),
      });
    });

    const profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.deepEqual(profiles?.[0]?.assets.map((asset) => asset.assetId), seeded.assetIds);
    await assert.rejects(
      owner.mutation(api.profileAssets.setOwnedFeaturedAsset, {
        profileId: seeded.profileId,
        assetId: unplacedAssetId,
      }),
      /accessible public gallery item/,
    );
  });

  it("updates metadata, order, featured state, and recoverable deletion", async () => {
    const seeded = await seedOwnedProfile();
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);

    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Press portrait",
      altText: "Owner standing under violet light.",
      credit: "Photo by Example",
    });
    await assert.rejects(
      owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
        profileId: seeded.profileId,
        assetId: seeded.assetIds[0]!,
        label: "Press portrait",
        altText: "",
      }),
      /accessibility description/,
    );
    await owner.mutation(api.profileAssets.reorderOwnedGallery, {
      profileId: seeded.profileId,
      assetIds: [seeded.assetIds[1]!, seeded.assetIds[0]!],
    });
    await owner.mutation(api.profileAssets.setOwnedFeaturedAsset, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
    });
    await owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      deleted: true,
    });
    await owner.mutation(api.profileAssets.reorderOwnedGallery, {
      profileId: seeded.profileId,
      assetIds: [seeded.assetIds[1]!],
    });
    let profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.deepEqual(profiles?.[0]?.assets.map((asset) => asset.assetId), [seeded.assetIds[1], seeded.assetIds[0]]);
    assert.equal(profiles?.[0]?.assets[1]?.state, "deleted");

    await owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      deleted: false,
    });
    profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(profiles?.[0]?.assets[1]?.state, "active");
    assert.equal(profiles?.[0]?.assets[1]?.featured, true);
    assert.equal(profiles?.[0]?.assets[1]?.altText, "Owner standing under violet light.");
    const restoredGallery = await seeded.t.run(async (ctx) => {
      return await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", seeded.assetIds[0]!))
        .collect();
    });
    assert.equal(
      restoredGallery.some((placement) => placement.placement === "gallery" && placement.state === "active"),
      true,
    );
  });
});
