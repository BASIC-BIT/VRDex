import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schemaModule from "../../convex/schema";
import { getPublicCommunityTelemetry, getPublicGroupMembership } from "../../convex/_communityTelemetryPublic";
import { defaultClubVisibility } from "../../convex/_clubModel";
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/groupObservations.ts": () => import("../../convex/groupObservations"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/groupMemberSnapshots.ts": () => import("../../convex/groupMemberSnapshots"),
  "../../convex/clubConnection.ts": () => import("../../convex/clubConnection"),
  "../../convex/clubStaff.ts": () => import("../../convex/clubStaff"),
};
const ref = (name: string) => makeFunctionReference<"mutation">(name);
const GROUP = "grp_00000000-0000-4000-8000-000000000005";
async function setup() {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { clerkUserId: "operator", email: "operator@example.test" });
    const profile = { displayName: "Club", sortName: "club", aliases: [], tags: [], claimState: "unclaimed" as const, publicationState: "published" as const, publicSurfacingState: "public" as const, creationSource: "self" as const, updatedAt: now, profileType: "community" as const, community: { categoryTags: [] } };
    const profileId = await ctx.db.insert("profiles", { ...profile, slug: "controls" });
    const duplicateId = await ctx.db.insert("profiles", { ...profile, slug: "duplicate" });
    await ctx.db.insert("profileOwners", { profileId, userId, roleKey: "owner", state: "active", grantedAt: now, updatedAt: now });
    for (const id of [profileId, duplicateId]) {
      await ctx.db.insert("profileExternalLinks", { profileId: id, assetType: "vrchat_group", assetExternalId: GROUP, linkRole: "primary", state: "active", provenance: "directory_reference", createdAt: now, updatedAt: now });
      const categories = defaultClubVisibility(); categories.group_size.audience = "public";
      await ctx.db.insert("communityDataVisibility", { communityProfileId: id, categories, updatedAt: now });
    }
    // Verified links do not need a pending directory resolution in this fixture.
    for (const link of await ctx.db.query("profileExternalLinks").collect()) await ctx.db.patch(link._id, { provenance: undefined });
    const proofId = await ctx.db.insert("externalControlProofs", { userId, assetType: "vrchat_group", assetExternalId: GROUP, controlLevel: "manager", state: "active", evidenceSource: "vrchat_api", verifiedAt: now, revalidateAfter: now + 600000, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("collectorAccounts", { vrchatUserId: "usr_bot", accountAlias: "bot", state: "ready", capacity: 10, reservedHeadroom: 0, assignedGroupCount: 1, requestsPerMinute: 30, secretRef: "test", workerKeyHash: "hash", credentialGeneration: 1, killSwitchEnabled: false, createdAt: now, updatedAt: now });
    const integrationId = await ctx.db.insert("communityVrchatIntegrations", { collectionScope: { kind: "automatic" }, publicationPolicy: "automatic_aggregate", vrchatGroupId: GROUP, groupVisibility: "public", joinPolicy: "free", state: "active", assignedCollectorAccountId: accountId, killSwitchEnabled: false, requestsPerMinute: 4, leaseGeneration: 1, publicMetrics: { currentPopulation: true, populationHistory: true, groupMemberCount: true, groupMemberGrowth: true, eventRecaps: false }, telemetryEpochStartedAt: now - 86400000, consecutiveFailures: 0, createdAt: now - 86400000, updatedAt: now });
    const policyId = await ctx.db.insert("vrchatGroupObservationPolicies", { vrchatGroupId: GROUP, integrationId, decision: { kind: "enabled", at: now }, createdAt: now, updatedAt: now });
    await ctx.db.insert("collectorAccountLeases", { integrationId, collectorAccountId: accountId, workerId: "worker", fencingToken: 1, state: "active", claimedAt: now, expiresAt: now + 300000, updatedAt: now });
    await ctx.db.insert("vrchatGroupMemberSnapshots", { vrchatGroupId: GROUP, memberCount: 42, observedAt: now - 1000 });
    return { profileId, duplicateId, userId, proofId, accountId, integrationId, policyId };
  });
  const owner = t.withIdentity({ subject: "operator", issuer: "https://test.clerk.accounts.dev", tokenIdentifier: "https://test.clerk.accounts.dev|operator", email: "operator@example.test", emailVerified: true });
  const decision = (value: "stop" | "resume", republishRetainedHistory?: boolean) => owner.mutation(ref("groupObservations:setObservationDecision"), { vrchatGroupId: GROUP, decision: value, ...(republishRetainedHistory === undefined ? {} : { republishRetainedHistory }) });
  const adopt = () => owner.mutation(ref("communityTelemetry:connectGroup"), { communitySlug: "controls", vrchatGroupId: GROUP, groupVisibility: "public", joinPolicy: "free" });
  return { t, owner, now, ...ids, decision, adopt, worker: { collectorAccountId: ids.accountId, workerId: "worker", workerKeyHash: "hash" } };
}
it("group proof denies wrong group, unverified profile owners and expired proof", async () => {
  const h = await setup();
  for (const patch of [{ assetExternalId: GROUP + "-wrong" }, { assetExternalId: GROUP, state: "revoked" as const }, { state: "active" as const, revalidateAfter: h.now - 1 }]) {
    await h.t.run(ctx => ctx.db.patch(h.proofId, patch));
    await assert.rejects(h.decision("stop"), /CONTROL_NOT_VERIFIED/);
    await assert.rejects(h.adopt(), /CONTROL_NOT_VERIFIED/);
  }
});
it("adoption preserves identity, allocation, epoch, history and only enables analytics", async () => {
  const h = await setup(); const before = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(await h.adopt(), h.integrationId);
  const after = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(after?.telemetryEpochStartedAt, before?.telemetryEpochStartedAt);
  assert.equal(after?.assignedCollectorAccountId, h.accountId);
  assert.equal(after?.publicationPolicy, "automatic_aggregate");
  assert.deepEqual(after?.enabledFeatures, ["analytics"]);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.accountId)))?.assignedGroupCount, 1);
  assert.equal((await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.duplicateId)))?.latest.value, 42);
  assert.equal((await h.t.run(ctx => ctx.db.query("communityAuthorities").collect())).length, 0);
});
for (const writer of ["legacy", "category"] as const) it(`adoption then ${writer} private save hides owner and duplicate membership`, async () => {
  const h = await setup(); await h.adopt();
  if (writer === "legacy") await h.owner.mutation(ref("communityTelemetry:setPublicMetric"), { communitySlug: "controls", metric: "groupMemberCount", enabled: false });
  else await h.owner.mutation(ref("clubStaff:setCategoryVisibility"), { communitySlug: "controls", category: "group_size", audience: "owner", staffRoleIds: null, expected: { audience: "public", staffRoleIds: null } });
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.publicationPolicy, "managed_categories");
  for (const id of [h.profileId, h.duplicateId]) {
    assert.equal(await h.t.run(ctx => getPublicGroupMembership(ctx.db, id)), null);
    assert.equal((await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, id, Date.now())))?.groupMemberCount, undefined);
  }
});
it("stop race fences aggregate and standalone completion even after resume", async () => {
  const h = await setup();
  const claim = await h.t.mutation(ref("groupMemberSnapshots:claim"), { worker: h.worker, now: h.now }); assert.ok(claim);
  await h.decision("stop");
  for (const id of [h.profileId, h.duplicateId]) assert.equal(await h.t.run(ctx => getPublicGroupMembership(ctx.db, id)), null);
  await h.decision("resume");
  assert.equal(await h.t.mutation(ref("groupMemberSnapshots:authorize"), { worker: h.worker, linkId: claim.linkId, leaseToken: claim.leaseToken, now: Date.now() }), false);
  assert.equal(await h.t.mutation(ref("groupMemberSnapshots:complete"), { worker: h.worker, linkId: claim.linkId, leaseToken: claim.leaseToken, memberCount: 99, observedAt: h.now, now: Date.now() }), false);
  await assert.rejects(h.t.mutation(ref("communityTelemetry:ingestAggregatePoll"), { integrationId: h.integrationId, collectorAccountId: h.accountId, workerId: "worker", fencingToken: 1, pollId: "late", observedAt: h.now, collectorVersion: "test", source: "first_party", groupMemberCount: 99, instances: [], nextPollAt: h.now + 60000, now: Date.now() }), /stale|unavailable/);
  assert.equal((await h.t.run(ctx => ctx.db.query("vrchatGroupMemberSnapshots").collect())).length, 1);
});
it("resume excludes retained history by default and explicit verified choice republishes it", async () => {
  const h = await setup(); await h.decision("stop"); await h.decision("resume");
  assert.equal(await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.profileId)), null);
  assert.ok((await h.t.run(ctx => ctx.db.get(h.policyId)))!.publicHistoryStartAt! >= h.now);
  await h.decision("stop"); await h.decision("resume", true);
  assert.equal((await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.profileId)))?.latest.value, 42);
});
it("stop preserves management dependencies until the final feature is disabled", async () => {
  const h = await setup(); await h.adopt();
  await h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "posts", enabled: true });
  await h.decision("stop");
  const stopped = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(stopped?.state, "active"); assert.deepEqual(stopped?.enabledFeatures, ["analytics", "posts"]);
  await h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "posts", enabled: false });
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.state, "disconnecting");
  await assert.rejects(h.adopt(), /stopped|resume/i);
});
for (const writer of ["legacy", "category"] as const) it(`adoption ${writer} publication choice requires fresh exact group proof`, async () => {
  const h = await setup(); await h.adopt();
  const save = () => writer === "legacy"
    ? h.owner.mutation(ref("communityTelemetry:setPublicMetric"), { communitySlug: "controls", metric: "groupMemberCount", enabled: false })
    : h.owner.mutation(ref("clubStaff:setCategoryVisibility"), { communitySlug: "controls", category: "group_size", audience: "owner", staffRoleIds: null, expected: { audience: "public", staffRoleIds: null } });
  await h.t.run(ctx => ctx.db.patch(h.proofId, { assetExternalId: GROUP + "-wrong" }));
  await assert.rejects(save(), /CONTROL_NOT_VERIFIED/);
  await h.t.run(ctx => ctx.db.patch(h.proofId, { assetExternalId: GROUP, revalidateAfter: h.now - 1 }));
  await assert.rejects(save(), /CONTROL_NOT_VERIFIED/);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.publicationPolicy, "automatic_aggregate");
  assert.equal((await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.duplicateId)))?.latest.value, 42);
});
it("resume retains managed analytics-off and public member metadata without treating it as stopped", async () => {
  const h = await setup(); await h.adopt();
  await h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "analytics", enabled: false });
  await h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "posts", enabled: true });
  await h.decision("stop"); await h.decision("resume", true);
  assert.deepEqual((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.enabledFeatures, ["posts"]);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.policyId)))?.decision.kind, "admission_blocked");
  assert.equal((await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.duplicateId)))?.latest.value, 42);
});
it("stop survives duplicate reconciliation and revoked proofs cannot resume", async () => {
  const h = await setup(); await h.decision("stop");
  await h.t.mutation(ref("groupObservations:reconcileProfile"), { profileId: h.duplicateId, affectedGroupIds: [GROUP] });
  await h.t.run(ctx => ctx.db.patch(h.proofId, { state: "revoked" }));
  await assert.rejects(h.decision("resume", true), /CONTROL_NOT_VERIFIED/);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.policyId)))?.decision.kind, "stopped");
});
it("resume after membership cleanup preserves the retained epoch on admission", async () => {
  const h = await setup(); await h.adopt(); const before = await h.t.run(ctx => ctx.db.get(h.integrationId));
  await h.decision("stop");
  await h.t.run(async ctx => {
    await ctx.db.patch(h.integrationId, { state: "disconnected", assignedCollectorAccountId: undefined });
    await ctx.db.patch(h.accountId, { assignedGroupCount: 0 });
  });
  await h.decision("resume", true);
  await h.t.mutation(ref("groupObservations:admitQueued"), {});
  const after = await h.t.run(ctx => ctx.db.get(h.integrationId));
  assert.equal(after?.telemetryEpochStartedAt, before?.telemetryEpochStartedAt);
  assert.equal(after?.assignedCollectorAccountId, h.accountId);
});
it("adoption role deletion that changes visibility requires verified publication choice", async () => {
  const h = await setup();
  const roleId = await h.t.run(async ctx => {
    const roleId = await ctx.db.insert("communityRoles", { communityProfileId: h.profileId, key: "test", label: "Test", permissions: [], assignableRoleIds: [], state: "active", createdAt: h.now, updatedAt: h.now });
    const saved = (await ctx.db.query("communityDataVisibility").withIndex("by_communityProfileId", q => q.eq("communityProfileId", h.profileId)).unique())!;
    await ctx.db.patch(saved._id, { categories: { ...saved.categories, group_size: { audience: "staff", staffRoleIds: [roleId] } } });
    return roleId;
  });
  await h.adopt();
  await h.t.run(ctx => ctx.db.patch(h.proofId, { state: "revoked" }));
  const remove = () => h.owner.mutation(ref("clubStaff:deleteRole"), { communitySlug: "controls", roleId, expectedUpdatedAt: h.now });
  await assert.rejects(remove(), /CONTROL_NOT_VERIFIED/);
  await h.t.run(ctx => ctx.db.patch(h.proofId, { state: "active" }));
  await remove();
  assert.equal((await h.t.run(ctx => ctx.db.get(h.integrationId)))?.publicationPolicy, "managed_categories");
  assert.equal(await h.t.run(ctx => getPublicGroupMembership(ctx.db, h.duplicateId)), null);
});
for (const needsAdmission of [false, true]) it(`analytics re-enable restores resumed publication and preserves history boundary (admission=${needsAdmission})`, async () => {
  const h = await setup(); await h.adopt();
  const analytics = (enabled: boolean) => h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "analytics", enabled });
  await analytics(false);
  await h.owner.mutation(ref("clubConnection:setFeature"), { communityProfileId: h.profileId, feature: "posts", enabled: true });
  await h.decision("stop");
  if (needsAdmission) await h.t.run(async ctx => {
    await ctx.db.patch(h.integrationId, { state: "disconnected", assignedCollectorAccountId: undefined });
    await ctx.db.patch(h.accountId, { assignedGroupCount: 0 });
  });
  await h.decision("resume");
  const before = (await h.t.run(ctx => ctx.db.get(h.policyId)))!;
  assert.equal(before.decision.kind, "admission_blocked");
  await analytics(true);
  const after = (await h.t.run(ctx => ctx.db.get(h.policyId)))!;
  assert.equal(after.decision.kind, "enabled");
  assert.equal(after.publicHistoryStartAt, before.publicHistoryStartAt);
  if (needsAdmission) {
    assert.equal(after.queuedAdmission?.priority, "managed");
    assert.equal((await h.t.mutation(ref("groupObservations:admitQueued"), {})).admitted, 1);
    await h.t.run(ctx => ctx.db.patch(h.integrationId, { state: "active" }));
  }
  const observedAt = before.publicHistoryStartAt! + 1;
  await h.t.run(ctx => ctx.db.insert("communityPopulationObservations", { integrationId: h.integrationId, idempotencyKey: "after-resume", totalPopulation: 7, activeInstanceCount: 1, worldDistribution: [], observedAt, source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 3 }));
  for (const id of [h.profileId, h.duplicateId]) {
    const readback = await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, id, observedAt));
    assert.equal(readback?.currentPopulation?.value, 7);
    assert.equal(readback?.groupMemberCount, undefined);
  }
  await h.decision("stop"); await analytics(false); await analytics(true);
  assert.equal((await h.t.run(ctx => ctx.db.get(h.policyId)))?.decision.kind, "stopped");
  assert.equal(await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, h.profileId, observedAt)), null);
});
for (const republish of [false, true]) it(`managed resume growth uses only permitted history (republish=${republish})`, async () => {
  const h = await setup(); await h.adopt();
  await h.owner.mutation(ref("communityTelemetry:setPublicMetric"), { communitySlug: "controls", metric: "groupMemberGrowth", enabled: true });
  const foundingAt = h.now - 86400000;
  const recordMember = (memberCount: number, observedAt: number) => h.t.run(ctx => ctx.db.insert("communityMemberCountObservations", { integrationId: h.integrationId, communityProfileId: h.profileId, idempotencyKey: `member-${observedAt}`, vrchatGroupId: GROUP, memberCount, observedAt, source: "first_party", collectorVersion: "test", coverageState: "observed", fencingToken: 3 }));
  await h.t.run(ctx => ctx.db.insert("vrchatGroupMemberMetadata", { vrchatGroupId: GROUP, groupCreatedAt: foundingAt, updatedAt: h.now }));
  await recordMember(42, h.now - 1000);
  await h.decision("stop"); await h.decision("resume", republish);
  const firstAt = Date.now() + 1;
  await recordMember(44, firstAt); await recordMember(46, firstAt + 1);
  const readback = await h.t.run(ctx => getPublicCommunityTelemetry(ctx.db, h.profileId, firstAt + 1));
  assert.deepEqual(readback?.groupMemberGrowth, { value: republish ? 45 : 2, startAt: republish ? foundingAt : firstAt, endAt: firstAt + 1 });
  assert.equal(readback?.groupMemberCount?.value, 46);
});
