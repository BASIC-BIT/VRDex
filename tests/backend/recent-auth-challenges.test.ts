import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () =>
    import("../../convex/_generated/api"),
  "../../convex/auth.ts": () =>
    import("./fixtures/account-session-auth"),
  "../../convex/recentAuthChallenges.ts": () =>
    import("../../convex/recentAuthChallenges"),
};
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const EXPIRES_AT = Date.parse("2099-01-01T00:00:00.000Z");
const CHALLENGE_ONE = "0123456789abcdef0123456789abcdef";
const CHALLENGE_TWO = "fedcba9876543210fedcba9876543210";
const CHALLENGE_THREE = "00112233445566778899aabbccddeeff";
const PROOF_HASH_ONE = "1".repeat(64);
const PROOF_HASH_TWO = "2".repeat(64);

function identity(userId: string, sessionId: string) {
  return {
    issuer: "test",
    subject: `${userId}|${sessionId}`,
    tokenIdentifier: `test|${userId}`,
  };
}

describe("recent authentication challenges", () => {
  it("serializes simultaneous completions onto one current session", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "concurrent-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "session_revocation",
      challengeId: CHALLENGE_ONE,
    });
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "session_revocation",
      challengeId: CHALLENGE_TWO,
    });
    await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
        userId: seeded.userId,
      },
    );
    await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_TWO,
        userId: seeded.userId,
      },
    );
    const firstClaim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
      },
    );
    const secondClaim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_TWO,
      },
    );
    assert.equal(firstClaim.state, "claimed");
    assert.equal(secondClaim.state, "claimed");
    assert.equal(firstClaim.sessionId, secondClaim.sessionId);
    const replacementSessionId = firstClaim.sessionId;

    const results = await Promise.all([
      t
        .withIdentity(identity(seeded.userId, replacementSessionId))
        .mutation(api.recentAuthChallenges.complete, {
          bindingConfirmed: true,
          challengeId: CHALLENGE_ONE,
        }),
      t
        .withIdentity(identity(seeded.userId, replacementSessionId))
        .mutation(api.recentAuthChallenges.complete, {
          bindingConfirmed: true,
          challengeId: CHALLENGE_TWO,
        }),
    ]);
    const remaining = await t.run(async (ctx) => ({
      challenges: await ctx.db.query("recentAuthChallenges").collect(),
      original: await ctx.db.get(seeded.originalSessionId),
    }));

    assert.deepEqual(
      results.map((result) => result.state),
      ["completed", "completed"],
    );
    assert.equal(remaining.original, null);
    assert.equal(remaining.challenges.length, 2);
    assert.equal(
      remaining.challenges.every(
        (challenge) => challenge.completedAt !== undefined,
      ),
      true,
    );
  });

  it("preserves a shared replacement completed by a sibling challenge", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "sibling-completion-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    for (const [challengeId, proofHash] of [
      [CHALLENGE_ONE, PROOF_HASH_ONE],
      [CHALLENGE_TWO, PROOF_HASH_TWO],
    ] as const) {
      await original.mutation(api.recentAuthChallenges.begin, {
        actionClass: "session_revocation",
        challengeId,
      });
      await original.mutation(
        internal.recentAuthChallenges.verifyPassword,
        {
          challengeId,
          proofHash,
          userId: seeded.userId,
        },
      );
    }
    const firstClaim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
      },
    );
    const secondClaim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_TWO,
      },
    );
    assert.equal(firstClaim.state, "claimed");
    assert.equal(secondClaim.state, "claimed");
    assert.equal(firstClaim.sessionId, secondClaim.sessionId);
    const replacement = t.withIdentity(
      identity(seeded.userId, firstClaim.sessionId),
    );

    assert.equal(
      (
        await replacement.mutation(
          api.recentAuthChallenges.complete,
          {
            bindingConfirmed: true,
            challengeId: CHALLENGE_TWO,
          },
        )
      ).state,
      "completed",
    );
    assert.deepEqual(
      await replacement.mutation(
        api.recentAuthChallenges.complete,
        {
          bindingConfirmed: false,
          challengeId: CHALLENGE_ONE,
        },
      ),
      { clearAuth: false, state: "missing" },
    );
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(firstClaim.sessionId)),
      null,
    );
    assert.deepEqual(
      await replacement.mutation(api.recentAuthChallenges.fail, {
        challengeId: CHALLENGE_ONE,
      }),
      { clearAuth: false, state: "preserved" },
    );
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(firstClaim.sessionId)),
      null,
    );
  });

  it("preserves an already-completed challenge and its active session", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "completed-failure-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_ONE,
    });
    await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
        userId: seeded.userId,
      },
    );
    const claim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
      },
    );
    assert.equal(claim.state, "claimed");
    const replacement = t.withIdentity(
      identity(seeded.userId, claim.sessionId),
    );
    assert.equal(
      (
        await replacement.mutation(
          api.recentAuthChallenges.complete,
          {
            bindingConfirmed: true,
            challengeId: CHALLENGE_ONE,
          },
        )
      ).state,
      "completed",
    );

    assert.deepEqual(
      await replacement.mutation(api.recentAuthChallenges.fail, {
        challengeId: CHALLENGE_ONE,
      }),
      { clearAuth: false, state: "preserved" },
    );
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(claim.sessionId)),
      null,
    );
    assert.deepEqual(
      await replacement.mutation(
        api.recentAuthChallenges.complete,
        {
          bindingConfirmed: true,
          challengeId: CHALLENGE_ONE,
        },
      ),
      { clearAuth: false, state: "already_completed" },
    );
  });

  it("rotates the session and makes completion retry idempotent", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "rotated-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_ONE,
    });
    await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
        userId: seeded.userId,
      },
    );
    const claim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_ONE,
        proofHash: PROOF_HASH_ONE,
      },
    );
    assert.equal(claim.state, "claimed");
    const replacementSessionId = claim.sessionId;

    const result = await t
      .withIdentity(
        identity(seeded.userId, replacementSessionId),
      )
      .mutation(api.recentAuthChallenges.complete, {
        bindingConfirmed: true,
        challengeId: CHALLENGE_ONE,
      });

    assert.deepEqual(result, {
      actionClass: "developer_token",
      clearAuth: false,
      state: "completed",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(replacementSessionId)),
      null,
    );
    assert.equal(
      await t.run((ctx) => ctx.db.get(seeded.originalSessionId)),
      null,
    );
    const duplicate = await t
      .withIdentity(identity(seeded.userId, replacementSessionId))
      .mutation(api.recentAuthChallenges.complete, {
        bindingConfirmed: false,
        challengeId: CHALLENGE_ONE,
      });
    assert.deepEqual(duplicate, {
      clearAuth: false,
      state: "already_completed",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(replacementSessionId)),
      null,
    );
  });

  it("requires server-side proof provenance and accepts one-time password proof", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "password-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_ONE,
    });

    const unproven = await original.mutation(
      api.recentAuthChallenges.complete,
      {
        bindingConfirmed: true,
        challengeId: CHALLENGE_ONE,
      },
    );
    assert.deepEqual(unproven, {
      clearAuth: false,
      state: "missing",
    });

    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_THREE,
    });
    const unprovenReplacementSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId: seeded.userId,
      }),
    );
    const directProviderBypass = await t
      .withIdentity(
        identity(seeded.userId, unprovenReplacementSessionId),
      )
      .mutation(api.recentAuthChallenges.complete, {
        bindingConfirmed: true,
        challengeId: CHALLENGE_THREE,
      });
    assert.deepEqual(directProviderBypass, {
      clearAuth: false,
      state: "missing",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(unprovenReplacementSessionId)),
      null,
    );

    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_TWO,
    });
    const nonOwningSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId: seeded.userId,
      }),
    );
    const nonOwningVerification = await t
      .withIdentity(identity(seeded.userId, nonOwningSessionId))
      .mutation(
        internal.recentAuthChallenges.verifyPassword,
        {
          challengeId: CHALLENGE_TWO,
          proofHash: PROOF_HASH_TWO,
          userId: seeded.userId,
        },
      );
    assert.equal(nonOwningVerification.state, "invalid");
    const proof = await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_TWO,
        userId: seeded.userId,
      },
    );
    assert.equal(proof.state, "verified");
    assert.equal(
      (
        await original.mutation(
          internal.recentAuthChallenges.claimPasswordProof,
          {
            challengeId: CHALLENGE_TWO,
            proofHash: "3".repeat(64),
          },
        )
      ).state,
      "invalid",
    );
    assert.equal(
      (
        await original.mutation(
          internal.recentAuthChallenges.claimPasswordProof,
          {
            challengeId: CHALLENGE_TWO,
            proofHash: PROOF_HASH_TWO,
          },
        )
      ).state,
      "claimed",
    );
    assert.equal(
      (
        await original.mutation(
          internal.recentAuthChallenges.claimPasswordProof,
          {
            challengeId: CHALLENGE_TWO,
            proofHash: PROOF_HASH_TWO,
          },
        )
      ).state,
      "invalid",
    );
    const replacementSessionId = (
      await t.run(async (ctx) => {
        const challenge = await ctx.db
          .query("recentAuthChallenges")
          .withIndex("by_challengeId", (query) =>
            query.eq("challengeId", CHALLENGE_TWO),
          )
          .unique();
        return challenge?.authenticatedSessionId;
      })
    );
    assert.notEqual(replacementSessionId, undefined);
    const completed = await t
      .withIdentity(identity(seeded.userId, replacementSessionId!))
      .mutation(
      api.recentAuthChallenges.complete,
      {
        bindingConfirmed: true,
        challengeId: CHALLENGE_TWO,
      },
      );
    assert.deepEqual(completed, {
      actionClass: "developer_token",
      clearAuth: false,
      state: "completed",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(replacementSessionId!)),
      null,
    );
    assert.equal(
      await t.run((ctx) => ctx.db.get(seeded.originalSessionId)),
      null,
    );
  });

  it("preserves sessions that were never bound to the challenge", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "original-reauth@example.com",
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "mismatched-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return { originalSessionId, otherUserId, userId };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_ONE,
    });
    const mismatchedSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId: seeded.otherUserId,
      }),
    );
    const mismatch = await t
      .withIdentity(
        identity(seeded.otherUserId, mismatchedSessionId),
      )
      .mutation(api.recentAuthChallenges.complete, {
        bindingConfirmed: true,
        challengeId: CHALLENGE_ONE,
      });

    assert.deepEqual(mismatch, {
      clearAuth: false,
      state: "mismatch",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(mismatchedSessionId)),
      null,
    );
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(seeded.originalSessionId)),
      null,
    );

    const replacementSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId: seeded.userId,
      }),
    );
    const missingBinding = await t
      .withIdentity(
        identity(seeded.userId, replacementSessionId),
      )
      .mutation(api.recentAuthChallenges.complete, {
        bindingConfirmed: false,
        challengeId: CHALLENGE_ONE,
      });

    assert.deepEqual(missingBinding, {
      clearAuth: false,
      state: "missing",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(replacementSessionId)),
      null,
    );
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(seeded.originalSessionId)),
      null,
    );
    await original.mutation(api.recentAuthChallenges.cancel, {
      challengeId: CHALLENGE_ONE,
    });
  });

  it("fails only the exact challenge-bound replacement session", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "failure-reauth@example.com",
      });
      const otherUserId = await ctx.db.insert("users", {
        email: "failure-other@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      const unrelatedSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId: otherUserId,
      });
      const sameUserUnboundSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      return {
        originalSessionId,
        otherUserId,
        sameUserUnboundSessionId,
        unrelatedSessionId,
        userId,
      };
    });
    const original = t.withIdentity(
      identity(seeded.userId, seeded.originalSessionId),
    );
    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_ONE,
    });

    const unrelatedFailure = await t
      .withIdentity(
        identity(seeded.otherUserId, seeded.unrelatedSessionId),
      )
      .mutation(api.recentAuthChallenges.fail, {
        challengeId: CHALLENGE_ONE,
      });
    assert.deepEqual(unrelatedFailure, {
      clearAuth: false,
      state: "unrelated",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(seeded.unrelatedSessionId)),
      null,
    );

    const unboundFailure = await t
      .withIdentity(
        identity(seeded.userId, seeded.sameUserUnboundSessionId),
      )
      .mutation(api.recentAuthChallenges.fail, {
        challengeId: CHALLENGE_ONE,
      });
    assert.deepEqual(unboundFailure, {
      clearAuth: false,
      state: "preserved",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(seeded.sameUserUnboundSessionId)),
      null,
    );

    const cancelled = await original.mutation(
      api.recentAuthChallenges.fail,
      {
        challengeId: CHALLENGE_ONE,
      },
    );
    assert.deepEqual(cancelled, {
      clearAuth: false,
      state: "cancelled",
    });
    assert.notEqual(
      await t.run((ctx) => ctx.db.get(seeded.originalSessionId)),
      null,
    );

    await original.mutation(api.recentAuthChallenges.begin, {
      actionClass: "developer_token",
      challengeId: CHALLENGE_TWO,
    });
    await original.mutation(
      internal.recentAuthChallenges.verifyPassword,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_ONE,
        userId: seeded.userId,
      },
    );
    const claim = await original.mutation(
      internal.recentAuthChallenges.claimPasswordProof,
      {
        challengeId: CHALLENGE_TWO,
        proofHash: PROOF_HASH_ONE,
      },
    );
    assert.equal(claim.state, "claimed");

    const replacementFailure = await t
      .withIdentity(identity(seeded.userId, claim.sessionId))
      .mutation(api.recentAuthChallenges.fail, {
        challengeId: CHALLENGE_TWO,
      });
    assert.deepEqual(replacementFailure, {
      clearAuth: true,
      state: "revoked",
    });
    assert.equal(
      await t.run((ctx) => ctx.db.get(claim.sessionId)),
      null,
    );
  });

  it("deletes an expired abandoned challenge idempotently", async () => {
    const t = convexTest({ schema, modules });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "expired-reauth@example.com",
      });
      const originalSessionId = await ctx.db.insert("authSessions", {
        expirationTime: EXPIRES_AT,
        userId,
      });
      await ctx.db.insert("recentAuthChallenges", {
        actionClass: "developer_token",
        challengeId: CHALLENGE_ONE,
        expiresAt: 0,
        originalSessionId,
        userId,
      });
    });

    assert.equal(
      await t.mutation(
        internal.recentAuthChallenges.expireAbandoned,
        {},
      ),
      1,
    );
    assert.equal(
      await t.mutation(
        internal.recentAuthChallenges.expireAbandoned,
        {},
      ),
      0,
    );

    assert.equal(
      await t.run(async (ctx) =>
        ctx.db.query("recentAuthChallenges").first()
      ),
      null,
    );
  });
});
