import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

import { newClerkUserId } from "./_clerkTestIdentity";
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/events.ts": () => import("../../convex/events"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-07-24T12:00:00.000Z");
const KEY_HASH = "a".repeat(64);
const CREATE_FINGERPRINT = "b".repeat(64);

function isMcpWriteDenied(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "data" in error
    && typeof error.data === "object"
    && error.data !== null
    && "code" in error.data
    && error.data.code === "MCP_WRITE_DENIED";
}

async function seedCommunityOwner(t: ReturnType<typeof convexTest>, suffix: string) {
  return t.run(async (ctx) => {
    const clerkUserId = newClerkUserId();
    const userId = await ctx.db.insert("users", {
      clerkUserId: clerkUserId,
      name: `Community Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      emailVerificationTime: NOW,
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: `faceless-${suffix}`,
      displayName: `The Faceless ${suffix}`,
      sortName: `the faceless ${suffix}`,
      aliases: [],
      tags: [],
      claimState: "claimed_verified",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "self",
      updatedAt: NOW,
      profileType: "community",
      community: { categoryTags: [] },
    });
    await ctx.db.insert("profileOwners", {
      profileId,
      userId,
      roleKey: "owner",
      state: "active",
      grantedAt: NOW,
      updatedAt: NOW,
    });

    return { profileId, slug: `faceless-${suffix}`, userId };
  });
}

function createAttribution(
  ownerUserId: Awaited<ReturnType<typeof seedCommunityOwner>>["userId"],
  overrides: Partial<{
    oauthClientId: string;
    oauthTokenId: string;
    requestId: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
  }> = {},
) {
  return {
    ownerUserId,
    oauthClientId: "https://client.example/mcp.json",
    oauthTokenId: "oauth-token-id-1",
    requestId: "mcp-request-1",
    idempotencyKeyHash: KEY_HASH,
    requestFingerprint: CREATE_FINGERPRINT,
    ...overrides,
  };
}

describe("hosted MCP event writes", () => {
  it("returns the durable receipt when an identical create request is replayed", async () => {
    const t = convexTest({ schema, modules });
    const owner = await seedCommunityOwner(t, "replay");
    const args = {
      ...createAttribution(owner.userId),
      title: "Faceless Friday",
      communitySlug: owner.slug,
      startAt: NOW + 86_400_000,
      summary: "Created once.",
    };

    const first = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
    const replay = await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
    const stored = await t.run(async (ctx) => ({
      events: await ctx.db.query("events").collect(),
      receipts: await ctx.db.query("mcpEventWriteReceipts").collect(),
      audits: await ctx.db.query("apiWriteAuditEvents").collect(),
    }));

    assert.deepEqual(replay, first);
    assert.equal(stored.events.length, 1);
    assert.equal(stored.receipts.length, 1);
    assert.equal(stored.audits.length, 1);
    assert.equal(stored.receipts[0]?.idempotencyKeyHash, KEY_HASH);
    assert.equal(stored.receipts[0]?.requestFingerprint, CREATE_FINGERPRINT);
    assert.equal(stored.audits[0]?.routeClass, "authenticated_mcp_write");
    assert.equal(stored.audits[0]?.mcpToolName, "vrdex_event_create");
    assert.equal(stored.audits[0]?.oauthClientId, args.oauthClientId);
    assert.equal(stored.audits[0]?.oauthTokenId, args.oauthTokenId);
    assert.equal(stored.audits[0]?.requestId, args.requestId);
  });

  it("rejects reuse of a client-scoped idempotency key for a different request", async () => {
    const t = convexTest({ schema, modules });
    const owner = await seedCommunityOwner(t, "conflict");
    const args = {
      ...createAttribution(owner.userId),
      title: "Faceless Friday",
      communitySlug: owner.slug,
      startAt: NOW + 86_400_000,
    };

    await t.mutation(internal.events.createCommunityEventForMcpOwner, args);
    await assert.rejects(
      t.mutation(internal.events.createCommunityEventForMcpOwner, {
        ...args,
        requestFingerprint: "c".repeat(64),
        title: "A different event",
      }),
      isMcpWriteDenied,
    );

    const stored = await t.run(async (ctx) => ({
      events: await ctx.db.query("events").collect(),
      receipts: await ctx.db.query("mcpEventWriteReceipts").collect(),
      audits: await ctx.db.query("apiWriteAuditEvents").collect(),
    }));
    assert.equal(stored.events.length, 1);
    assert.equal(stored.receipts.length, 1);
    assert.equal(stored.audits.length, 1);
  });

  it("scopes the same key hash independently for different OAuth clients", async () => {
    const t = convexTest({ schema, modules });
    const owner = await seedCommunityOwner(t, "clients");
    const first = await t.mutation(internal.events.createCommunityEventForMcpOwner, {
      ...createAttribution(owner.userId),
      title: "Client One Event",
      communitySlug: owner.slug,
      startAt: NOW + 86_400_000,
    });
    const second = await t.mutation(internal.events.createCommunityEventForMcpOwner, {
      ...createAttribution(owner.userId, {
        oauthClientId: "https://second-client.example/mcp.json",
        oauthTokenId: "oauth-token-id-2",
        requestId: "mcp-request-2",
        requestFingerprint: "d".repeat(64),
      }),
      title: "Client Two Event",
      communitySlug: owner.slug,
      startAt: NOW + 172_800_000,
    });

    assert.notEqual(second.eventId, first.eventId);
    const receipts = await t.run(async (ctx) => ctx.db.query("mcpEventWriteReceipts").collect());
    assert.equal(receipts.length, 2);
    assert.deepEqual(
      new Set(receipts.map((receipt) => receipt.oauthClientId)),
      new Set([
        "https://client.example/mcp.json",
        "https://second-client.example/mcp.json",
      ]),
    );
  });

  it("preserves omission/null semantics and rejects a non-owner update", async () => {
    const t = convexTest({ schema, modules });
    const owner = await seedCommunityOwner(t, "update");
    const other = await seedCommunityOwner(t, "other");
    const created = await t.mutation(internal.events.createCommunityEventForApiOwner, {
      actorKind: "personal_api_token",
      ownerUserId: owner.userId,
      title: "Faceless Friday",
      communitySlug: owner.slug,
      startAt: NOW + 86_400_000,
      timezone: "UTC",
      summary: "Clear me.",
      notes: "Preserve me.",
    });

    const updated = await t.mutation(internal.events.updateCommunityEventForMcpOwner, {
      ...createAttribution(owner.userId, {
        idempotencyKeyHash: "e".repeat(64),
        requestFingerprint: "f".repeat(64),
      }),
      currentSlug: created.slug,
      summary: null,
      timezone: null,
    });
    const stored = await t.run(async (ctx) => ctx.db.get(created.eventId));

    assert.equal(updated.eventId, created.eventId);
    assert.equal(stored?.summary, undefined);
    assert.equal(stored?.timezone, undefined);
    assert.equal(stored?.notes, "Preserve me.");

    await assert.rejects(
      t.mutation(internal.events.updateCommunityEventForMcpOwner, {
        ...createAttribution(other.userId, {
          idempotencyKeyHash: "1".repeat(64),
          requestFingerprint: "2".repeat(64),
        }),
        currentSlug: updated.slug,
        summary: "Unauthorized edit",
      }),
      isMcpWriteDenied,
    );

    const receipts = await t.run(async (ctx) => ctx.db.query("mcpEventWriteReceipts").collect());
    assert.equal(receipts.length, 1);
  });

  it("accepts the OAuth layer's maximum-length client metadata URL for create and update", async () => {
    const t = convexTest({ schema, modules });
    const owner = await seedCommunityOwner(t, "long-client-id");
    const clientIdPrefix = "https://client.example/";
    const oauthClientId = `${clientIdPrefix}${"a".repeat(2048 - clientIdPrefix.length)}`;
    const created = await t.mutation(internal.events.createCommunityEventForMcpOwner, {
      ...createAttribution(owner.userId, { oauthClientId }),
      title: "Long Client Event",
      communitySlug: owner.slug,
      startAt: NOW + 86_400_000,
    });
    const updated = await t.mutation(internal.events.updateCommunityEventForMcpOwner, {
      ...createAttribution(owner.userId, {
        oauthClientId,
        idempotencyKeyHash: "3".repeat(64),
        requestFingerprint: "4".repeat(64),
      }),
      currentSlug: created.slug,
      summary: "Updated through the same client.",
    });
    const stored = await t.run(async (ctx) => ({
      audits: await ctx.db.query("apiWriteAuditEvents").collect(),
      receipts: await ctx.db.query("mcpEventWriteReceipts").collect(),
    }));

    assert.equal(updated.eventId, created.eventId);
    assert.equal(stored.audits.length, 2);
    assert.equal(stored.receipts.length, 2);
    assert.equal(stored.audits.every((audit) => audit.oauthClientId === oauthClientId), true);
    assert.equal(stored.receipts.every((receipt) => receipt.oauthClientId === oauthClientId), true);
  });
});
