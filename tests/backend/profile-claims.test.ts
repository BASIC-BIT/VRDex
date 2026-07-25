import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

describe("profile claim lifecycle", () => {
  it("lets an owner fetch a private claim target without making it public", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "private-claim-target@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "private-claim-target",
        displayName: "Private Claim Target",
        sortName: "private claim target",
        aliases: [],
        tags: [],
        claimState: "claimed_unverified",
        publicationState: "draft_private",
        publicSurfacingState: "opted_out",
        creationSource: "concierge",
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

      return {
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    const signedOutResult = await t.query(api.profileClaims.getClaimTargetBySlug, {
      profileSlug: "private-claim-target",
    });
    assert.equal(signedOutResult, null);

    const ownerResult = await t.withIdentity(seeded.identity).query(api.profileClaims.getClaimTargetBySlug, {
      profileSlug: "private-claim-target",
    });
    assert.equal(ownerResult?.displayName, "Private Claim Target");
    assert.equal(ownerResult?.slug, "private-claim-target");
  });

  it("expires stale pending proof attempts without deleting history", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const attemptId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "claim-lifecycle@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "claim-lifecycle",
        displayName: "Claim Lifecycle",
        sortName: "claim lifecycle",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        person: { roleTags: [] },
        updatedAt: now,
      });

      return await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_user_proof",
        targetType: "vrchat_user",
        targetExternalId: "usr_3f510886-35c4-4e2b-bdb0-2a43cc36023f",
        proofCode: "VRDEX-EXPIRED",
        state: "pending",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        expiresAt: now - 1,
      });
    });

    const result = await t.mutation(internal.profileClaims.expireStaleVerificationAttempts, {});
    assert.equal(result.expired, 1);

    const attempt = await t.run(async (ctx) => await ctx.db.get(attemptId));
    assert.equal(attempt?.state, "expired");
    assert.equal(attempt?.proofCode, "VRDEX-EXPIRED");
  });

  it("does not grant ownership from an expired proof attempt", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const { attemptId, profileId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "expired-proof@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "expired-proof",
        displayName: "Expired Proof",
        sortName: "expired proof",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        person: { roleTags: [] },
        updatedAt: now,
      });
      const attemptId = await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_user_proof",
        targetType: "vrchat_user",
        targetExternalId: "usr_1cf38bf8-f62a-41be-a4a1-2363f3465d51",
        proofCode: "VRDEX-TOO-LATE",
        state: "pending",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        expiresAt: now - 1,
      });

      return { attemptId, profileId };
    });

    const result = await t.mutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Synthetic expired proof.",
    });
    assert.deepEqual(result, { state: "expired" });

    const state = await t.run(async (ctx) => ({
      attempt: await ctx.db.get(attemptId),
      owners: await ctx.db
        .query("profileOwners")
        .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId))
        .collect(),
    }));
    assert.equal(state.attempt?.state, "expired");
    assert.equal(state.owners.length, 0);
  });

  it("records a proof adapter miss after the deadline as expired", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const attemptId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "expired-adapter-miss@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "expired-adapter-miss",
        displayName: "Expired Adapter Miss",
        sortName: "expired adapter miss",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        person: { roleTags: [] },
        updatedAt: now,
      });

      return await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_user_proof",
        targetType: "vrchat_user",
        targetExternalId: "usr_1cf38bf8-f62a-41be-a4a1-2363f3465d51",
        proofCode: "VRDEX-ADAPTER-MISS",
        state: "pending",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        expiresAt: now - 1,
      });
    });

    const result = await t.mutation(internal.profileClaims.recordVrchatProofFailure, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Synthetic adapter miss after expiry.",
    });

    assert.deepEqual(result, { state: "expired" });
    const attempt = await t.run(async (ctx) => await ctx.db.get(attemptId));
    assert.equal(attempt?.state, "expired");
  });

  it("rejects replay after a proof has granted ownership", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const { attemptId, profileId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "proof-replay@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "proof-replay",
        displayName: "Proof Replay",
        sortName: "proof replay",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        person: { roleTags: [] },
        updatedAt: now,
      });
      const attemptId = await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_user_proof",
        targetType: "vrchat_user",
        targetExternalId: "usr_5e7adcef-c7f4-4df1-b4e6-e86fb529ac08",
        proofCode: "VRDEX-ONE-TIME",
        state: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });

      return { attemptId, profileId };
    });

    await t.mutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Synthetic verified proof.",
    });
    await assert.rejects(
      t.mutation(internal.profileClaims.recordVrchatProofVerification, {
        attemptId,
        evidenceSource: "vrchat_api",
        evidenceSummary: "Synthetic replay.",
      }),
      /Only pending verification attempts can be approved/,
    );

    const owners = await t.run(async (ctx) =>
      ctx.db
        .query("profileOwners")
        .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId))
        .collect(),
    );
    assert.equal(owners.length, 1);
    assert.equal(owners[0]?.state, "active");
  });

  it("cancels only the pending record shown in the journey", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "scoped-cancel@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "community",
        slug: "scoped-cancel",
        displayName: "Scoped Cancel",
        sortName: "scoped cancel",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        community: { categoryTags: [] },
        updatedAt: now,
      });
      const claimRequestId = await ctx.db.insert("profileClaimRequests", {
        profileId,
        profileSlug: "scoped-cancel",
        profileType: "community",
        requestedDisplayName: "Scoped Cancel",
        userId,
        method: "discord_community_admin",
        state: "pending",
        discordGuildId: "123456789012345678",
        createdAt: now,
        updatedAt: now,
      });
      const attemptId = await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_group_proof",
        targetType: "vrchat_group",
        targetExternalId: "grp_e2e00000-0000-4000-8000-000000000002",
        proofCode: "VRDEX-SCOPED",
        state: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });

      return {
        attemptId,
        claimRequestId,
        identity: {
          subject: `${userId}|web-session`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    await t.withIdentity(seeded.identity).mutation(api.profileClaims.cancelClaimJourneyPending, {
      profileSlug: "scoped-cancel",
      pendingType: "proof",
    });
    const afterProofCancel = await t.run(async (ctx) => ({
      attempt: await ctx.db.get(seeded.attemptId),
      claimRequest: await ctx.db.get(seeded.claimRequestId),
    }));
    assert.equal(afterProofCancel.attempt?.state, "failed");
    assert.equal(afterProofCancel.claimRequest?.state, "pending");

    await t.withIdentity(seeded.identity).mutation(api.profileClaims.cancelClaimJourneyPending, {
      profileSlug: "scoped-cancel",
      pendingType: "claim_request",
    });
    const claimRequest = await t.run(async (ctx) => await ctx.db.get(seeded.claimRequestId));
    assert.equal(claimRequest?.state, "rejected");
  });
});
