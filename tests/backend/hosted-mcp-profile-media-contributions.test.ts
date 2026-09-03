import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";

process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profileMediaSubmissions.ts": () => import("../../convex/profileMediaSubmissions"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const KEY_HASH = "a".repeat(64);
const FINGERPRINT = "b".repeat(64);

async function seed() {
  const t = convexTest({ schema, modules });
  const seeded = await t.run(async (ctx) => {
    const actorUserId = await ctx.db.insert("users", {
      clerkUserId: `user_${crypto.randomUUID()}`,
      email: "contributor@example.test",
      emailVerificationTime: NOW,
    });
    const profileId = await ctx.db.insert("profiles", {
      profileType: "person",
      slug: "community-dj",
      displayName: "Community DJ",
      sortName: "community dj",
      aliases: [],
      tags: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      person: { roleTags: ["DJ"] },
      updatedAt: NOW,
    });
    const moderatorClerkId = `user_${crypto.randomUUID()}`;
    const moderatorUserId = await ctx.db.insert("users", {
      clerkUserId: moderatorClerkId,
      email: "moderator@example.test",
      emailVerificationTime: NOW,
    });
    await ctx.db.insert("accountFeatureGrants", {
      userId: moderatorUserId,
      feature: "super_admin",
      state: "active",
      grantedBy: { tokenIdentifier: "test:operator", issuer: "test", subject: "operator" },
      grantedAt: NOW,
      updatedAt: NOW,
    });
    return {
      actorUserId,
      profileId,
      moderatorIdentity: {
        subject: moderatorClerkId,
        email: "moderator@example.test",
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${moderatorUserId}`,
      },
    };
  });
  return { t, ...seeded };
}

function input(actorUserId: Awaited<ReturnType<typeof seed>>["actorUserId"]) {
  return {
    actorUserId,
    oauthClientId: "mcp-client",
    oauthTokenId: "oauth-token-id",
    requestId: crypto.randomUUID(),
    idempotencyKeyHash: KEY_HASH,
    requestFingerprint: FINGERPRINT,
    slug: "community-dj",
    sourceUrl: "https://images.example.test/profile.png",
    credit: "Artist press kit",
    expectedUpdatedAt: NOW,
    emailVerificationAttestedAt: Date.now(),
    emailVerified: true,
  };
}

describe("hosted MCP profile media contributions", () => {
  it("creates one private proposal intent and reuses it for the same request", async () => {
    const seeded = await seed();
    const first = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      input(seeded.actorUserId),
    );
    await seeded.t.run((ctx) => ctx.db.patch(seeded.actorUserId, {
      email: undefined,
      emailVerificationTime: undefined,
    }));
    const unverifiedReplay = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), emailVerified: false },
    );
    const replay = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    );

    assert.equal(first.status, "pending");
    assert.deepEqual(unverifiedReplay, {
      status: "failed",
      errorCode: "MCP_MEDIA_EMAIL_UNVERIFIED",
    });
    assert.deepEqual(replay, first);
    const stored = await seeded.t.run(async (ctx) => ({
      assets: await ctx.db.query("profileAssets").collect(),
      intents: await ctx.db.query("profileAssetUploadIntents").collect(),
      submissions: await ctx.db.query("profileMediaSubmissions").collect(),
    }));
    assert.equal(stored.assets.length, 0);
    assert.equal(stored.intents.length, 1);
    assert.equal(stored.intents[0]?.purpose, "community_proposal");
    assert.equal(stored.submissions.length, 1);
    assert.equal(stored.submissions[0]?.status, "upload_pending");
    assert.equal(stored.submissions[0]?.submitterUserId, seeded.actorUserId);

    await assert.rejects(
      seeded.t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, {
        ...input(seeded.actorUserId),
        requestFingerprint: "c".repeat(64),
      }),
      /MCP_MEDIA_IDEMPOTENCY_CONFLICT/,
    );
  });

  it("finalizes only the private proposal and returns caller-scoped status", async () => {
    const seeded = await seed();
    const prepared = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      input(seeded.actorUserId),
    );
    assert.equal(prepared.status, "pending");
    if (prepared.status !== "pending") return;

    const processingToken = crypto.randomUUID();
    const claim = await seeded.t.mutation(
      internal.profileMediaSubmissions.claimMcpMediaSubmissionImport,
      { intentId: prepared.intentId, processingToken },
    );
    assert.equal(claim.status, "claimed");
    assert.equal("uploadToken" in claim, false);
    const completed = await seeded.t.mutation(
      internal.profileMediaSubmissions.markMcpMediaSubmissionImported,
      {
        intentId: prepared.intentId,
        processingToken,
        mimeType: "image/webp",
        byteSize: 128,
        contentSha256: "contribution-hash",
        width: 800,
        height: 800,
      },
    );

    assert.equal(completed.status, "submitted");
    assert.equal(completed.profileSlug, "community-dj");
    const replay = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    );
    assert.equal(replay.status, "completed");
    const status = await seeded.t.query(
      internal.profileMediaSubmissions.listMcpMediaSubmissionsForActor,
      { actorUserId: seeded.actorUserId },
    );
    assert.deepEqual(status, { submissions: [completed] });

    const stored = await seeded.t.run(async (ctx) => ({
      assets: await ctx.db.query("profileAssets").collect(),
      audit: await ctx.db.query("apiWriteAuditEvents").collect(),
    }));
    assert.equal(stored.assets.length, 0);
    const accepted = stored.audit.find((row) => row.action === "profile_media_submission_submitted");
    assert.equal(accepted?.actorUserId, seeded.actorUserId);
    assert.equal(accepted?.ownerUserId, undefined);
    assert.equal(accepted?.oauthTokenId, "oauth-token-id");
    assert.equal(JSON.stringify(accepted).includes("sourceUrl"), false);

    const beforeApproval = await seeded.t.query(api.profileAssets.listPublicBySlug, {
      slug: "community-dj",
    });
    assert.equal(beforeApproval?.mediaKit.profileImage, undefined);
    const decision = await seeded.t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.decide,
      {
        submissionId: completed.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        finalPlacement: "profile_image",
        credit: "Reviewed artist credit",
        privateReason: "Source reviewed for this test.",
      },
    );
    assert.equal(decision.status, "approved");
    const approvedStatus = await seeded.t.query(
      internal.profileMediaSubmissions.listMcpMediaSubmissionsForActor,
      { actorUserId: seeded.actorUserId },
    );
    assert.equal(approvedStatus.submissions[0]?.approvedAssetId, decision.assetId);
    assert.notEqual(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );
    await seeded.t.run((ctx) => ctx.db.patch(seeded.profileId, {
      fieldVisibility: { avatarImageUrl: "private" },
    }));
    const privateStatus = await seeded.t.query(
      internal.profileMediaSubmissions.listMcpMediaSubmissionsForActor,
      { actorUserId: seeded.actorUserId },
    );
    assert.equal(privateStatus.submissions[0]?.approvedAssetId, undefined);
    assert.equal(
      await seeded.t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );
  });

  it("holds a live lease, resumes a stale lease, and remembers terminal failure", async () => {
    const seeded = await seed();
    const prepared = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      input(seeded.actorUserId),
    );
    assert.equal(prepared.status, "pending");
    if (prepared.status !== "pending") return;

    const firstToken = crypto.randomUUID();
    const firstClaim = await seeded.t.mutation(
      internal.profileMediaSubmissions.claimMcpMediaSubmissionImport,
      { intentId: prepared.intentId, processingToken: firstToken },
    );
    assert.equal(firstClaim.status, "claimed");
    assert.equal((await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    )).status, "processing");
    assert.equal((await seeded.t.mutation(
      internal.profileMediaSubmissions.claimMcpMediaSubmissionImport,
      { intentId: prepared.intentId, processingToken: crypto.randomUUID() },
    )).status, "in_use");

    await seeded.t.run(async (ctx) => {
      await ctx.db.patch(prepared.intentId, {
        processingStartedAt: Date.now() - 11 * 60 * 1_000,
      });
    });
    const secondToken = crypto.randomUUID();
    const secondClaim = await seeded.t.mutation(
      internal.profileMediaSubmissions.claimMcpMediaSubmissionImport,
      { intentId: prepared.intentId, processingToken: secondToken },
    );
    assert.equal(secondClaim.status, "claimed");
    assert.equal(
      firstClaim.status === "claimed" ? firstClaim.storageKey : undefined,
      secondClaim.status === "claimed" ? secondClaim.storageKey : undefined,
    );
    assert.equal(await seeded.t.mutation(
      internal.profileMediaSubmissions.failMcpMediaSubmissionImport,
      {
        intentId: prepared.intentId,
        processingToken: secondToken,
        errorCode: "MCP_MEDIA_IMPORT_REJECTED",
      },
    ), true);
    assert.equal((await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    )).status, "failed");
    const rows = await seeded.t.run(async (ctx) => ({
      intents: await ctx.db.query("profileAssetUploadIntents").collect(),
      submissions: await ctx.db.query("profileMediaSubmissions").collect(),
    }));
    assert.equal(rows.intents.length, 1);
    assert.equal(rows.submissions.length, 1);
    assert.equal(rows.submissions[0]?.status, "withdrawn");
  });

  it("expires the same receipt deterministically and isolates status by contributor", async () => {
    const seeded = await seed();
    const prepared = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      input(seeded.actorUserId),
    );
    assert.equal(prepared.status, "pending");
    if (prepared.status !== "pending") return;

    const otherActorUserId = await seeded.t.run((ctx) => ctx.db.insert("users", {
      clerkUserId: `user_${crypto.randomUUID()}`,
      email: "other-contributor@example.test",
      emailVerificationTime: NOW,
    }));
    await seeded.t.run((ctx) => ctx.db.patch(prepared.intentId, { expiresAt: Date.now() - 1 }));
    const expired = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    );
    const replay = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
    );
    const otherStatus = await seeded.t.query(
      internal.profileMediaSubmissions.listMcpMediaSubmissionsForActor,
      { actorUserId: otherActorUserId },
    );

    assert.deepEqual(expired, { status: "expired" });
    assert.deepEqual(replay, expired);
    assert.deepEqual(otherStatus, { submissions: [] });
    const rows = await seeded.t.run(async (ctx) => ({
      intents: await ctx.db.query("profileAssetUploadIntents").collect(),
      submissions: await ctx.db.query("profileMediaSubmissions").collect(),
    }));
    assert.equal(rows.intents.length, 1);
    assert.equal(rows.intents[0]?.mcpFailureCode, "MCP_MEDIA_IMPORT_EXPIRED");
    assert.equal(rows.submissions.length, 1);
    assert.equal(rows.submissions[0]?.status, "withdrawn");
  });

  it("refuses unverified, stale, claimed, community, and nonpublic targets", async () => {
    for (const target of ["unverified", "stale", "claimed", "community", "hidden"] as const) {
      const seeded = await seed();
      await seeded.t.run(async (ctx) => {
        if (target === "unverified") {
          await ctx.db.patch(seeded.actorUserId, { emailVerificationTime: undefined });
        } else if (target === "claimed") {
          await ctx.db.patch(seeded.profileId, { claimState: "claimed_verified" });
        } else if (target === "community") {
          const profile = await ctx.db.get(seeded.profileId);
          assert.ok(profile);
          const { person: _person, ...shared } = profile;
          await ctx.db.replace(seeded.profileId, {
            ...shared,
            profileType: "community",
            community: { categoryTags: [] },
          });
        } else if (target === "hidden") {
          await ctx.db.patch(seeded.profileId, { publicSurfacingState: "opted_out" });
        }
      });
      const request = input(seeded.actorUserId);
      if (target === "unverified") request.emailVerified = false;
      if (target === "stale") request.expectedUpdatedAt += 1;
      const refused = await seeded.t.mutation(
        internal.profileMediaSubmissions.prepareMcpMediaSubmission,
        request,
      );
      const replay = await seeded.t.mutation(
        internal.profileMediaSubmissions.prepareMcpMediaSubmission,
        { ...request, requestId: crypto.randomUUID() },
      );
      assert.equal(refused.status, "failed", target);
      assert.deepEqual(replay, refused, target);
      await assert.rejects(
        seeded.t.mutation(internal.profileMediaSubmissions.prepareMcpMediaSubmission, {
          ...request,
          requestFingerprint: "c".repeat(64),
        }),
        /MCP_MEDIA_IDEMPOTENCY_CONFLICT/,
      );
      const rows = await seeded.t.run(async (ctx) => ({
        intents: await ctx.db.query("profileAssetUploadIntents").collect(),
        refusals: await ctx.db.query("mcpProfileMediaSubmissionRefusalReceipts").collect(),
        submissions: await ctx.db.query("profileMediaSubmissions").collect(),
      }));
      assert.equal(rows.intents.length, 0, target);
      assert.equal(rows.refusals.length, 1, target);
      assert.equal(rows.submissions.length, 0, target);
    }
  });

  it("replays every completed review lifecycle state without creating another intent", async () => {
    for (const status of [
      "under_review",
      "approved",
      "rejected",
      "withdrawn",
      "superseded",
    ] as const) {
      const seeded = await seed();
      const prepared = await seeded.t.mutation(
        internal.profileMediaSubmissions.prepareMcpMediaSubmission,
        input(seeded.actorUserId),
      );
      assert.equal(prepared.status, "pending");
      if (prepared.status !== "pending") continue;
      await seeded.t.run(async (ctx) => {
        const intent = await ctx.db.get(prepared.intentId);
        assert.ok(intent?.targetSubmissionId);
        await ctx.db.patch(intent.targetSubmissionId, { status, updatedAt: Date.now() });
      });
      const replay = await seeded.t.mutation(
        internal.profileMediaSubmissions.prepareMcpMediaSubmission,
        { ...input(seeded.actorUserId), requestId: crypto.randomUUID() },
      );
      assert.equal(replay.status, "completed", status);
      if (replay.status === "completed") assert.equal(replay.submission.status, status);
      const intents = await seeded.t.run((ctx) => ctx.db.query("profileAssetUploadIntents").collect());
      assert.equal(intents.length, 1, status);
    }
  });

  it("persists deterministic open, daily, profile, and cooldown limit refusals", async () => {
    for (const scenario of [
      "user_open",
      "profile_open",
      "user_daily",
      "profile_daily",
      "cooldown",
    ] as const) {
      const seeded = await seed();
      await seeded.t.run(async (ctx) => {
        const now = Date.now();
        const otherUserId = await ctx.db.insert("users", {
          clerkUserId: `user_${crypto.randomUUID()}`,
          email: "other@example.test",
          emailVerificationTime: now,
        });
        const count = scenario === "user_open"
          ? 3
          : scenario === "profile_open"
            ? 2
            : scenario === "user_daily"
              ? 6
              : scenario === "profile_daily"
                ? 20
                : 1;
        for (let index = 0; index < count; index += 1) {
          const useOtherActor = scenario === "profile_open" || scenario === "profile_daily";
          const submitterUserId = useOtherActor ? otherUserId : seeded.actorUserId;
          const status = scenario.endsWith("open") ? "submitted" as const : "rejected" as const;
          const createdAt = scenario === "cooldown"
            ? now - 1_000
            : now - 60_000 - index;
          await ctx.db.insert("profileMediaSubmissions", {
            profileId: seeded.profileId,
            targetProfileSlug: "community-dj",
            targetProfileDisplayName: "Community DJ",
            submitterUserId,
            submitter: {
              tokenIdentifier: `api:${submitterUserId}`,
              issuer: "vrdex:api",
              subject: String(submitterUserId),
            },
            requestedPlacement: "profile_image",
            sourceUrl: `https://images.example.test/${scenario}-${index}.png`,
            credit: "Test source",
            status,
            targetProfileUpdatedAt: NOW,
            expiresAt: now + 60_000,
            createdAt,
            updatedAt: createdAt,
          });
        }
      });
      const result = await seeded.t.mutation(
        internal.profileMediaSubmissions.prepareMcpMediaSubmission,
        input(seeded.actorUserId),
      );
      const expected = {
        user_open: "MCP_MEDIA_OPEN_USER_LIMIT",
        profile_open: "MCP_MEDIA_OPEN_PROFILE_LIMIT",
        user_daily: "MCP_MEDIA_USER_DAILY_LIMIT",
        profile_daily: "MCP_MEDIA_PROFILE_DAILY_LIMIT",
        cooldown: "MCP_MEDIA_COOLDOWN",
      }[scenario];
      assert.deepEqual(result, { status: "failed", errorCode: expected }, scenario);
      const refusals = await seeded.t.run((ctx) =>
        ctx.db.query("mcpProfileMediaSubmissionRefusalReceipts").collect(),
      );
      assert.equal(refusals.length, 1, scenario);
    }
  });

  it("rejects an identical concurrent proposal inside the finalization transaction", async () => {
    const seeded = await seed();
    const otherActorUserId = await seeded.t.run((ctx) => ctx.db.insert("users", {
      clerkUserId: `user_${crypto.randomUUID()}`,
      email: "other-contributor@example.test",
      emailVerificationTime: Date.now(),
    }));
    const first = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      input(seeded.actorUserId),
    );
    const second = await seeded.t.mutation(
      internal.profileMediaSubmissions.prepareMcpMediaSubmission,
      {
        ...input(otherActorUserId),
        idempotencyKeyHash: "c".repeat(64),
        requestFingerprint: "d".repeat(64),
      },
    );
    assert.equal(first.status, "pending");
    assert.equal(second.status, "pending");
    if (first.status !== "pending" || second.status !== "pending") return;
    const firstToken = crypto.randomUUID();
    const secondToken = crypto.randomUUID();
    await seeded.t.mutation(internal.profileMediaSubmissions.claimMcpMediaSubmissionImport, {
      intentId: first.intentId,
      processingToken: firstToken,
    });
    await seeded.t.mutation(internal.profileMediaSubmissions.claimMcpMediaSubmissionImport, {
      intentId: second.intentId,
      processingToken: secondToken,
    });
    const upload = {
      mimeType: "image/webp",
      byteSize: 128,
      contentSha256: "same-concurrent-hash",
      width: 800,
      height: 800,
    };
    await seeded.t.mutation(internal.profileMediaSubmissions.markMcpMediaSubmissionImported, {
      intentId: first.intentId,
      processingToken: firstToken,
      ...upload,
    });
    await assert.rejects(
      seeded.t.mutation(internal.profileMediaSubmissions.markMcpMediaSubmissionImported, {
        intentId: second.intentId,
        processingToken: secondToken,
        ...upload,
      }),
      /already proposed/i,
    );
  });
});
