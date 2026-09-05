import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/e2eMedia.ts": () => import("../../convex/e2eMedia"),
  "../../convex/e2e.ts": () => import("../../convex/e2e"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profileMediaSubmissions.ts": () =>
    import("../../convex/profileMediaSubmissions"),
};
const secret = "media-fixture-unit-secret";
const runId = "media-unit-123";

function enable() {
  process.env.CONVEX_CLOUD_URL = "https://scrupulous-corgi-247.convex.cloud";
  process.env.VRDEX_E2E_CONVEX_SECRET = secret;
  for (const key of [
    "VRDEX_ENABLE_E2E_HELPERS",
    "VRDEX_ENABLE_E2E_AUTH_HELPERS",
    "VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED",
    "VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED",
    "VRDEX_PROFILE_MEDIA_KIT_ENABLED",
  ])
    process.env[key] = "true";
}

async function seed() {
  enable();
  const t = convexTest({ schema, modules });
  const profile = await t.mutation(api.e2e.submitProfile, {
    secret,
    runId,
    profileType: "person",
    displayName: `Media test ${runId}`,
  });
  const users = await t.run(async (ctx) => {
    const contributorClerkId = newClerkUserId();
    const contributorEmail = `${runId}-contributor+clerk_test@e2e.vrdex.net`;
    const contributorId = await ctx.db.insert("users", {
      clerkUserId: contributorClerkId,
      email: contributorEmail,
      emailVerificationTime: Date.now(),
    });
    const reviewerEmail = `${runId}-reviewer+clerk_test@e2e.vrdex.net`;
    const reviewerId = await ctx.db.insert("users", {
      clerkUserId: newClerkUserId(),
      email: reviewerEmail,
      emailVerificationTime: Date.now(),
    });
    return {
      contributorId,
      reviewerId,
      reviewerEmail,
      identity: {
        subject: contributorClerkId,
        issuer: "test",
        tokenIdentifier: `test|${contributorClerkId}`,
        email: contributorEmail,
        emailVerified: true,
      },
    };
  });
  const args = { secret, runId, profileId: profile.profileId };
  const record = await t.run((ctx) => ctx.db.get(profile.profileId));
  const intent = await t
    .withIdentity(users.identity)
    .mutation(api.profileMediaSubmissions.createUploadIntent, {
      profileId: profile.profileId,
      requestedPlacement: "profile_image",
      originalFileName: "portrait.png",
      mimeType: "image/png",
      byteSize: 512,
      sourceUrl: "https://example.test/portrait",
      credit: "Fixture credit",
      expectedProfileUpdatedAt: record!.updatedAt,
    });
  return { t, args, users, intent };
}

