import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";
import {
  AUTH_SESSION_INVALID_CODE,
  RECENT_AUTH_MAX_AGE_MS,
  RECENT_AUTH_REQUIRED_CODE,
  activeAuthSessionStatusAt,
  authSessionIsRecentAt,
  requireActiveAuthSession,
  requireRecentAuthSession,
} from "../../convex/_authSessionGuard";
import schemaModule from "../../convex/schema";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const userId = "user123" as Id<"users">;
const sessionId = "session123" as Id<"authSessions">;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/apiTokens.ts": () => import("../../convex/apiTokens"),
  "../../convex/oauthApps.ts": () => import("../../convex/oauthApps"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

function session(
  overrides: Partial<Doc<"authSessions">> = {},
): Doc<"authSessions"> {
  return {
    _creationTime: NOW,
    _id: sessionId,
    expirationTime: NOW + 60_000,
    userId,
    ...overrides,
  };
}

function guardContext(args: {
  authUserId?: Id<"users"> | null;
  recentAuthCompletedAt?: number;
  session?: Doc<"authSessions"> | null;
  user?: Doc<"users"> | null;
}) {
  const authUserId = args.authUserId === undefined ? userId : args.authUserId;
  const authSessionId = authUserId === null ? null : sessionId;
  const identity =
    authUserId === null || authSessionId === null
      ? null
      : {
          issuer: "test",
          subject: `${authUserId}|${authSessionId}`,
          tokenIdentifier: `test|${authUserId}`,
        };
  const user = args.user === undefined
    ? {
        _creationTime: NOW,
        _id: userId,
        email: "recent-auth@example.test",
      } as Doc<"users">
    : args.user;
  const authSession = args.session === undefined ? session() : args.session;

  return {
    auth: {
      async getUserIdentity() {
        return identity;
      },
    },
    db: {
      async get(id: Id<"users"> | Id<"authSessions">) {
        if (id === sessionId) {
          return authSession;
        }

        if (id === userId) {
          return user;
        }

        return null;
      },
      query() {
        return {
          withIndex() {
            return {
              async collect() {
                return args.recentAuthCompletedAt === undefined
                  ? []
                  : [
                      {
                        completedAt: args.recentAuthCompletedAt,
                        completedSessionId: sessionId,
                        proofMethod: "password",
                        userId,
                      },
                    ];
              },
            };
          },
        };
      },
    },
  } as unknown as QueryCtx;
}

async function errorCode(operation: Promise<unknown>) {
  try {
    await operation;
    assert.fail("Expected the authentication guard to reject.");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof error.data === "object" &&
      error.data !== null &&
      "code" in error.data
    ) {
      return error.data.code;
    }

    throw error;
  }
}

