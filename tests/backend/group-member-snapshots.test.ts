import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { internal } from "../../convex/_generated/api";
import { setProfileSurfacing } from "../../convex/_profileSurfacing";
import schemaModule from "../../convex/schema";

const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/groupMemberSnapshots.ts": () => import("../../convex/groupMemberSnapshots"),
};
const GROUP = "grp_00000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-29T12:00:00Z");

async function fixture() {
  const t = convexTest({ schema, modules });
  const { accountId, profileId } = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_00000000-0000-4000-8000-000000000001",
      accountAlias: "collector", state: "ready", capacity: 1, reservedHeadroom: 0,
      assignedGroupCount: 0, requestsPerMinute: 30, secretRef: "test", workerKeyHash: "a".repeat(64),
      credentialGeneration: 1, killSwitchEnabled: false, createdAt: NOW, updatedAt: NOW,
    });
    const profileId = await ctx.db.insert("profiles", {
      slug: "test-club", displayName: "Test Club", sortName: "test club", aliases: [], tags: [],
      profileType: "community", community: { categoryTags: [] }, claimState: "claimed_verified",
      publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: NOW,
    });
    await ctx.db.insert("profileExternalLinks", {
      profileId, assetType: "vrchat_group", assetExternalId: GROUP, linkRole: "primary", state: "active",
      createdAt: NOW, updatedAt: NOW,
    });
    const categories = {
      current_population: { audience: "staff", staffRoleIds: null },
      population_history: { audience: "staff", staffRoleIds: null },
      group_size: { audience: "public", staffRoleIds: null },
      membership_movement: { audience: "staff", staffRoleIds: null },
      individual_membership_history: { audience: "staff", staffRoleIds: null },
      instance_history: { audience: "staff", staffRoleIds: null },
      event_recaps: { audience: "staff", staffRoleIds: null },
    } as const;
    await ctx.db.insert("communityDataVisibility", { communityProfileId: profileId, categories, updatedAt: NOW });
    return { accountId, profileId };
  });
  const worker = { collectorAccountId: accountId, workerId: "worker-1", workerKeyHash: "a".repeat(64) };
  return { t, worker, profileId };
}

it("claims an unconnected primary group and retains a timestamped count", async () => {
  const { t, worker } = await fixture();
  const claim = await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW });
  assert.equal(claim?.vrchatGroupId, GROUP);
  assert.equal(await t.mutation(internal.groupMemberSnapshots.complete, {
    worker, linkId: claim!.linkId, leaseToken: claim!.leaseToken,
    memberCount: 42, groupCreatedAt: NOW - 86_400_000, observedAt: NOW, now: NOW,
  }), true);
  const rows = await t.run(ctx => ctx.db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", q => q.eq("vrchatGroupId", GROUP)).collect());
  assert.deepEqual(rows.map(({ memberCount, observedAt, groupCreatedAt }) => ({ memberCount, observedAt, groupCreatedAt })), [
    { memberCount: 42, observedAt: NOW, groupCreatedAt: NOW - 86_400_000 },
  ]);
  assert.equal(await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW + 60_000 }), null);
});

it("provider failure preserves the last point", async () => {
  const { t, worker } = await fixture();
  const first = (await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW }))!;
  await t.mutation(internal.groupMemberSnapshots.complete, {
    worker, linkId: first.linkId, leaseToken: first.leaseToken, memberCount: 42, observedAt: NOW, now: NOW,
  });
  const next = (await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW + 86_400_000 }))!;
  await t.mutation(internal.groupMemberSnapshots.complete, {
    worker, linkId: next.linkId, leaseToken: next.leaseToken, observedAt: NOW + 86_400_000, now: NOW + 86_400_000,
  });
  const rows = await t.run(ctx => ctx.db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", q => q.eq("vrchatGroupId", GROUP)).collect());
  assert.deepEqual(rows.map(row => [row.memberCount, row.observedAt]), [[42, NOW]]);
});

it("restoring a public community makes its first group read due immediately", async () => {
  const { t, worker, profileId } = await fixture();
  await t.run(async (ctx) => ctx.db.patch(profileId, { publicSurfacingState: "archived" }));
  assert.equal(await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW }), null);
  await t.run(async (ctx) => {
    const profile = (await ctx.db.get(profileId))!;
    await setProfileSurfacing(ctx.db, profile, { state: "public", reason: "restored", now: NOW + 60_000 });
  });
  const claim = await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW + 60_000 });
  assert.equal(claim?.vrchatGroupId, GROUP);
});

it("private visibility is not claimed and shared groups reuse a fresh point", async () => {
  const { t, worker, profileId } = await fixture();
  await t.run(async ctx => {
    const visibility = await ctx.db.query("communityDataVisibility")
      .withIndex("by_communityProfileId", q => q.eq("communityProfileId", profileId)).unique();
    await ctx.db.patch(visibility!._id, {
      categories: { ...visibility!.categories, group_size: { audience: "staff", staffRoleIds: null } },
    });
  });
  assert.equal(await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW }), null);
  await t.run(async ctx => {
    const visibility = await ctx.db.query("communityDataVisibility")
      .withIndex("by_communityProfileId", q => q.eq("communityProfileId", profileId)).unique();
    await ctx.db.patch(visibility!._id, {
      categories: { ...visibility!.categories, group_size: { audience: "public", staffRoleIds: null } },
    });
    const primary = await ctx.db.query("profileExternalLinks")
      .withIndex("by_profileId_assetType_state", q => q.eq("profileId", profileId).eq("assetType", "vrchat_group").eq("state", "active")).first();
    await ctx.db.patch(primary!._id, { nextMemberPollAt: undefined });
  });
  const first = (await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW }))!;
  await t.mutation(internal.groupMemberSnapshots.complete, {
    worker, linkId: first.linkId, leaseToken: first.leaseToken, memberCount: 42, observedAt: NOW, now: NOW,
  });
  await t.run(async ctx => {
    const other = await ctx.db.insert("profiles", {
      slug: "second-club", displayName: "Second Club", sortName: "second club", aliases: [], tags: [],
      profileType: "community", community: { categoryTags: [] }, claimState: "claimed_verified",
      publicationState: "published", publicSurfacingState: "public", creationSource: "self", updatedAt: NOW,
    });
    await ctx.db.insert("profileExternalLinks", {
      profileId: other, assetType: "vrchat_group", assetExternalId: GROUP, linkRole: "primary", state: "active",
      createdAt: NOW, updatedAt: NOW,
    });
    const visibility = await ctx.db.query("communityDataVisibility")
      .withIndex("by_communityProfileId", q => q.eq("communityProfileId", profileId)).unique();
    await ctx.db.insert("communityDataVisibility", { communityProfileId: other, categories: visibility!.categories, updatedAt: NOW });
  });
  assert.equal(await t.mutation(internal.groupMemberSnapshots.claim, { worker, now: NOW + 60_000 }), null);
  const rows = await t.run(ctx => ctx.db.query("vrchatGroupMemberSnapshots")
    .withIndex("by_vrchatGroupId_observedAt", q => q.eq("vrchatGroupId", GROUP)).collect());
  assert.equal(rows.length, 1);
});
