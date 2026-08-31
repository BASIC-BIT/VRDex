import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const KEY_HASH = "a".repeat(64);
const FINGERPRINT = "b".repeat(64);

async function seedOwnedMedia() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const seeded = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId: `user_${crypto.randomUUID()}`,
      email: "mcp-media-owner@example.test",
      emailVerificationTime: now,
    });
    const profileId = await ctx.db.insert("profiles", {
      profileType: "person",
      slug: "mcp-media-owner",
      displayName: "MCP Media Owner",
      sortName: "mcp media owner",
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
    const assetIds: Id<"profileAssets">[] = [];
    for (let index = 0; index < 2; index += 1) {
      const assetId = await ctx.db.insert("profileAssets", {
        profileId,
        storageKey: `profile-assets/private/${index}.webp`,
        sourceStorageKey: `profile-assets/private/${index}-source.png`,
        sourceUrl: `https://images.example.test/${index}.png`,
        contentSha256: `content-${index}`,
        mimeType: "image/webp",
        byteSize: 128,
        label: `Asset ${index + 1}`,
        altText: `Synthetic asset ${index + 1}.`,
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

    return { userId, profileId, assetIds };
  });
  return { t, ...seeded };
}

function attribution(userId: Id<"users">) {
  return {
    ownerUserId: userId,
    oauthClientId: "mcp-client",
    oauthTokenId: "oauth-token-id",
    requestId: crypto.randomUUID(),
  };
}

describe("hosted MCP profile media", () => {
  it("returns an owner-safe inventory and rejects a stale update", async () => {
    const seeded = await seedOwnedMedia();
    const inventory = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });

    assert.ok(inventory);
    assert.match(inventory.mediaVersion, /^[a-f0-9]{64}$/u);
    assert.equal(inventory.assets.length, 2);
    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, /storageKey|sourceUrl|contentSha256|uploadToken/u);

    const updated = await seeded.t.mutation(
      internal.profileAssets.manageOwnedMediaForMcpActor,
      {
        ...attribution(seeded.userId),
        slug: "mcp-media-owner",
        expectedMediaVersion: inventory.mediaVersion,
        asset: {
          assetId: seeded.assetIds[0]!,
          metadata: { caption: "Updated through MCP.", altText: null },
          placements: ["gallery", "featured"],
        },
        galleryOrder: [seeded.assetIds[1]!, seeded.assetIds[0]!],
      },
    );

    assert.notEqual(updated.mediaVersion, inventory.mediaVersion);
    assert.equal(updated.assets[1]?.caption, "Updated through MCP.");
    assert.equal(updated.assets[1]?.altText, undefined);
    assert.deepEqual(
      updated.assets[1]?.placements.map((item) => item.placement).sort(),
      ["featured", "gallery"],
    );
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.manageOwnedMediaForMcpActor, {
        ...attribution(seeded.userId),
        slug: "mcp-media-owner",
        expectedMediaVersion: inventory.mediaVersion,
        asset: { assetId: seeded.assetIds[0]!, state: "deleted" },
      }),
      /MCP_MEDIA_VERSION_CONFLICT/u,
    );
  });

  it("soft-deletes and restores one item without an idempotency key", async () => {
    const seeded = await seedOwnedMedia();
    const initial = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });
    assert.ok(initial);

    const deleted = await seeded.t.mutation(internal.profileAssets.manageOwnedMediaForMcpActor, {
      ...attribution(seeded.userId),
      slug: "mcp-media-owner",
      expectedMediaVersion: initial.mediaVersion,
      asset: { assetId: seeded.assetIds[0]!, state: "deleted" },
    });
    assert.equal(deleted.assets.find((asset) => asset.assetId === seeded.assetIds[0])?.state, "deleted");

    const reordered = await seeded.t.mutation(
      internal.profileAssets.manageOwnedMediaForMcpActor,
      {
        ...attribution(seeded.userId),
        slug: "mcp-media-owner",
        expectedMediaVersion: deleted.mediaVersion,
        galleryOrder: [seeded.assetIds[1]!],
      },
    );
    const restored = await seeded.t.mutation(internal.profileAssets.manageOwnedMediaForMcpActor, {
      ...attribution(seeded.userId),
      slug: "mcp-media-owner",
      expectedMediaVersion: reordered.mediaVersion,
      asset: { assetId: seeded.assetIds[0]!, state: "active" },
    });
    const restoredAsset = restored.assets.find(
      (asset) => asset.assetId === seeded.assetIds[0],
    );
    assert.equal(restoredAsset?.state, "active");
    assert.deepEqual(restoredAsset?.placements, [{ placement: "gallery", position: 1 }]);
  });

  it("retires a displaced singleton asset when an MCP update replaces it", async () => {
    const seeded = await seedOwnedMedia();
    await seeded.t.run(async (ctx) => {
      const firstAssetPlacements = await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_assetId", (query) => query.eq("assetId", seeded.assetIds[0]!))
        .collect();
      await Promise.all(
        firstAssetPlacements.map((placement) =>
          ctx.db.patch(placement._id, { state: "deleted", updatedAt: Date.now() }),
        ),
      );
      await ctx.db.insert("profileAssetPlacements", {
        profileId: seeded.profileId,
        assetId: seeded.assetIds[0]!,
        placement: "profile_image",
        position: 0,
        state: "active",
        updatedAt: Date.now(),
      });
    });
    const inventory = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });
    assert.ok(inventory);

    await seeded.t.mutation(internal.profileAssets.manageOwnedMediaForMcpActor, {
      ...attribution(seeded.userId),
      slug: "mcp-media-owner",
      expectedMediaVersion: inventory.mediaVersion,
      asset: {
        assetId: seeded.assetIds[1]!,
        placements: ["gallery", "profile_image"],
      },
    });
    const displaced = await seeded.t.run(
      async (ctx) => await ctx.db.get(seeded.assetIds[0]!),
    );
    assert.equal(displaced?.state, "deleted");
    assert.equal(typeof displaced?.retiredAt, "number");
    const updatedInventory = await seeded.t.query(
      internal.profileAssets.getOwnedMediaForMcpActor,
      { ownerUserId: seeded.userId, slug: "mcp-media-owner" },
    );
    assert.equal(
      updatedInventory?.assets.some((asset) => asset.assetId === seeded.assetIds[0]),
      false,
    );
  });

  it("reuses an import intent without returning its one-time upload token", async () => {
    const seeded = await seedOwnedMedia();
    const inventory = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });
    assert.ok(inventory);
    const input = {
      ...attribution(seeded.userId),
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      slug: "mcp-media-owner",
      expectedMediaVersion: inventory.mediaVersion,
      sourceUrl: "https://images.example.test/new.png",
      label: "Imported image",
      placements: ["gallery" as const],
    };

    const created = await seeded.t.mutation(
      internal.profileAssets.createImportIntentForMcpOwner,
      input,
    );
    assert.equal(created.status, "pending");
    assert.equal("uploadToken" in created, false);
    const replayed = await seeded.t.mutation(
      internal.profileAssets.createImportIntentForMcpOwner,
      { ...input, requestId: crypto.randomUUID() },
    );
    assert.deepEqual(replayed, created);
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.createImportIntentForMcpOwner, {
        ...input,
        requestFingerprint: "c".repeat(64),
      }),
      /MCP_WRITE_DENIED/u,
    );

    const stored = await seeded.t.run(async (ctx) => await ctx.db.get(created.intentId));
    assert.ok(stored?.uploadToken);
    assert.equal(stored?.mcpIdempotencyKeyHash, KEY_HASH);
    assert.equal(stored?.mimeType, "application/octet-stream");
    const auditRows = await seeded.t.run(
      async (ctx) => await ctx.db.query("apiWriteAuditEvents").collect(),
    );
    assert.equal(auditRows.some((row) => row.targetIntentId !== undefined), false);
  });

  it("keeps credentials hidden through claim and completes a replayable import", async () => {
    const seeded = await seedOwnedMedia();
    const inventory = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });
    assert.ok(inventory);
    const input = {
      ...attribution(seeded.userId),
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      slug: "mcp-media-owner",
      expectedMediaVersion: inventory.mediaVersion,
      sourceUrl: "https://images.example.test/new.png",
      label: "Imported image",
      placements: ["gallery" as const],
    };
    const created = await seeded.t.mutation(
      internal.profileAssets.createImportIntentForMcpOwner,
      input,
    );
    assert.equal(created.status, "pending");
    const processingToken = crypto.randomUUID();
    const claim = await seeded.t.mutation(
      internal.profileAssets.claimMcpImportIntentForStorage,
      { intentId: created.intentId, processingToken },
    );
    assert.equal(claim.status, "claimed");
    assert.equal("uploadToken" in claim, false);

    const completed = await seeded.t.mutation(
      internal.profileAssets.markMcpImportIntentUploaded,
      {
        intentId: created.intentId,
        processingToken,
        mimeType: "image/webp",
        byteSize: 96,
        sourceMimeType: "image/png",
        sourceByteSize: 128,
        sourceContentSha256: "source-hash",
        downloadMimeType: "image/png",
        downloadByteSize: 120,
        downloadContentSha256: "new-content-hash",
        contentSha256: "new-content-hash",
        width: 40,
        height: 40,
      },
    );
    assert.equal(completed.assetIds.length, 1);

    const replayed = await seeded.t.mutation(
      internal.profileAssets.createImportIntentForMcpOwner,
      { ...input, requestId: crypto.randomUUID() },
    );
    assert.equal(replayed.status, "completed");
    assert.deepEqual(replayed.assetIds, completed.assetIds);
    assert.equal("uploadToken" in replayed, false);
    const auditRows = await seeded.t.run(
      async (ctx) => await ctx.db.query("apiWriteAuditEvents").collect(),
    );
    assert.equal(auditRows.some((row) => row.targetIntentId !== undefined), false);
  });

  it("rechecks claimed ownership immediately before import finalization", async () => {
    const seeded = await seedOwnedMedia();
    const inventory = await seeded.t.query(internal.profileAssets.getOwnedMediaForMcpActor, {
      ownerUserId: seeded.userId,
      slug: "mcp-media-owner",
    });
    assert.ok(inventory);
    const input = {
      ...attribution(seeded.userId),
      idempotencyKeyHash: KEY_HASH,
      requestFingerprint: FINGERPRINT,
      slug: "mcp-media-owner",
      expectedMediaVersion: inventory.mediaVersion,
      sourceUrl: "https://images.example.test/new.png",
      label: "Imported image",
      placements: ["gallery" as const],
    };
    const created = await seeded.t.mutation(
      internal.profileAssets.createImportIntentForMcpOwner,
      input,
    );
    assert.equal(created.status, "pending");
    const processingToken = crypto.randomUUID();
    const claim = await seeded.t.mutation(
      internal.profileAssets.claimMcpImportIntentForStorage,
      { intentId: created.intentId, processingToken },
    );
    assert.equal(claim.status, "claimed");

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        claimState: "unclaimed",
        updatedAt: Date.now(),
      });
    });
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.markMcpImportIntentUploaded, {
        intentId: created.intentId,
        processingToken,
        mimeType: "image/webp",
        byteSize: 96,
        contentSha256: "new-content-hash",
      }),
      /MCP_MEDIA_INVALID/u,
    );
    await assert.rejects(
      seeded.t.mutation(internal.profileAssets.createImportIntentForMcpOwner, {
        ...input,
        requestId: crypto.randomUUID(),
      }),
      /MCP_WRITE_DENIED/u,
    );
  });
});
