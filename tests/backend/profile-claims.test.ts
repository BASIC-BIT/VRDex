import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileClaims.ts": () => import("../../convex/profileClaims"),
};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;

describe("profile claim lifecycle", () => {
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
});