describe("authentication session guards", () => {
  it("uses deterministic active and recent boundaries", () => {
    assert.equal(RECENT_AUTH_MAX_AGE_MS, 15 * 60 * 1_000);
    assert.equal(
      activeAuthSessionStatusAt({
        now: NOW,
        session: session(),
        userId,
      }),
      "active",
    );
    assert.equal(
      activeAuthSessionStatusAt({
        now: NOW,
        session: session({ expirationTime: NOW }),
        userId,
      }),
      "expired",
    );
    assert.equal(
      activeAuthSessionStatusAt({
        now: NOW,
        session: session({ userId: "otherUser" as Id<"users"> }),
        userId,
      }),
      "user_mismatch",
    );
    assert.equal(
      authSessionIsRecentAt({
        now: NOW + RECENT_AUTH_MAX_AGE_MS,
        sessionCreatedAt: NOW,
      }),
      true,
    );
    assert.equal(
      authSessionIsRecentAt({
        now: NOW + RECENT_AUTH_MAX_AGE_MS + 1,
        sessionCreatedAt: NOW,
      }),
      false,
    );
  });

  it("loads an active session and rejects missing, expired, or mismatched rows", async () => {
    const active = await requireActiveAuthSession(guardContext({}), NOW);
    assert.equal(active.userId, userId);
    assert.equal(active.sessionId, sessionId);

    assert.equal(
      await errorCode(
        requireActiveAuthSession(guardContext({ session: null }), NOW),
      ),
      AUTH_SESSION_INVALID_CODE,
    );
    assert.equal(
      await errorCode(
        requireActiveAuthSession(
          guardContext({ session: session({ expirationTime: NOW }) }),
          NOW,
        ),
      ),
      AUTH_SESSION_INVALID_CODE,
    );
    assert.equal(
      await errorCode(
        requireActiveAuthSession(
          guardContext({
            session: session({ userId: "otherUser" as Id<"users"> }),
          }),
          NOW,
        ),
      ),
      AUTH_SESSION_INVALID_CODE,
    );
  });

  it("requires a completed password step-up without sliding on activity", async () => {
    const active = guardContext({
      recentAuthCompletedAt: NOW - RECENT_AUTH_MAX_AGE_MS,
    });
    assert.equal((await requireRecentAuthSession(active, NOW)).sessionId, sessionId);

    const stale = guardContext({
      recentAuthCompletedAt: NOW - RECENT_AUTH_MAX_AGE_MS - 1,
    });
    assert.equal(
      await errorCode(requireRecentAuthSession(stale, NOW)),
      RECENT_AUTH_REQUIRED_CODE,
    );
    assert.equal(
      await errorCode(requireRecentAuthSession(guardContext({}), NOW)),
      RECENT_AUTH_REQUIRED_CODE,
    );
  });

  it("applies recent authentication to browser credential issuance", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await t.run(async (ctx) => {
      const seededUserId = await ctx.db.insert("users", {
        email: "credential-owner@example.test",
        emailVerificationTime: Date.now(),
      });
      const seededSessionId = await ctx.db.insert("authSessions", {
        expirationTime: Date.now() + 60_000,
        userId: seededUserId,
      });

      return { seededSessionId, seededUserId };
    });
    const identity = {
      issuer: "test",
      subject: `${seeded.seededUserId}|${seeded.seededSessionId}`,
      tokenIdentifier: `test|${seeded.seededUserId}`,
    };
    const authenticated = t.withIdentity(identity);

    await assert.rejects(
      authenticated.mutation(api.apiTokens.createPersonalToken, {
        label: "Unproven browser token",
        scopes: ["public:read"],
        tokenPrefix: `vrdx_${"z".repeat(24)}`,
        verifierHash: "y".repeat(64),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("recentAuthChallenges", {
        actionClass: "developer_token",
        challengeId: "0123456789abcdef0123456789abcdef",
        completedAt: Date.now(),
        completedSessionId: seeded.seededSessionId,
        expiresAt: Date.now() + RECENT_AUTH_MAX_AGE_MS,
        originalSessionId: seeded.seededSessionId,
        proofMethod: "password",
        userId: seeded.seededUserId,
      }),
    );

    const token = await authenticated.mutation(api.apiTokens.createPersonalToken, {
      label: "Recent browser token",
      scopes: ["public:read"],
      tokenPrefix: `vrdx_${"a".repeat(24)}`,
      verifierHash: "b".repeat(64),
    });
    assert.equal(token.ownerUserId, seeded.seededUserId);

    const application = await authenticated.mutation(
      api.oauthApps.createPersonalApplication,
      {
        allowedGrants: ["authorization_code"],
        allowedScopes: ["public:read"],
        clientId: `vrdx_app_${"c".repeat(24)}`,
        clientType: "public",
        displayName: "Recent browser app",
        redirectUris: ["http://127.0.0.1:3456/callback"],
      },
    );
    assert.equal(application.ownerUserId, seeded.seededUserId);

    const revokedApplication = await authenticated.mutation(
      api.oauthApps.revokePersonalApplication,
      {
        applicationId: application.id,
        reason: "Recent browser revocation",
      },
    );
    assert.equal(revokedApplication.status, "revoked");
  });
});
