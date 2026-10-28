import assert from "node:assert/strict";
import { it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { clerkTestIdentity, newClerkUserId } from "./_clerkTestIdentity";

const modules = {
  "../../convex/groupObservations.ts": () => import("../../convex/groupObservations"),
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/communityTelemetry.ts": () => import("../../convex/communityTelemetry"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
  "../../convex/claimAnalytics.ts": () => import("../../convex/claimAnalytics"),
  "../../convex/claimAnalyticsDelivery.ts": () => import("../../convex/claimAnalyticsDelivery"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;

// Application handlers and persistence are real; Clerk identities and collector
// verdicts are isolated fixtures. This does not attest a live VRChat bio read.
it("isolates two claimants and grants a competing VRChat proof to exactly one user", async (testContext) => {
  const t = convexTest({ schema, modules });
  const now = Date.now();
  const clerkA = newClerkUserId();
  const clerkB = newClerkUserId();
  const seeded = await t.run(async (ctx) => {
    const userA = await ctx.db.insert("users", {
      clerkUserId: clerkA, email: "claim-a@example.test", emailVerificationTime: now,
    });
    const userB = await ctx.db.insert("users", {
      clerkUserId: clerkB, email: "claim-b@example.test", emailVerificationTime: now,
    });
    const profileId = await ctx.db.insert("profiles", {
      profileType: "person", slug: "two-user-claim", displayName: "Two User Claim",
      sortName: "two user claim", aliases: [], tags: [], claimState: "unclaimed",
      publicationState: "published", publicSurfacingState: "public",
      creationSource: "concierge", person: { roleTags: [] }, updatedAt: now,
    });
    const collectorAccountId = await ctx.db.insert("collectorAccounts", {
      vrchatUserId: "usr_fixture-collector", accountAlias: "two-user-fixture", state: "ready",
      capacity: 100, reservedHeadroom: 15, assignedGroupCount: 0, requestsPerMinute: 30,
      secretRef: "secret://isolated-fixture", workerKeyHash: "a".repeat(64),
      credentialGeneration: 1, killSwitchEnabled: false, createdAt: now, updatedAt: now,
    });
    return { userA, userB, profileId, collectorAccountId };
  });
  const asA = t.withIdentity(clerkTestIdentity(clerkA));
  const asB = t.withIdentity(clerkTestIdentity(clerkB));
  const target = {
    profileSlug: "two-user-claim", targetType: "vrchat_user" as const,
    targetExternalId: "usr_01234567-89ab-cdef-0123-456789abcdef",
  };
  const journeyArgs = { profileSlug: target.profileSlug };
  const cancelArgs = { ...journeyArgs, pendingType: "proof" as const };
  const a = await asA.mutation(api.profileClaims.startVrchatProof, target);
  const beforeB = await asB.query(api.profileClaims.getClaimJourneyContext, journeyArgs);
  assert.equal(beforeB?.viewerContextKey, seeded.userB);
  assert.equal(beforeB?.pendingProof, null);
  assert.equal(beforeB?.lastVerifiedProof, null);
  assert.equal((await t.query(api.profileClaims.getClaimJourneyContext, journeyArgs))?.pendingProof, null);

  const fetchMock = testContext.mock.method(globalThis, "fetch", async () => {
    throw new Error("This isolated test must not call a provider.");
  });
  await assert.rejects(
    asB.action(api.profileClaims.verifyVrchatProofViaAdapter, { attemptId: a.attemptId }),
    /PROOF_NOT_FOUND/,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(await asB.mutation(api.profileClaims.cancelClaimJourneyPending, cancelArgs), { canceled: false });
  assert.equal((await t.run(async (ctx) => await ctx.db.get(a.attemptId)))?.state, "pending");

  const b = await asB.mutation(api.profileClaims.startVrchatProof, target);
  assert.notEqual(a.attemptId, b.attemptId);
  assert.notEqual(a.proofCode, b.proofCode);
  const repeatedA = await asA.mutation(api.profileClaims.startVrchatProof, target);
  assert.equal(repeatedA.attemptId, a.attemptId);
  assert.equal(repeatedA.proofCode, a.proofCode);
  assert.equal((await asA.query(api.profileClaims.getClaimJourneyContext, journeyArgs))?.pendingProof?.proofCode, a.proofCode);
  assert.equal((await asB.query(api.profileClaims.getClaimJourneyContext, journeyArgs))?.pendingProof?.proofCode, b.proofCode);
  await assert.rejects(
    asA.action(api.profileClaims.verifyVrchatProofViaAdapter, { attemptId: b.attemptId }),
    /PROOF_NOT_FOUND/,
  );
  assert.deepEqual(await asB.mutation(api.profileClaims.cancelClaimJourneyPending, cancelArgs), { canceled: true });
  await t.run(async (ctx) => {
    assert.equal((await ctx.db.get(a.attemptId))?.state, "pending");
    assert.equal((await ctx.db.get(b.attemptId))?.resolutionReason, "claimant_canceled");
  });

  const bRetry = await asB.mutation(api.profileClaims.startVrchatProof, target);
  const batch = await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {
    collectorAccountId: seeded.collectorAccountId, workerId: "fixture-worker", limit: 5, now: Date.now(),
  });
  assert.deepEqual(new Set(batch.attempts.map((attempt) => attempt.attemptId)), new Set([a.attemptId, bRetry.attemptId]));
  const verdict = {
    collectorAccountId: seeded.collectorAccountId, workerKeyHash: "a".repeat(64),
    // Explicit synthetic provider attestation, only inside convex-test.
    found: true, now: Date.now(),
  };
  assert.equal((await t.mutation(internal.communityTelemetry.recordProofCheckResult, { ...verdict, attemptId: a.attemptId })).state, "verified");
  assert.equal((await t.mutation(internal.communityTelemetry.recordProofCheckResult, { ...verdict, attemptId: bRetry.attemptId })).state, "already_owned");
  assert.equal((await t.mutation(internal.communityTelemetry.recordProofCheckResult, { ...verdict, attemptId: a.attemptId })).state, "not_pending");
  const savedAttempt = await t.run(ctx => ctx.db.get(a.attemptId));
  assert.ok(savedAttempt?.verifiedAt !== undefined);
  assert.deepEqual(await asA.action(api.profileClaims.verifyVrchatProofViaAdapter, { attemptId: a.attemptId }), {
    state: "verified",
    completedTarget: {
      targetType: target.targetType,
      targetExternalId: target.targetExternalId,
      at: savedAttempt.verifiedAt,
    },
  });
  await assert.rejects(asB.mutation(api.profileClaims.startVrchatProof, target), /PROFILE_ALREADY_OWNED/);

  await t.run(async (ctx) => {
    const owners = await ctx.db.query("profileOwners").collect();
    assert.equal(owners.length, 1);
    assert.equal(owners[0]?.userId, seeded.userA);
    assert.equal(owners[0]?.profileId, seeded.profileId);
    assert.equal(owners[0]?.state, "active");
    assert.equal((await ctx.db.get(a.attemptId))?.state, "verified");
    assert.equal((await ctx.db.get(bRetry.attemptId))?.resolutionReason, "already_owned");
    assert.equal((await ctx.db.get(bRetry.attemptId))?.state, "failed");
    const proofs = await ctx.db.query("externalControlProofs").collect();
    assert.equal(proofs.length, 1);
    assert.equal(proofs[0]?.userId, seeded.userA);
    const links = await ctx.db.query("profileExternalLinks").collect();
    assert.equal(links.length, 1);
    assert.equal(links[0]?.linkedByUserId, seeded.userA);
    assert.equal(links[0]?.verifiedByProofId, proofs[0]?._id);
    const claims = await ctx.db.query("profileClaimRequests").collect();
    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.userId, seeded.userA);
    assert.equal(claims[0]?.state, "approved");
    // Proving an arbitrary target grants ownership, not independent identity corroboration.
    assert.equal((await ctx.db.get(seeded.profileId))?.claimState, "claimed_unverified");
  });
  const finalA = await asA.query(api.profileClaims.getClaimJourneyContext, journeyArgs);
  const finalB = await asB.query(api.profileClaims.getClaimJourneyContext, journeyArgs);
  assert.equal(finalA?.ownership, "viewer");
  assert.ok(finalA?.lastVerifiedProof);
  assert.equal(finalB?.ownership, "other");
  assert.equal(finalB?.pendingProof, null);
  assert.equal(finalB?.lastVerifiedProof, null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

for (const sameContributor of [true, false]) {
  it(`directory reference from ${sameContributor ? "self" : "another contributor"} cannot corroborate a VRChat claim or revive removed operator evidence`, async () => {
    const t = convexTest({schema, modules});
    const {linkProfileToAsset, removeProfileLink} = await import("../../convex/_externalControl");
    const now = Date.now();
    const clerkId = newClerkUserId();
    const groupId = "grp_01234567-89ab-cdef-0123-456789abcdef";
    const seeded = await t.run(async ctx => {
      const claimant = await ctx.db.insert("users", {clerkUserId: clerkId, email: "directory-claim@example.test", emailVerificationTime: now});
      const contributor = sameContributor ? claimant : await ctx.db.insert("users", {clerkUserId: newClerkUserId()});
      const profileId = await ctx.db.insert("profiles", {profileType: "community", slug: "directory-claim", displayName: "Directory Claim", sortName: "directory claim", aliases: [], tags: [], claimState: "unclaimed", publicationState: "published", publicSurfacingState: "public", creationSource: "community", community: {categoryTags: []}, updatedAt: now});
      const removedId = await linkProfileToAsset(ctx, {profileId, assetType: "vrchat_group", assetExternalId: groupId, now});
      await removeProfileLink(ctx, profileId, "vrchat_group", groupId, now + 1);
      const removed = await ctx.db.get(removedId);
      const directoryId = await linkProfileToAsset(ctx, {profileId, assetType: "vrchat_group", assetExternalId: groupId, provenance: "directory_reference", linkedByUserId: contributor, now: now + 2});
      assert.notEqual(directoryId, removedId);
      assert.deepEqual(await ctx.db.get(removedId), removed);
      assert.equal((await ctx.db.get(directoryId))?.provenance, "directory_reference");
      const collectorAccountId = await ctx.db.insert("collectorAccounts", {vrchatUserId: "usr_fixture", accountAlias: "directory-proof", state: "ready", capacity: 100, reservedHeadroom: 15, assignedGroupCount: 0, requestsPerMinute: 30, secretRef: "test", workerKeyHash: "a".repeat(64), credentialGeneration: 1, killSwitchEnabled: false, createdAt: now, updatedAt: now});
      return {profileId, claimant, directoryId, collectorAccountId};
    });
    const asUser = t.withIdentity(clerkTestIdentity(clerkId));
    const attempt = await asUser.mutation(api.profileClaims.startVrchatProof, {profileSlug: "directory-claim", targetType: "vrchat_group", targetExternalId: groupId});
    assert.equal((await t.run(ctx => ctx.db.query("profileOwners").collect())).length, 0);
    await t.mutation(internal.communityTelemetry.claimPendingProofChecks, {collectorAccountId: seeded.collectorAccountId, workerId: "fixture", limit: 5, now: Date.now()});
    const result = await t.mutation(internal.communityTelemetry.recordProofCheckResult, {collectorAccountId: seeded.collectorAccountId, workerKeyHash: "a".repeat(64), attemptId: attempt.attemptId, found: true, now: Date.now()});
    assert.equal(result.state, "verified");
    assert.equal((await t.run(ctx => ctx.db.get(seeded.profileId)))?.claimState, "claimed_unverified");
    const provenLink = await t.run(ctx => ctx.db.get(seeded.directoryId));
    assert.equal(provenLink?.linkedByUserId, seeded.claimant);
    assert.equal(provenLink?.provenance, "control_association");
    assert.ok(provenLink?.verifiedByProofId);
  });
}
