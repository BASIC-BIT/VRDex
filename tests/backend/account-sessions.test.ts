import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { convexTest } from "convex-test";

import {
  AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE,
  deleteAuthRefreshTokenBatch,
} from "../../convex/_accountSessionRefreshCleanup";
import { ACCOUNT_SESSION_REVOCATION_BATCH_SIZE } from "../../convex/accountSessions";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () =>
    import("../../convex/_generated/api"),
  "../../convex/accountSessions.ts": () =>
    import("../../convex/accountSessions"),
  "../../convex/accountSessionCleanup.ts": () =>
    import("../../convex/accountSessionCleanup"),
  "../../convex/accounts.ts": () =>
    import("../../convex/accounts"),
  "../../convex/authSessionAuthority.ts": () =>
    import("../../convex/authSessionAuthority"),
};
const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const EXPIRES_AT = Date.parse("2099-01-01T00:00:00.000Z");

async function seedSessions(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "session-owner@example.com",
      emailVerificationTime: Date.now(),
    });
    const otherUserId = await ctx.db.insert("users", {
      email: "other-session-owner@example.com",
      emailVerificationTime: Date.now(),
    });
    const currentSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: EXPIRES_AT,
    });
    const remoteSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: EXPIRES_AT,
    });
    const inactiveSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: EXPIRES_AT,
    });
    const usedRefreshSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: EXPIRES_AT,
    });
    const otherUserSessionId = await ctx.db.insert("authSessions", {
      userId: otherUserId,
      expirationTime: EXPIRES_AT,
    });
    await ctx.db.insert("recentAuthChallenges", {
      actionClass: "session_revocation",
      challengeId: "0123456789abcdef0123456789abcdef",
      completedAt: Date.now(),
      completedSessionId: currentSessionId,
      expiresAt: Date.now() + 15 * 60 * 1_000,
      originalSessionId: currentSessionId,
      proofMethod: "password",
      userId,
    });
    const remoteRootTokenId = await ctx.db.insert("authRefreshTokens", {
      sessionId: remoteSessionId,
      expirationTime: EXPIRES_AT,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId: remoteSessionId,
      expirationTime: EXPIRES_AT,
      parentRefreshTokenId: remoteRootTokenId,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId: currentSessionId,
      expirationTime: EXPIRES_AT,
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId: inactiveSessionId,
      expirationTime: Date.parse("2020-01-01T00:00:00.000Z"),
    });
    await ctx.db.insert("authRefreshTokens", {
      sessionId: usedRefreshSessionId,
      expirationTime: EXPIRES_AT,
      firstUsedTime: Date.parse("2020-01-01T00:00:00.000Z"),
    });

    return {
      currentSessionId,
      identity: {
        subject: `${userId}|${currentSessionId}`,
        issuer: "test",
        tokenIdentifier: `test|${userId}`,
      },
      otherUserSessionId,
      remoteSessionId,
      inactiveSessionId,
      usedRefreshSessionId,
      userId,
    };
  });
}

async function sessionExists(
  t: ReturnType<typeof convexTest>,
  sessionId: Id<"authSessions">,
) {
  return await t.run(async (ctx) => (await ctx.db.get(sessionId)) !== null);
}

async function refreshTokenCount(
  t: ReturnType<typeof convexTest>,
  sessionId: Id<"authSessions">,
) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (query) => query.eq("sessionId", sessionId))
        .collect()
    ).length
  );
}

async function ownedSessionCount(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) =>
    (
      await ctx.db
        .query("authSessions")
        .withIndex("userId", (query) => query.eq("userId", userId))
        .collect()
    ).length
  );
}

async function finishScheduledWork(
  t: ReturnType<typeof convexTest>,
) {
  for (let iteration = 0; iteration < 20; iteration += 1) {
    mock.timers.runAll();
    await t.finishInProgressScheduledFunctions();
  }
}

