import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
  "../../convex/vrclinkingCredentials.ts": () => import("../../convex/vrclinkingCredentials"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

describe("profile claim lifecycle", () => {
  it("lets only an owner fetch private claim context without making the profile public", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "private-claim-target@example.test",
        emailVerificationTime: now,
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "private-claim-target-other@example.test",
        emailVerificationTime: now,
      });
      const ownerSessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: now + 60_000,
      });
      const otherSessionId = await ctx.db.insert("authSessions", {
        userId: otherUserId,
        expirationTime: now + 60_000,
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
        profileId,
        ownerIdentity: {
          subject: `${userId}|${ownerSessionId}`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
        otherIdentity: {
          subject: `${otherUserId}|${otherSessionId}`,
          issuer: "test",
          tokenIdentifier: `test|${otherUserId}`,
        },
      };
    });

    const signedOutResult = await t.query(api.profileClaims.getClaimTargetBySlug, {
      profileSlug: "private-claim-target",
    });
    assert.equal(signedOutResult, null);
    const signedOutJourney = await t.query(api.profileClaims.getClaimJourneyContext, {
      profileSlug: "private-claim-target",
    });
    assert.equal(signedOutJourney, null);

    const otherJourney = await t.withIdentity(seeded.otherIdentity).query(api.profileClaims.getClaimJourneyContext, {
      profileSlug: "private-claim-target",
    });
    assert.equal(otherJourney, null);

    const ownerResult = await t.withIdentity(seeded.ownerIdentity).query(api.profileClaims.getClaimTargetBySlug, {
      profileSlug: "private-claim-target",
    });
    assert.equal(ownerResult?.displayName, "Private Claim Target");
    assert.equal(ownerResult?.hasPublicProfile, false);
    assert.equal(ownerResult?.profileId, seeded.profileId);
    assert.equal(ownerResult?.slug, "private-claim-target");

    const ownerJourney = await t.withIdentity(seeded.ownerIdentity).query(api.profileClaims.getClaimJourneyContext, {
      profileSlug: "private-claim-target",
    });
    assert.equal(ownerJourney?.ownership, "viewer");
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

  it("preserves VRC Linking evidence when adapter verification finishes after expiry", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "expired-vrclinking@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "expired-vrclinking",
        displayName: "Expired VRC Linking",
        sortName: "expired vrc linking",
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
        method: "vrclinking_attestation",
        targetType: "vrclinking",
        targetExternalId: "usr_1cf38bf8-f62a-41be-a4a1-2363f3465d51",
        proofCode: "VRDEX-VRCLINKING-EXPIRED",
        state: "pending",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        expiresAt: now - 1,
      });
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: now + 60_000,
      });

      return {
        attemptId,
        identity: {
          subject: `${userId}|${sessionId}`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    const originalFetch = globalThis.fetch;
    const originalAdapterUrl = process.env.VRCLINKING_PROOF_ADAPTER_URL;
    process.env.VRCLINKING_PROOF_ADAPTER_URL = "https://adapter.example.test/verify";
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;

    try {
      const result = await t.withIdentity(seeded.identity).action(api.profileClaims.verifyVrchatProofViaAdapter, {
        attemptId: seeded.attemptId,
      });
      assert.deepEqual(result, { state: "expired" });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalAdapterUrl === undefined) {
        delete process.env.VRCLINKING_PROOF_ADAPTER_URL;
      } else {
        process.env.VRCLINKING_PROOF_ADAPTER_URL = originalAdapterUrl;
      }
    }

    const attempt = await t.run(async (ctx) => await ctx.db.get(seeded.attemptId));
    assert.equal(attempt?.state, "expired");
    assert.equal(attempt?.evidenceSource, "vrclinking");
  });

  // Attempts stay pending for a day, so the claimability check at the start
  // cannot speak for a moderation decision taken after it.
  it("refuses a proof for a listing suppressed while it was pending", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const { attemptId, profileId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "proof-suppressed@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "proof-suppressed",
        displayName: "Proof Suppressed",
        sortName: "proof suppressed",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        // Suppressed after the attempt was created, which is the whole point.
        publicSurfacingState: "suppressed",
        creationSource: "self",
        person: { roleTags: [] },
        updatedAt: now,
      });
      const attemptId = await ctx.db.insert("profileVerificationAttempts", {
        profileId,
        userId,
        method: "vrchat_user_proof",
        targetType: "vrchat_user",
        targetExternalId: "usr_5e7adcef-c7f4-4df1-b4e6-e86fb529ac09",
        proofCode: "VRDEX-ONE-TIME",
        state: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });

      return { attemptId, profileId };
    });

    const result = await t.mutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Proof code was found after the listing was suppressed.",
    });

    // Settled, not thrown: the collector treats anything but an ownership
    // conflict as retryable, so throwing would have it retry until expiry. The
    // reason travels with it so the claim page does not report a listing that
    // moved underneath the attempt as a failed attestation.
    assert.deepEqual(result, { state: "failed", reason: "not_claimable" });

    const { attempt, owners } = await t.run(async (ctx) => ({
      attempt: await ctx.db.get(attemptId),
      owners: await ctx.db
        .query("profileOwners")
        .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId))
        .collect(),
    }));

    assert.equal(attempt?.state, "failed");
    assert.equal(owners.length, 0);
  });

  it("reports the settled outcome instead of failing a replayed proof", async () => {
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

    const first = await t.mutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Synthetic verified proof.",
    });
    // The collector fleet polls the same attempt an adapter action is checking,
    // so it can settle it mid-flight. Throwing here reported an error for a
    // click whose ownership grant had already succeeded, so the replay has to
    // hand back what the first pass produced — without granting again.
    const replay = await t.mutation(internal.profileClaims.recordVrchatProofVerification, {
      attemptId,
      evidenceSource: "vrchat_api",
      evidenceSummary: "Synthetic replay.",
    });

    assert.deepEqual(
      { claimState: replay.claimState, connectionOnly: replay.connectionOnly },
      { claimState: first.claimState, connectionOnly: first.connectionOnly },
    );
    assert.equal(replay.claimRequestId, undefined);

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
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: now + 60_000,
      });

      return {
        attemptId,
        claimRequestId,
        identity: {
          subject: `${userId}|${sessionId}`,
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

  // Both surfaces excluded VRCLinking attempts while nothing in the browser
  // could create one. The claim form now does, and the pending panel it renders
  // replaces the method picker — so a claimant whose attempt found no match
  // could neither cancel it nor pick another method until it expired.
  it("shows and cancels a pending VRCLinking attempt", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "vrclinking-cancel@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "vrclinking-cancel",
        displayName: "VRCLinking Cancel",
        sortName: "vrclinking cancel",
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
        targetType: "vrclinking",
        targetExternalId: "usr_e2e00000-0000-4000-8000-000000000003",
        proofCode: "VRDEX-VRCLINKING",
        state: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 60_000,
      });
      const sessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: now + 60_000,
      });

      return {
        attemptId,
        identity: {
          subject: `${userId}|${sessionId}`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    const journey = await t
      .withIdentity(seeded.identity)
      .query(api.profileClaims.getClaimJourneyContext, { profileSlug: "vrclinking-cancel" });
    assert.equal(journey?.pendingProof?.targetType, "vrclinking");

    const canceled = await t
      .withIdentity(seeded.identity)
      .mutation(api.profileClaims.cancelClaimJourneyPending, {
        profileSlug: "vrclinking-cancel",
        pendingType: "proof",
      });
    assert.equal(canceled.canceled, true);
    assert.equal((await t.run(async (ctx) => await ctx.db.get(seeded.attemptId)))?.state, "failed");

    // Cancelling frees the open-attempt slot at once, and a new attempt carries
    // no adapter cooldown of its own, so submit → consult → "Start over" would
    // otherwise loop as fast as the claimant can click and spend a delegated
    // community's provider quota without ever reaching MAX_OPEN_PROOF_ATTEMPTS.
    await assert.rejects(
      () =>
        t.withIdentity(seeded.identity).mutation(api.profileClaims.startVrchatProof, {
          profileSlug: "vrclinking-cancel",
          targetType: "vrclinking",
          targetExternalId: "usr_e2e00000-0000-4000-8000-000000000003",
        }),
      /ADAPTER_COOLDOWN/,
    );
  });

  // The bot-token path proves the same thing the OAuth round-trip does, so it
  // has to leave the same durable record. Without it the guild is verified but
  // absent from the connection model, and nothing can delegate for it.
  it("records a control proof and profile link when the bot token approves", async () => {
    const t = convexTest({ schema, modules });
    const now = Date.now();
    const guildId = "123456789012345678";
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "bot-approval@example.test",
        emailVerificationTime: now,
      });
      const profileId = await ctx.db.insert("profiles", {
        profileType: "community",
        slug: "bot-approval",
        displayName: "Bot Approval",
        sortName: "bot approval",
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
        profileSlug: "bot-approval",
        profileType: "community",
        requestedDisplayName: "Bot Approval",
        userId,
        method: "discord_community_admin",
        state: "pending",
        discordGuildId: guildId,
        // Caller-supplied label from the request step. It must never become the
        // durable name — an admin of a real server could otherwise present it
        // under any name they liked.
        discordGuildName: "Totally Not A Scam Server",
        createdAt: now,
        updatedAt: now,
      });

      return { userId, profileId, claimRequestId };
    });

    await t.mutation(internal.profileClaims.recordDiscordCommunityAdminApproval, {
      claimRequestId: seeded.claimRequestId,
      evidenceSummary: "Administrator permission confirmed by the Discord bot.",
      discordUserId: "discord-subject-bot",
      guildName: "Bot Approval HQ",
    });

    await t.run(async (ctx) => {
      const proofs = await ctx.db
        .query("externalControlProofs")
        .withIndex("by_userId_state", (q) => q.eq("userId", seeded.userId).eq("state", "active"))
        .collect();
      assert.equal(proofs.length, 1);
      assert.equal(proofs[0]?.assetExternalId, guildId);
      assert.equal(proofs[0]?.evidenceSource, "discord_bot");
      assert.equal(proofs[0]?.controlLevel, "administrator");
      // Bound to the identity the bot actually checked, so a later OAuth
      // round-trip by a different Discord account cannot revoke it.
      assert.equal(proofs[0]?.evidenceSubjectId, "discord-subject-bot");
      assert.equal(proofs[0]?.assetDisplayName, "Bot Approval HQ");

      const links = await ctx.db
        .query("profileExternalLinks")
        .withIndex("by_profileId_state", (q) =>
          q.eq("profileId", seeded.profileId).eq("state", "active"),
        )
        .collect();
      assert.equal(links.length, 1);
      assert.equal(links[0]?.assetExternalId, guildId);
      assert.equal(links[0]?.assetDisplayName, "Bot Approval HQ");
      assert.equal(links[0]?.verifiedByProofId, proofs[0]?._id);
    });
  });
});