describe("bounded staging media fixture", () => {
  it("recovers the exact fixture by durable run ID and rejects unrelated slug collisions", async () => {
    const { t, args } = await seed();
    assert.deepEqual(
      await t.query(internal.e2eMedia.findFixture, { secret, runId }),
      { profileId: args.profileId },
    );
    assert.deepEqual(
      await t.query(internal.e2eMedia.findFixture, { secret, runId: "media-absent" }),
      { profileId: null },
    );
    await assert.rejects(
      t.query(internal.e2eMedia.findFixture, { secret, runId: "ordinary" }),
      /Invalid media run ID/,
    );
    await t.run((ctx) => ctx.db.patch(args.profileId, { sourceAttribution: undefined }));
    await assert.rejects(
      t.query(internal.e2eMedia.findFixture, { secret, runId }),
      /Exact media fixture/,
    );
  });
  it("retries a completed deletion without claiming orphaned media was cleaned", async () => {
    const { t, args } = await seed();
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    await t.mutation(internal.e2eMedia.finishCleanup, {
      ...args, deletedStorageKeys: prepared.storageKeys,
    });
    const profile = await t.run((ctx) => ctx.db.get(args.profileId));
    await t.mutation(api.e2e.cleanupProfileBySlug, { secret, slug: profile!.slug });
    assert.deepEqual(await t.mutation(internal.e2eMedia.prepareCleanup, args), {
      storageKeys: [], profileMissing: true,
    });
    const orphan = await seed();
    await orphan.t.run((ctx) => ctx.db.delete(orphan.args.profileId));
    await assert.rejects(orphan.t.mutation(internal.e2eMedia.prepareCleanup, orphan.args), /dependent rows/);
  });
  it("removes refusal receipts only for the run's disposable contributor", async () => {
    const { t, args, users } = await seed();
    const receipts = await t.run(async (ctx) => {
      const fields = {
        oauthClientId: "fixture-client",
        idempotencyKeyHash: "fixture-key",
        requestFingerprint: "fixture-fingerprint",
        errorCode: "MCP_MEDIA_SUBMISSION_DENIED",
        createdAt: Date.now(),
      };
      const fixtureReceipt = await ctx.db.insert(
        "mcpProfileMediaSubmissionRefusalReceipts",
        { ...fields, actorUserId: users.contributorId },
      );
      const unrelatedReceipt = await ctx.db.insert(
        "mcpProfileMediaSubmissionRefusalReceipts",
        { ...fields, actorUserId: users.reviewerId },
      );
      return { fixtureReceipt, unrelatedReceipt };
    });
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    await t.mutation(internal.e2eMedia.finishCleanup, {
      ...args,
      deletedStorageKeys: prepared.storageKeys,
    });
    assert.equal(
      await t.run((ctx) => ctx.db.get(receipts.fixtureReceipt)),
      null,
    );
    assert.ok(await t.run((ctx) => ctx.db.get(receipts.unrelatedReceipt)));
  });
  it("rejects production even when the ordinary helper production override is set", async () => {
    const { t, args } = await seed();
    process.env.CONVEX_CLOUD_URL = "https://production.convex.cloud";
    process.env.VRDEX_ALLOW_PRODUCTION_E2E_HELPERS = "true";
    await assert.rejects(
      t.query(internal.e2eMedia.inspect, args),
      /unavailable/,
    );
    enable();
    await assert.rejects(
      t.query(internal.e2eMedia.inspect, { ...args, secret: "wrong" }),
      /unavailable/,
    );
  });

  it("rejects ordinary profiles and mismatched fixture runs without mutation", async () => {
    const { t, args } = await seed();
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, {
        ...args,
        runId: "media-other",
      }),
      /Exact media fixture/,
    );
    await t.run((ctx) =>
      ctx.db.patch(args.profileId, { sourceAttribution: undefined }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /Exact media fixture/,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState,
      "published",
    );
  });

  it("grants only run-linked normal ownership after another user submits", async () => {
    const { t, args, users, intent } = await seed();
    await assert.rejects(
      t.mutation(internal.e2eMedia.assignReviewOwner, {
        ...args,
        reviewerEmail: "person@example.com",
      }),
      /Run-linked/,
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.assignReviewOwner, {
        ...args,
        reviewerEmail: users.reviewerEmail,
      }),
      /submit first/,
    );
    await t.run((ctx) =>
      ctx.db.patch(intent.submissionId, { status: "submitted" }),
    );
    await t.mutation(internal.e2eMedia.assignReviewOwner, {
      ...args,
      reviewerEmail: users.reviewerEmail,
    });
    const owners = await t.run((ctx) =>
      ctx.db.query("profileOwners").collect(),
    );
    assert.equal(owners.length, 1);
    assert.equal(owners[0].userId, users.reviewerId);
    assert.equal(owners[0].roleKey, "owner");
    assert.deepEqual(
      await t.run((ctx) => ctx.db.query("accountFeatureGrants").collect()),
      [],
    );
  });

  it("preserves recovery metadata for expired leases because claim age does not fence S3 writes", async () => {
    const { t, args, intent } = await seed();
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, {
        processingToken: "stalled-worker",
        processingStartedAt: Date.now() - 11 * 60 * 1000,
      }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /active storage work/,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(intent.intentId)))?.processingToken,
      "stalled-worker",
    );
    assert.ok(await t.run((ctx) => ctx.db.get(intent.submissionId)));
    assert.equal(
      (await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState,
      "published",
    );
  });

  it("refuses active storage work and keeps recoverable metadata until deletion is acknowledged", async () => {
    const { t, args, intent } = await seed();
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, { processingToken: "in-flight" }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /active storage work/,
    );
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, { processingToken: undefined }),
    );
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.ok(prepared.storageKeys.length > 0);
    assert.equal(
      (await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState,
      "draft_private",
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.finishCleanup, {
        ...args,
        deletedStorageKeys: [],
      }),
      /not prepared/,
    );
    assert.ok(await t.run((ctx) => ctx.db.get(intent.intentId)));
    const retry = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.deepEqual(retry.storageKeys, prepared.storageKeys);
    await t.mutation(internal.e2eMedia.finishCleanup, {
      ...args,
      deletedStorageKeys: retry.storageKeys,
    });
    assert.equal(await t.run((ctx) => ctx.db.get(intent.intentId)), null);
    assert.equal(await t.run((ctx) => ctx.db.get(intent.submissionId)), null);
    assert.ok(await t.run((ctx) => ctx.db.get(args.profileId)));
  });

  it("does not expose storage credentials or private proposal data in inspection", async () => {
    const { t, args } = await seed();
    const result = await t.query(internal.e2eMedia.inspect, args);
    assert.equal(result.counts.submissions, 1);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "storageKey",
      "uploadToken",
      "sourceUrl",
      "credit",
      "submitter",
      "privateReason",
      "@e2e",
    ])
      assert.ok(!serialized.includes(forbidden));
  });

  it("rejects a storage key outside the scoped proposal and preserves its rows", async () => {
    const { t, args, intent } = await seed();
    await t.run((ctx) =>
      ctx.db.patch(intent.intentId, {
        storageKey: "profile-assets/ordinary-user/display.webp",
      }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /Unscoped fixture storage key/,
    );
    assert.ok(await t.run((ctx) => ctx.db.get(intent.intentId)));
  });

  it("rejects ordinary contributors, reserved blob cleanup, and legal holds", async () => {
    const { t, args, intent, users } = await seed();
    await t.run((ctx) =>
      ctx.db.patch(users.contributorId, { email: "ordinary@example.test" }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /Non-fixture contributor/,
    );
    await t.run((ctx) =>
      ctx.db.patch(users.contributorId, {
        email: `${runId}-contributor+clerk_test@e2e.vrdex.net`,
      }),
    );
    await t.run((ctx) =>
      ctx.db.patch(intent.submissionId, { blobCleanupToken: "worker" }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /active storage work/,
    );
    await t.run((ctx) =>
      ctx.db.patch(intent.submissionId, {
        blobCleanupToken: undefined,
        legalHoldAt: Date.now(),
      }),
    );
    await assert.rejects(
      t.mutation(internal.e2eMedia.prepareCleanup, args),
      /legal hold/,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState,
      "published",
    );
  });

  it("prevents a new storage claim after cleanup is prepared", async () => {
    const { t, args, intent } = await seed();
    await t.mutation(internal.e2eMedia.prepareCleanup, args);
    const claim = await t.mutation(
      internal.profileAssets.claimUploadIntentForStorage,
      {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken: "new-worker",
      },
    );
    assert.notEqual(claim.status, "claimed");
    const proposal = await t.run((ctx) => ctx.db.get(intent.submissionId));
    assert.equal(proposal?.status, "withdrawn");
    assert.equal(proposal?.blobDeleteAfter, undefined);
  });
});