describe("account sessions", () => {
  it("keeps owned JWT-authorized sessions visible when refresh is unavailable", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);

    const result = await t
      .withIdentity(seeded.identity)
      .query(api.accountSessions.listMine, {});

    assert.equal(result.state, "active");
    assert.deepEqual(
      result.sessions.map((session) => session.id),
      [
        seeded.currentSessionId,
        seeded.usedRefreshSessionId,
        seeded.inactiveSessionId,
        seeded.remoteSessionId,
      ],
    );
    assert.equal(result.sessions[0]?.current, true);
    assert.deepEqual(
      result.sessions
        .filter((session) => session.status === "expiring")
        .map((session) => session.id)
        .sort(),
      [seeded.inactiveSessionId, seeded.usedRefreshSessionId].sort(),
    );
    assert.ok(
      result.sessions.every(
        (session) =>
          session.lastActiveAt >= session.createdAt &&
          session.expiresAt === EXPIRES_AT,
      ),
    );
  });

  it("finds an unexpired unused refresh token behind newer used branches", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "branched-session-owner@example.com",
        emailVerificationTime: Date.now(),
      });
      const currentSessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: EXPIRES_AT,
      });
      const branchedSessionId = await ctx.db.insert("authSessions", {
        userId,
        expirationTime: EXPIRES_AT,
      });
      await ctx.db.insert("authRefreshTokens", {
        sessionId: currentSessionId,
        expirationTime: EXPIRES_AT,
      });
      await ctx.db.insert("authRefreshTokens", {
        sessionId: branchedSessionId,
        expirationTime: EXPIRES_AT,
      });
      for (let index = 0; index < 32; index += 1) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId: branchedSessionId,
          expirationTime: EXPIRES_AT,
          firstUsedTime: Date.parse("2020-01-01T00:00:00.000Z"),
        });
      }
      return {
        branchedSessionId,
        identity: {
          subject: `${userId}|${currentSessionId}`,
          issuer: "test",
          tokenIdentifier: `test|${userId}`,
        },
      };
    });

    const result = await t
      .withIdentity(seeded.identity)
      .query(api.accountSessions.listMine, {});
    const branched = result.sessions.find(
      (session) => session.id === seeded.branchedSessionId,
    );

    assert.equal(branched?.status, "active");
    assert.ok(
      branched !== undefined &&
        branched.lastActiveAt > branched.createdAt,
    );
  });

  it("allows a still-valid JWT to view and revoke its current session after refresh expires", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const expiringIdentity = {
      ...seeded.identity,
      subject: `${seeded.userId}|${seeded.inactiveSessionId}`,
    };
    const expiringClient = t.withIdentity(expiringIdentity);

    const result = await expiringClient.query(api.accountSessions.listMine, {});
    const current = result.sessions.find((session) => session.current);

    assert.equal(result.state, "active");
    assert.equal(current?.id, seeded.inactiveSessionId);
    assert.equal(current?.status, "expiring");
    assert.deepEqual(
      await expiringClient.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.inactiveSessionId,
      }),
      { current: true, revoked: true },
    );
    assert.equal(await sessionExists(t, seeded.inactiveSessionId), false);
    assert.equal(await refreshTokenCount(t, seeded.inactiveSessionId), 0);
  });

  it("revokes one owned session and its refresh tree idempotently", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);

    assert.deepEqual(
      await owner.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.remoteSessionId,
      }),
      { current: false, revoked: true },
    );
    assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
    assert.equal(await refreshTokenCount(t, seeded.remoteSessionId), 0);

    assert.deepEqual(
      await owner.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.remoteSessionId,
      }),
      { current: false, revoked: false },
    );
  });

  it("revokes before cleaning a long refresh-token history in bounded batches", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);
    const refreshTokenCountBefore = 300;

    await t.run(async (ctx) => {
      for (let index = 0; index < refreshTokenCountBefore; index += 1) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId: seeded.remoteSessionId,
          expirationTime: EXPIRES_AT,
          firstUsedTime: Date.now() + index,
        });
      }
    });
    const initialRefreshTokenCount = await refreshTokenCount(
      t,
      seeded.remoteSessionId,
    );

    assert.deepEqual(
      await owner.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.remoteSessionId,
      }),
      { current: false, revoked: true },
    );
    assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
    assert.equal(
      await refreshTokenCount(t, seeded.remoteSessionId),
      initialRefreshTokenCount - AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE,
    );

    assert.equal(
      await t.run((ctx) =>
        deleteAuthRefreshTokenBatch(ctx, seeded.remoteSessionId),
      ),
      true,
    );
    assert.equal(
      await t.run((ctx) =>
        deleteAuthRefreshTokenBatch(ctx, seeded.remoteSessionId),
      ),
      false,
    );

    assert.equal(await refreshTokenCount(t, seeded.remoteSessionId), 0);
  });

  it("serializes concurrent revocation attempts without crossing ownership", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);

    const results = await Promise.all([
      owner.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.remoteSessionId,
      }),
      owner.mutation(api.accountSessions.revokeMine, {
        sessionId: seeded.remoteSessionId,
      }),
    ]);

    assert.deepEqual(
      results.map((result) => result.revoked).sort(),
      [false, true],
    );
    assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
    assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);
  });

  it("does not reveal or revoke a session owned by another account", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);

    assert.deepEqual(
      await t
        .withIdentity(seeded.identity)
        .mutation(api.accountSessions.revokeMine, {
          sessionId: seeded.otherUserSessionId,
        }),
      { current: false, revoked: false },
    );
    assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);
  });

  it("revokes every other session through bounded account-tree cleanup", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);

    try {
      await t
        .withIdentity(seeded.identity)
        .action(api.accountSessions.revokeOthers, {});

      assert.equal(await sessionExists(t, seeded.currentSessionId), true);
      assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
      assert.equal(await refreshTokenCount(t, seeded.remoteSessionId), 2);
      assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);

      await finishScheduledWork(t);
      assert.equal(await refreshTokenCount(t, seeded.remoteSessionId), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("bounds global revocation when a session has a long refresh history", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);
    const extraRefreshTokens = 300;

    await t.run(async (ctx) => {
      for (let index = 0; index < extraRefreshTokens; index += 1) {
        await ctx.db.insert("authRefreshTokens", {
          sessionId: seeded.remoteSessionId,
          expirationTime: EXPIRES_AT,
          firstUsedTime: Date.now() + index,
        });
      }
    });
    const initialRefreshTokenCount = await refreshTokenCount(
      t,
      seeded.remoteSessionId,
    );

    try {
      await owner.action(api.accountSessions.revokeOthers, {});

      assert.equal(await sessionExists(t, seeded.currentSessionId), true);
      assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
      assert.equal(
        await refreshTokenCount(t, seeded.remoteSessionId),
        initialRefreshTokenCount,
      );
      assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);

      await finishScheduledWork(t);
      assert.equal(await refreshTokenCount(t, seeded.remoteSessionId), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("revokes all owned sessions and hides private data from a still-valid JWT", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);

    try {
      await owner.action(api.accountSessions.revokeAll, {});

      assert.equal(await sessionExists(t, seeded.currentSessionId), false);
      assert.equal(await sessionExists(t, seeded.remoteSessionId), false);
      assert.equal(await refreshTokenCount(t, seeded.currentSessionId), 1);
      assert.equal((await owner.query(api.accountSessions.listMine, {})).state, "revoked");
      assert.equal(
        await owner.query(api.authSessionAuthority.status, {}),
        "revoked",
      );
      assert.equal(
        await owner.query(api.authSessionAuthority.viewer, {}),
        null,
      );
      assert.equal(await owner.query(api.accounts.viewer, {}), null);

      await finishScheduledWork(t);
      assert.equal(await refreshTokenCount(t, seeded.currentSessionId), 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("durably continues a large revoke-all request across bounded batches", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);
    const extraSessionCount = ACCOUNT_SESSION_REVOCATION_BATCH_SIZE + 8;
    let longHistorySessionId: Id<"authSessions"> | null = null;

    await t.run(async (ctx) => {
      for (let index = 0; index < extraSessionCount; index += 1) {
        const sessionId = await ctx.db.insert("authSessions", {
          userId: seeded.userId,
          expirationTime: EXPIRES_AT,
        });
        await ctx.db.insert("authRefreshTokens", {
          sessionId,
          expirationTime: EXPIRES_AT,
        });
        if (index === 0) {
          longHistorySessionId = sessionId;
          for (
            let tokenIndex = 0;
            tokenIndex < AUTH_REFRESH_TOKEN_DELETE_BATCH_SIZE * 2 + 7;
            tokenIndex += 1
          ) {
            await ctx.db.insert("authRefreshTokens", {
              sessionId,
              expirationTime: EXPIRES_AT,
              firstUsedTime: Date.now() + tokenIndex,
            });
          }
        }
      }
    });
    const before = await ownedSessionCount(t, seeded.userId);

    try {
      await owner.action(api.accountSessions.revokeAll, {});

      const afterInitialBatch = await ownedSessionCount(t, seeded.userId);
      assert.equal(await sessionExists(t, seeded.currentSessionId), false);
      assert.ok(afterInitialBatch > 0);
      assert.ok(
        before - afterInitialBatch <=
          ACCOUNT_SESSION_REVOCATION_BATCH_SIZE + 1,
      );
      assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);

      await finishScheduledWork(t);
      assert.equal(await ownedSessionCount(t, seeded.userId), 0);
      assert.equal(await sessionExists(t, seeded.otherUserSessionId), true);
      assert.notEqual(longHistorySessionId, null);
      assert.equal(
        await refreshTokenCount(t, longHistorySessionId!),
        0,
      );
    } finally {
      mock.timers.reset();
    }
  });

  it("preserves sessions created after a revoke-others snapshot", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const owner = t.withIdentity(seeded.identity);

    await t.run(async (ctx) => {
      for (
        let index = 0;
        index < ACCOUNT_SESSION_REVOCATION_BATCH_SIZE + 4;
        index += 1
      ) {
        await ctx.db.insert("authSessions", {
          userId: seeded.userId,
          expirationTime: EXPIRES_AT,
        });
      }
    });

    try {
      await owner.action(api.accountSessions.revokeOthers, {});
      const postSnapshotSessionId = await t.run((ctx) =>
        ctx.db.insert("authSessions", {
          userId: seeded.userId,
          expirationTime: EXPIRES_AT,
        }),
      );

      await finishScheduledWork(t);
      const remainingOwnedSessionIds = await t.run(async (ctx) =>
        (
          await ctx.db
            .query("authSessions")
            .withIndex("userId", (query) =>
              query.eq("userId", seeded.userId),
            )
            .collect()
        ).map((session) => session._id),
      );

      assert.deepEqual(
        remainingOwnedSessionIds.sort(),
        [seeded.currentSessionId, postSnapshotSessionId].sort(),
      );
    } finally {
      mock.timers.reset();
    }
  });

  it("rejects anonymous and stale attempts to start global revocation", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seedSessions(t);
    const before = await ownedSessionCount(t, seeded.userId);

    await assert.rejects(
      t.action(api.accountSessions.revokeOthers, {}),
    );
    assert.equal(await ownedSessionCount(t, seeded.userId), before);

    await t.run(async (ctx) => {
      const challenges = await ctx.db
        .query("recentAuthChallenges")
        .collect();
      for (const challenge of challenges) {
        await ctx.db.delete(challenge._id);
      }
    });
    await assert.rejects(
      t
        .withIdentity(seeded.identity)
        .action(api.accountSessions.revokeAll, {}),
    );
    assert.equal(await ownedSessionCount(t, seeded.userId), before);
  });
});
