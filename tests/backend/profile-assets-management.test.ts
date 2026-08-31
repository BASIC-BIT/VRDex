import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS,
  PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS,
} from "../../convex/_profileAssets";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED = "true";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profiles.ts": () => import("../../convex/profiles"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

async function seedOwnedProfile(assetCount = 2) {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const seeded = await t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId,
      email: "media-owner@example.test",
      emailVerificationTime: now,
    });
    const clerkUserId2 = newClerkUserId();
    const otherUserId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId2,
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
        subject: clerkUserId, emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
      otherIdentity: {
        subject: clerkUserId2, emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${otherUserId}`,
      },
    };
  });
  return { t, ...seeded };
}

async function claimUploadIntent(
  seeded: Awaited<ReturnType<typeof seedOwnedProfile>>,
  intent: { intentId: Id<"profileAssetUploadIntents">; uploadToken: string },
) {
  const processingToken = `processing-${crypto.randomUUID()}`;
  const claimed = await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
    intentId: intent.intentId,
    uploadToken: intent.uploadToken,
    processingToken,
  });
  assert.equal(claimed.status, "claimed");
  return processingToken;
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
    assert.equal("sourceStorageKey" in (ownerAsset ?? {}), false);
    assert.equal("sourceMimeType" in (ownerAsset ?? {}), false);
    assert.equal("sourceByteSize" in (ownerAsset ?? {}), false);
    assert.equal(otherAsset, null);
  });

  it("blocks direct public asset URLs when every placement is private", async () => {
    const seeded = await seedOwnedProfile(1);
    const assetId = seeded.assetIds[0]!;

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { mediaKit: "private" },
      });
    });
    assert.equal(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "media-owner",
        assetId,
      }),
      null,
    );

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { mediaKit: "unlisted" },
      });
    });
    assert.notEqual(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "media-owner",
        assetId,
      }),
      null,
    );

    await seeded.t.run(async (ctx) => {
      const placement = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", assetId))
        .unique();
      assert.notEqual(placement, null);
      await ctx.db.patch(placement!._id, { placement: "profile_image" });
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { avatarImageUrl: "public", mediaKit: "private" },
      });
    });
    assert.notEqual(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "media-owner",
        assetId,
      }),
      null,
    );

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { avatarImageUrl: "private", mediaKit: "private" },
      });
    });
    assert.equal(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "media-owner",
        assetId,
      }),
      null,
    );
  });

  it("keeps unlisted managed media on the profile page and out of share cards", async () => {
    const seeded = await seedOwnedProfile(1);
    const assetId = seeded.assetIds[0]!;

    await seeded.t.run(async (ctx) => {
      const placement = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", assetId))
        .unique();
      assert.notEqual(placement, null);
      await ctx.db.patch(placement!._id, { placement: "primary_logo" });
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { mediaKit: "unlisted" },
      });
    });

    const publicProfile = await seeded.t.query(api.profiles.getPublicBySlug, {
      slug: "media-owner",
      includeShareCard: true,
      includeTelemetry: false,
    });
    assert.equal(publicProfile?.mediaKit.primaryLogo?.assetId, assetId);
    assert.equal(publicProfile?.shareCard?.avatarImageUrl, undefined);

    const shareCard = await seeded.t.query(api.profiles.getPublicShareCardBySlug, {
      slug: "media-owner",
    });
    assert.equal(shareCard?.entityType, "profile");
    assert.equal(shareCard?.profile?.avatarImageUrl, undefined);
    const ownedProfiles = await seeded.t.withIdentity(seeded.ownerIdentity).query(
      api.profileAssets.listOwnedMediaKitProfiles,
      {},
    );
    assert.equal(ownedProfiles?.[0]?.assets[0]?.primaryLogo, true);
    assert.equal(ownedProfiles?.[0]?.assets[0]?.profileImage, false);
  });

  it("uses a managed primary logo as a community profile identity", async () => {
    const seeded = await seedOwnedProfile(0);
    const { assetId, profileId } = await seeded.t.run(async (ctx) => {
      const now = Date.now();
      const profileId = await ctx.db.insert("profiles", {
        profileType: "community",
        slug: "managed-community",
        displayName: "Managed Community",
        sortName: "managed community",
        aliases: [],
        tags: [],
        community: { categoryTags: [] },
        avatarImageUrl: "https://legacy.example.test/community.png",
        claimState: "claimed_verified",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        updatedAt: now,
      });
      const createdAssetId = await ctx.db.insert("profileAssets", {
        profileId,
        storageKey: "profile-assets/test/community-logo.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Managed community logo",
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: `api:${seeded.userId}`,
          issuer: "vrdex:api",
          subject: String(seeded.userId),
        },
        uploadedAt: now,
        state: "active",
        updatedAt: now,
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId,
        assetId: createdAssetId,
        placement: "primary_logo",
        position: 0,
        state: "active",
        updatedAt: now,
      });
      return { assetId: createdAssetId, profileId };
    });

    const publicProfile = await seeded.t.query(api.profiles.getPublicBySlug, {
      slug: "managed-community",
      includeTelemetry: false,
    });
    assert.equal(publicProfile?.mediaKit.primaryLogo?.assetId, assetId);
    assert.equal(publicProfile?.avatarImageUrl, publicProfile?.mediaKit.primaryLogo?.imageUrl);
    assert.notEqual(publicProfile?.avatarImageUrl, "https://legacy.example.test/community.png");

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(profileId, {
        fieldVisibility: { avatarImageUrl: "private", mediaKit: "public" },
      });
    });
    const privateAvatarProfile = await seeded.t.query(api.profiles.getPublicBySlug, {
      slug: "managed-community",
      includeTelemetry: false,
    });
    assert.equal(privateAvatarProfile?.mediaKit.primaryLogo?.assetId, assetId);
    assert.equal(privateAvatarProfile?.avatarImageUrl, undefined);
  });

  it("omits privately placed asset metadata from the public media-kit list", async () => {
    const seeded = await seedOwnedProfile(2);
    await seeded.t.run(async (ctx) => {
      const profileImagePlacement = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", seeded.assetIds[0]!))
        .unique();
      assert.notEqual(profileImagePlacement, null);
      await ctx.db.patch(profileImagePlacement!._id, { placement: "profile_image" });
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { avatarImageUrl: "private", mediaKit: "public" },
      });
    });

    const result = await seeded.t.query(api.profileAssets.listPublicBySlug, {
      slug: "media-owner",
    });
    assert.equal(result?.mediaKit.profileImage, undefined);
    assert.deepEqual(
      result?.mediaKit.assets.map((asset) => asset.assetId),
      [seeded.assetIds[1]],
    );
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

  it("expires an upload intent after bounded processing attempts", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "bounded-attempts.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Bounded attempts",
      altText: "A synthetic upload used to verify bounded processing attempts.",
    });

    for (let attempt = 0; attempt < PROFILE_ASSET_UPLOAD_PROCESSING_MAX_ATTEMPTS; attempt += 1) {
      const processingToken = `processing-${attempt}`;
      assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
      })).status, "claimed");
      assert.equal(await seeded.t.mutation(internal.profileAssets.releaseUploadIntentStorageClaim, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
      }), true);
    }

    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: "processing-exhausted",
    })).status, "not_found");
    const expired = await seeded.t.run(async (ctx) => await ctx.db.get(intent.intentId));
    assert.ok(expired);
    assert.equal(expired.expiresAt < Date.now(), true);
  });

  it("atomically fences storage processing for one upload request", async () => {
    const seeded = await seedOwnedProfile(0);
    const intent = await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.createUploadIntentForOwnedProfile,
      {
        profileId: seeded.profileId,
        originalFileName: "claimed.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Claimed upload",
        altText: "A synthetic claimed upload.",
      },
    );
    const firstToken = "processing-first";
    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: firstToken,
    })).status, "claimed");
    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: "processing-replay",
    })).status, "in_use");
    assert.equal(await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.cancelOwnedUploadIntent,
      {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
      },
    ), false);
    assert.deepEqual(await seeded.t.query(
      internal.profileAssets.getUploadIntentStateForStorageCleanup,
      {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken: firstToken,
      },
    ), { state: "pending" });
    assert.equal(await seeded.t.query(
      internal.profileAssets.getUploadIntentStateForStorageCleanup,
      {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken: "processing-replay",
      },
    ), null);
    assert.equal(await seeded.t.mutation(internal.profileAssets.releaseUploadIntentStorageClaim, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: firstToken,
    }), true);
    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: "processing-retry",
    })).status, "claimed");
  });

  it("expires an abandoned storage claim instead of reusing its object target", async () => {
    const seeded = await seedOwnedProfile(0);
    const intent = await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.createUploadIntentForOwnedProfile,
      {
        profileId: seeded.profileId,
        originalFileName: "abandoned.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Abandoned upload",
        altText: "A synthetic abandoned upload.",
      },
    );
    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: "processing-abandoned",
    })).status, "claimed");
    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, {
        processingStartedAt: Date.now() - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS - 1,
      });
    });

    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken: "processing-new",
    })).status, "not_found");
    const expired = await seeded.t.run(async (ctx) => await ctx.db.get(intent.intentId));
    assert.ok(expired);
    assert.equal(expired.processingToken, "processing-abandoned");
    assert.equal(expired.expiresAt < Date.now(), true);

    const cancellable = await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.createUploadIntentForOwnedProfile,
      {
        profileId: seeded.profileId,
        originalFileName: "abandoned-cancel.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Abandoned cancel upload",
        altText: "A second synthetic abandoned upload.",
      },
    );
    assert.equal((await seeded.t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: cancellable.intentId,
      uploadToken: cancellable.uploadToken,
      processingToken: "processing-cancellable",
    })).status, "claimed");
    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(cancellable.intentId, {
        processingStartedAt: Date.now() - PROFILE_ASSET_UPLOAD_PROCESSING_LEASE_MS - 1,
      });
    });
    assert.equal(await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.cancelOwnedUploadIntent,
      {
        intentId: cancellable.intentId,
        uploadToken: cancellable.uploadToken,
      },
    ), true);
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

  it("keeps pending upload reservations ahead of restores", async () => {
    const seeded = await seedOwnedProfile(11);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const deletedAssetId = await seeded.t.run(async (ctx) => {
      return await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/test/reserved-restore.png",
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
    await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "reserved.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Reserved upload",
      altText: "A synthetic reserved upload.",
    });

    await assert.rejects(owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: deletedAssetId,
      deleted: false,
    }), /up to 12/);
  });

  it("requires a gallery title before restore", async () => {
    const seeded = await seedOwnedProfile(1);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    await owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      deleted: true,
    });
    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.assetIds[0]!, {
        label: "   ",
        altText: "\t",
      });
    });

    await assert.rejects(owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      deleted: false,
    }), /title/);
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
    const duplicateProcessingToken = await claimUploadIntent(seeded, duplicateIntent);
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
        intentId: duplicateIntent.intentId,
        uploadToken: duplicateIntent.uploadToken,
        processingToken: duplicateProcessingToken,
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
    const featuredProcessingToken = await claimUploadIntent(seeded, featuredIntent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: featuredIntent.intentId,
      uploadToken: featuredIntent.uploadToken,
      processingToken: featuredProcessingToken,
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

  it("appends a new upload after the current gallery order", async () => {
    const seeded = await seedOwnedProfile(2);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    await owner.mutation(api.profileAssets.reorderOwnedGallery, {
      profileId: seeded.profileId,
      assetIds: [seeded.assetIds[1]!, seeded.assetIds[0]!],
    });
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "appended.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Appended",
      altText: "An appended gallery image.",
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/png",
      byteSize: 128,
      contentSha256: "appended-hash",
      width: 20,
      height: 20,
    });
    const gallery = await seeded.t.run(async (ctx) => {
      return await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", seeded.profileId).eq("placement", "gallery").eq("state", "active"),
        )
        .collect();
    });

    assert.deepEqual(
      gallery.sort((first, second) => first.position - second.position).map((item) => item.assetId),
      [seeded.assetIds[1], seeded.assetIds[0], completed.assetIds[0]],
    );
  });

  it("reindexes the gallery around an explicit upload position", async () => {
    const seeded = await seedOwnedProfile(2);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "inserted.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Inserted",
      altText: "An inserted gallery image.",
      position: 0,
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/png",
      byteSize: 128,
      contentSha256: "inserted-hash",
      width: 20,
      height: 20,
    });
    const gallery = await seeded.t.run(async (ctx) => {
      return await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", seeded.profileId).eq("placement", "gallery").eq("state", "active"),
        )
        .collect();
    });

    assert.deepEqual(
      gallery.sort((first, second) => first.position - second.position)
        .map((item) => [item.assetId, item.position]),
      [
        [completed.assetIds[0], 0],
        [seeded.assetIds[0], 1],
        [seeded.assetIds[1], 2],
      ],
    );
  });

  it("rejects invalid gallery insertion positions at the Convex boundary", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    for (const position of [-1, 0.5]) {
      await assert.rejects(
        owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
          profileId: seeded.profileId,
          originalFileName: `invalid-${position}.png`,
          mimeType: "image/png",
          byteSize: 128,
          label: "Invalid position",
          altText: "A synthetic invalid-position image.",
          position,
        }),
        /nonnegative integer/,
      );
    }
  });

  it("rejects a stale reorder that omits a concurrently added gallery item", async () => {
    const seeded = await seedOwnedProfile(2);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const concurrentAssetId = await seeded.t.run(async (ctx) => {
      const now = Date.now();
      const assetId = await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/test/concurrent.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Concurrent",
        altText: "A concurrently added gallery image.",
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: `api:${seeded.userId}`,
          issuer: "vrdex:api",
          subject: String(seeded.userId),
        },
        uploadedAt: now,
        state: "active",
        updatedAt: now,
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId: seeded.profileId,
        assetId,
        placement: "gallery",
        position: 2,
        state: "active",
        updatedAt: now,
      });
      return assetId;
    });

    await assert.rejects(
      owner.mutation(api.profileAssets.reorderOwnedGallery, {
        profileId: seeded.profileId,
        assetIds: [seeded.assetIds[1]!, seeded.assetIds[0]!],
      }),
      /Gallery changed/,
    );
    const profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(profiles?.[0]?.assets.some((asset) => asset.assetId === concurrentAssetId), true);
  });

  it("requires a title and accepts optional accessibility text for a public gallery upload", async () => {
    const seeded = await seedOwnedProfile();
    const intent = await seeded.t.withIdentity(seeded.ownerIdentity).mutation(
      api.profileAssets.createUploadIntentForOwnedProfile,
      {
        profileId: seeded.profileId,
        originalFileName: "optional-alt.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Optional alt",
        placements: ["gallery", "featured"],
      },
    );
    assert.ok(intent.intentId);
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
    assert.deepEqual(profiles?.[0]?.assets.map((asset) => asset.assetId), [...seeded.assetIds, unplacedAssetId]);
    assert.equal(profiles?.[0]?.activePublicAssetCount, 2);
    assert.equal(profiles?.[0]?.assets.find((asset) => asset.assetId === unplacedAssetId)?.gallery, false);
    assert.equal(profiles?.[0]?.assets.find((asset) => asset.assetId === unplacedAssetId)?.profileImage, false);
    assert.equal(profiles?.[0]?.assets.find((asset) => asset.assetId === unplacedAssetId)?.primaryLogo, false);
    await assert.rejects(
      owner.mutation(api.profileAssets.setOwnedFeaturedAsset, {
        profileId: seeded.profileId,
        assetId: unplacedAssetId,
      }),
      /titled public gallery item/,
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
    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Press portrait",
      altText: "",
    });
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
    assert.equal(profiles?.[0]?.assets[1]?.altText, undefined);
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

  it("treats malformed direct-upload intent IDs as missing", async () => {
    const seeded = await seedOwnedProfile(0);
    assert.equal(await seeded.t.query(internal.profileAssets.getUploadIntentForDirectStorage, {
      intentId: "not-a-convex-id",
      uploadToken: "synthetic-token",
    }), null);
  });

  it("replaces an asset atomically at the active asset quota", async () => {
    const seeded = await seedOwnedProfile(12);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    await owner.mutation(api.profileAssets.setOwnedFeaturedAsset, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
    });
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      replacesAssetId: seeded.assetIds[0]!,
      originalFileName: "replacement.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Asset 1",
      altText: "Replacement asset.",
      placements: [],
    });
    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Current title",
      caption: "Current caption",
      altText: "Current description.",
      credit: "Current credit",
      creditUrl: "https://example.com/current-credit",
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/webp",
      byteSize: 96,
      contentSha256: "replacement-hash",
      width: 20,
      height: 20,
    });
    const state = await seeded.t.run(async (ctx) => {
      const assets = await ctx.db
        .query("profileAssets")
        .withIndex("by_profileId", (query) => query.eq("profileId", seeded.profileId))
        .collect();
      const gallery = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", seeded.profileId).eq("placement", "gallery").eq("state", "active"),
        )
        .collect();
      const featured = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_placement_state_position", (query) =>
          query.eq("profileId", seeded.profileId).eq("placement", "featured").eq("state", "active"),
        )
        .collect();
      return { assets, featured, gallery };
    });
    const replacementId = completed.assetIds[0]!;
    assert.equal(state.assets.filter((asset) => asset.state === "active").length, 12);
    assert.equal(state.assets.find((asset) => asset._id === seeded.assetIds[0])?.state, "deleted");
    const replacement = state.assets.find((asset) => asset._id === replacementId);
    assert.equal(replacement?.label, "Current title");
    assert.equal(replacement?.caption, "Current caption");
    assert.equal(replacement?.altText, "Current description.");
    assert.equal(replacement?.credit, "Current credit");
    assert.equal(replacement?.creditUrl, "https://example.com/current-credit");
    assert.equal(state.gallery.find((placement) => placement.position === 0)?.assetId, replacementId);
    assert.equal(state.featured[0]?.assetId, replacementId);
  });

  it("uses entered metadata when replacing explicitly placed identity media", async () => {
    const seeded = await seedOwnedProfile(12);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    await seeded.t.run(async (ctx) => {
      const placement = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", seeded.assetIds[0]!))
        .unique();
      assert.notEqual(placement, null);
      await ctx.db.patch(placement!._id, { placement: "profile_image" });
    });
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      replacesAssetId: seeded.assetIds[0]!,
      originalFileName: "new-profile-image.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "New profile image",
      caption: "New caption",
      altText: "New profile image description.",
      credit: "New credit",
      creditUrl: "https://example.com/new-credit",
      placements: ["profile_image"],
    });
    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Old title",
      caption: "Old caption",
      altText: "Old description.",
      credit: "Old credit",
      creditUrl: "https://example.com/old-credit",
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/webp",
      byteSize: 96,
      contentSha256: "identity-replacement-hash",
      width: 20,
      height: 20,
    });
    const replacement = await seeded.t.run(async (ctx) => ctx.db.get(completed.assetIds[0]!));
    assert.equal(replacement?.label, "New profile image");
    assert.equal(replacement?.caption, "New caption");
    assert.equal(replacement?.altText, "New profile image description.");
    assert.equal(replacement?.credit, "New credit");
    assert.equal(replacement?.creditUrl, "https://example.com/new-credit");
  });

  it("rechecks the media-kit kill switch before finalizing a replacement", async () => {
    const seeded = await seedOwnedProfile(1);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      replacesAssetId: seeded.assetIds[0]!,
      originalFileName: "disabled-replacement.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Replacement",
      placements: [],
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    const previous = process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;
    delete process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED;

    try {
      await assert.rejects(
        seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
          intentId: intent.intentId,
          uploadToken: intent.uploadToken,
          processingToken,
          mimeType: "image/webp",
          byteSize: 96,
          contentSha256: "disabled-replacement-hash",
          width: 20,
          height: 20,
        }),
        /not enabled/,
      );
    } finally {
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = previous ?? "true";
    }
    const original = await seeded.t.run((ctx) => ctx.db.get(seeded.assetIds[0]!));
    assert.equal(original?.state, "active");
  });

  it("keeps the original active when replacement completion fails", async () => {
    const seeded = await seedOwnedProfile(12);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      replacesAssetId: seeded.assetIds[0]!,
      originalFileName: "duplicate-replacement.png",
      mimeType: "image/png",
      byteSize: 128,
      label: "Asset 1",
      placements: [],
    });
    const processingToken = await claimUploadIntent(seeded, intent);
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
        mimeType: "image/webp",
        byteSize: 96,
        contentSha256: "hash-1",
        width: 20,
        height: 20,
      }),
      /already exists/,
    );
    const original = await seeded.t.run((ctx) => ctx.db.get(seeded.assetIds[0]!));
    assert.equal(original?.state, "active");
  });

  it("persists captions, safe credit links, and preserved source/download variants", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
      profileId: seeded.profileId,
      originalFileName: "press portrait.png",
      mimeType: "image/png",
      byteSize: 512,
      label: "Press portrait",
      caption: "Synthetic launch caption.",
      credit: "Example Photographer",
      creditUrl: "https://example.test/photographer",
      placements: ["gallery", "featured"],
    });
    const directTarget = await seeded.t.query(
      internal.profileAssets.getUploadIntentForDirectStorage,
      { intentId: intent.intentId, uploadToken: intent.uploadToken },
    );
    assert.match(directTarget?.storageKey ?? "", /^profile-assets\/quarantine\//);
    const processingToken = await claimUploadIntent(seeded, intent);
    const completed = await seeded.t.mutation(internal.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/webp",
      byteSize: 256,
      contentSha256: "sanitized-download-hash",
      sourceMimeType: "image/png",
      sourceByteSize: 512,
      sourceContentSha256: "private-source-hash",
      downloadMimeType: "image/png",
      downloadByteSize: 480,
      downloadContentSha256: "sanitized-download-hash",
      width: 400,
      height: 300,
    });
    const profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    const asset = profiles?.[0]?.assets.find((candidate) => candidate.assetId === completed.assetIds[0]);

    assert.equal(asset?.caption, "Synthetic launch caption.");
    assert.equal(asset?.credit, "Example Photographer");
    assert.equal(asset?.creditUrl, "https://example.test/photographer");
    assert.equal(asset?.mimeType, "image/webp");
    assert.equal(asset?.downloadMimeType, "image/png");
    assert.equal(asset?.downloadByteSize, 480);
    assert.equal(asset?.sourcePreserved, true);
    assert.match(asset?.downloadUrl ?? "", /\?download=1$/);

    const publicAsset = await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
      slug: "media-owner",
      assetId: completed.assetIds[0]!,
    });
    assert.equal("sourceStorageKey" in (publicAsset ?? {}), false);
    assert.equal("sourceMimeType" in (publicAsset ?? {}), false);
    assert.equal(publicAsset?.downloadMimeType, "image/png");
    assert.deepEqual(
      await seeded.t.query(internal.profileAssets.getUploadIntentStateForStorageCleanup, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
      }),
      { state: "consumed" },
    );
    assert.equal(
      await seeded.t.query(internal.profileAssets.getUploadIntentStateForStorageCleanup, {
        intentId: intent.intentId,
        uploadToken: "wrong-token",
        processingToken,
      }),
      null,
    );
  });

  it("accepts every optional credit combination and rejects unsafe credit links", async () => {
    const seeded = await seedOwnedProfile(1);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);

    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Credit combinations",
      creditUrl: "http://example.test/credit",
    });
    let profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(profiles?.[0]?.assets[0]?.credit, undefined);
    assert.equal(profiles?.[0]?.assets[0]?.creditUrl, "http://example.test/credit");

    await owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
      profileId: seeded.profileId,
      assetId: seeded.assetIds[0]!,
      label: "Credit combinations",
      credit: "Example",
      creditUrl: "",
    });
    profiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(profiles?.[0]?.assets[0]?.credit, "Example");
    assert.equal(profiles?.[0]?.assets[0]?.creditUrl, undefined);

    for (const creditUrl of [
      "javascript:alert(1)",
      "ftp://example.test/file",
      "https://user:password@example.test/",
      "not a URL",
    ]) {
      await assert.rejects(
        owner.mutation(api.profileAssets.updateOwnedAssetMetadata, {
          profileId: seeded.profileId,
          assetId: seeded.assetIds[0]!,
          label: "Credit combinations",
          creditUrl,
        }),
        /Credit links/,
      );
    }
  });

  it("keeps direct upload and accessibility generation behind separate rollout flags", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const previousDirectUpload = process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED;
    const previousGeneration = process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED;
    delete process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED;
    delete process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED;

    try {
      const intent = await owner.mutation(api.profileAssets.createUploadIntentForOwnedProfile, {
        profileId: seeded.profileId,
        originalFileName: "compatibility.png",
        mimeType: "image/png",
        byteSize: 128,
        label: "Compatibility upload",
      });
      assert.equal(intent.directUploadUrl, undefined);
      await assert.rejects(
        owner.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
          profileId: seeded.profileId,
          requestId: crypto.randomUUID(),
          provider: "openai",
          model: "synthetic-model",
          imageBytes: 1_024,
        }),
        /not enabled/,
      );
    } finally {
      process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = previousDirectUpload ?? "true";
      process.env.VRDEX_PROFILE_MEDIA_ACCESSIBILITY_GENERATION_ENABLED =
        previousGeneration ?? "true";
    }
  });

  it("authorizes, rate-limits, and records content-free accessibility generation telemetry", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    const requestId = crypto.randomUUID();

    await assert.rejects(
      seeded.t.withIdentity(seeded.otherIdentity).mutation(
        api.profileAssets.claimOwnedAccessibilityGeneration,
        {
          profileId: seeded.profileId,
          requestId,
          provider: "openai",
          model: "synthetic-model",
          imageBytes: 1_024,
        },
      ),
      /Only the profile owner/,
    );
    const claim = await owner.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
      profileId: seeded.profileId,
      requestId,
      provider: "openai",
      model: "synthetic-model",
      imageBytes: 1_024,
    });
    assert.equal(claim.replay, false);
    const replay = await owner.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
      profileId: seeded.profileId,
      requestId,
      provider: "openai",
      model: "synthetic-model",
      imageBytes: 1_024,
    });
    assert.equal(replay.replay, true);
    assert.equal(replay.eventId, claim.eventId);
    await assert.rejects(
      owner.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
        profileId: seeded.profileId,
        requestId: crypto.randomUUID(),
        provider: "openai",
        model: "synthetic-model",
        imageBytes: 1_024,
      }),
      /Wait a moment/,
    );

    assert.equal(
      await seeded.t.mutation(internal.profileAssets.finishAccessibilityGeneration, {
        eventId: claim.eventId,
        requestId,
        result: "succeeded",
        descriptionLength: 52,
        latencyMs: 321,
      }),
      true,
    );
    const event = await seeded.t.run(async (ctx) => await ctx.db.get(claim.eventId));
    assert.equal(event?.result, "succeeded");
    assert.equal(event?.descriptionLength, 52);
    assert.equal(event?.latencyMs, 321);
    assert.equal("description" in (event ?? {}), false);
    assert.equal("image" in (event ?? {}), false);
  });

  it("rejects malformed accessibility generation telemetry metadata", async () => {
    const seeded = await seedOwnedProfile(0);
    const owner = seeded.t.withIdentity(seeded.ownerIdentity);
    for (const args of [
      {
        requestId: "not-a-uuid",
        provider: "openai" as const,
        model: "synthetic-model",
      },
      {
        requestId: crypto.randomUUID(),
        provider: "openai" as const,
        model: `model-${"x".repeat(100)}`,
      },
      {
        requestId: crypto.randomUUID(),
        provider: "other" as "openai",
        model: "synthetic-model",
      },
    ]) {
      await assert.rejects(
        owner.mutation(api.profileAssets.claimOwnedAccessibilityGeneration, {
          profileId: seeded.profileId,
          ...args,
          imageBytes: 1_024,
        }),
        /metadata|Validator/,
      );
    }
  });

  it("enforces the rolling daily accessibility generation limit", async () => {
    const seeded = await seedOwnedProfile(0);
    const now = Date.now();
    await seeded.t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        await ctx.db.insert("profileAssetAccessibilityGenerationEvents", {
          requestId: `prior-${index}`,
          userId: seeded.userId,
          profileId: seeded.profileId,
          provider: "openai",
          model: "synthetic-model",
          result: "failed",
          imageBytes: 1_024,
          errorCode: "provider",
          createdAt: now - 10_000 - index,
          completedAt: now - 9_000 - index,
        });
      }
    });

    await assert.rejects(
      seeded.t.withIdentity(seeded.ownerIdentity).mutation(
        api.profileAssets.claimOwnedAccessibilityGeneration,
        {
          profileId: seeded.profileId,
          requestId: crypto.randomUUID(),
          provider: "openai",
          model: "synthetic-model",
          imageBytes: 1_024,
        },
      ),
      /limit reached/,
    );
  });
});
