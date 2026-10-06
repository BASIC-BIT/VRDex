import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
import { changeContributionCharge } from "../../convex/_contributionCapacity";

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
  "../../convex/contributionCleanup.ts": () => import("../../convex/contributionCleanup"),
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
    "VRDEX_CONTRIBUTION_UPLOADS_ENABLED",
    "VRDEX_MEDIA_UPLOAD_CLEANUP_READY",
  ])
    process.env[key] = "true";
  process.env.VRDEX_MEDIA_CLEANUP_URL = "https://example.test/api/internal/media-cleanup";
  process.env.VRDEX_MEDIA_CLEANUP_TOKEN = "test-only";
  delete process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED;
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
  await t.run(async (ctx) => {
    const reservation = await ctx.db.query("contributionUploadReservations")
      .withIndex("by_intentId", (q) => q.eq("intentId", intent.intentId)).unique();
    if (reservation) {
      await changeContributionCharge(ctx.db, reservation, 0, -1);
      await ctx.db.patch(reservation._id, { processing: false, state: "failed" });
    }
  });
  return { t, args, users, intent };
}

describe("bounded staging media fixture", () => {
  it("preflights direct uploads and refuses paused intake before creating accounts", async () => {
    const { t } = await seed();
    assert.deepEqual(await t.query(internal.e2eMedia.preflight, { secret }), { ready: true });
    delete process.env.VRDEX_MEDIA_UPLOAD_CLEANUP_READY;
    assert.deepEqual(await t.query(internal.e2eMedia.preflight, { secret, cleanupOnly: true }), { ready: true });
    await assert.rejects(t.query(internal.e2eMedia.preflight, { secret }), /flags are unavailable/);
    process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED = "true";
    await assert.rejects(t.query(internal.e2eMedia.preflight, { secret, cleanupOnly: true }), /flags are unavailable/);
    enable();
  });

  it("advances only the exact rejected staging URL fixture to worker cleanup", async () => {
    const { t, args, intent, users } = await seed();
    const proof = { ...args, submissionId: intent.submissionId };
    await assert.rejects(t.mutation(internal.e2eMedia.makeRejectedFixtureDue, proof), /Exact rejected URL fixture/);
    const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(intent.intentId))!;
      await ctx.db.patch(intent.intentId, {
        state: "uploaded",
        originalFileName: undefined,
        sourceUrl: (await ctx.db.get(intent.submissionId))!.sourceUrl,
        mcpActorUserId: users.contributorId,
        mcpIdempotencyKeyHash: "a".repeat(64),
        requestedBy: { issuer: "vrdex:api", subject: String(users.contributorId), tokenIdentifier: `api:${users.contributorId}` },
      });
      const reservation = (await ctx.db.query("contributionUploadReservations")
        .withIndex("by_intentId", (q) => q.eq("intentId", intent.intentId)).unique())!;
      await ctx.db.patch(reservation._id, { state: "committed" });
      assert.equal(row.issuer, undefined);
      await ctx.db.patch(intent.submissionId, { status: "rejected", blobDeleteAfter: future });
    });
    await t.run((ctx) => ctx.db.patch(intent.intentId, { issuer: "mcp_local" }));
    await assert.rejects(t.mutation(internal.e2eMedia.makeRejectedFixtureDue, proof), /Exact rejected URL fixture/);
    await t.run((ctx) => ctx.db.patch(intent.intentId, { issuer: undefined }));
    const due = await t.mutation(internal.e2eMedia.makeRejectedFixtureDue, proof);
    assert.ok(due.storageKeys.length > 0);
    assert.ok((await t.run((ctx) => ctx.db.get(intent.submissionId)))!.blobDeleteAfter! < Date.now());
    assert.deepEqual((await t.query(internal.e2eMedia.inspectRejectedFixtureDeletion, proof)).blobDeleted, false);
    await assert.rejects(t.mutation(internal.e2eMedia.makeRejectedFixtureDue, proof), /Exact rejected URL fixture/);
    enable();
  });
  it("reclaims only an expired pending local fixture through the worker uploads branch", async () => {
    const { t, args, intent, users } = await seed();
    const storageKey = "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000";
    const proof = { ...args, intentId: intent.intentId };
    const expiresAt = Date.now() + 60_000;
    const reservationId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, { issuer: "mcp_local", quarantineStorageKey: storageKey,
        state: "pending", expiresAt });
      await ctx.db.patch(intent.submissionId, { sourceKind: "local" });
      const row = (await ctx.db.query("contributionUploadReservations")
        .withIndex("by_intentId", (q) => q.eq("intentId", intent.intentId)).unique())!;
      await changeContributionCharge(ctx.db, row, 0, 1);
      await ctx.db.patch(row._id, { state: "pending", processing: true,
        quarantineBytes: 512, expiresAt, cleanupAfter: expiresAt + 86_400_000 });
      return row._id;
    });
    await assert.rejects(t.mutation(internal.e2eMedia.makePendingFixtureDue, proof), /Exact expired pending upload fixture/);
    await t.run((ctx) => ctx.db.patch(reservationId, { actorUserId: users.reviewerId }));
    await assert.rejects(t.mutation(internal.e2eMedia.makePendingFixtureDue, proof), /Non-fixture upload reservation/);
    await t.run(async (ctx) => {
      await ctx.db.patch(reservationId, { actorUserId: users.contributorId });
      const expired = Date.now() - 61_000;
      await ctx.db.patch(intent.intentId, { expiresAt: expired });
      await ctx.db.patch(reservationId, { expiresAt: expired, cleanupAfter: expired + 86_400_000 });
    });
    assert.deepEqual(await t.mutation(internal.e2eMedia.makePendingFixtureDue, proof), { storageKey });
    const claimed = await t.mutation(internal.contributionCleanup.claim, {});
    assert.equal(claimed.uploads.length, 1);
    assert.ok(claimed.uploads[0].keys.includes(storageKey));
    await t.mutation(internal.contributionCleanup.confirm, {
      uploads: [{ reservationId: claimed.uploads[0].reservationId, token: claimed.uploads[0].token }],
      proposals: claimed.proposals.map(({ submissionId, cleanupToken }) => ({ submissionId, cleanupToken })),
    });
    assert.deepEqual(await t.query(internal.e2eMedia.inspectPendingFixtureCleanup, proof), {
      state: "failed", code: "UPLOAD_EXPIRED", chargedBytes: 0, quarantineBytes: 0,
      processing: false, cleanupLeaseActive: false, cleanupDeferred: true,
      actorBytes: 0, actorProcessing: 0, targetBytes: 0, targetProcessing: 0,
    });
  });
  it("checks only the run contributor's bounded audit rows without returning identifiers", async () => {
    const { t, args, users } = await seed();
    const event = {
      actorUserId: users.contributorId,
      oauthClientId: "fixture-client", oauthTokenId: "fixture-token-id",
      requestId: "fixture-request", toolName: "vrdex_profile_media_submit" as const,
      routeClass: "authenticated_mcp_write" as const,
      eventType: "tool_invocation" as const, result: "denied" as const,
      createdAt: Date.now(),
    };
    const id = await t.run(async (ctx) => {
      await ctx.db.insert("mcpToolEvents", { ...event, actorUserId: users.reviewerId });
      await ctx.db.insert("apiWriteAuditEvents", {
        actorUserId: users.contributorId, actorKind: "user_delegated_oauth",
        action: "profile_media_submission_submitted", resourceType: "profile_media_submission",
        result: "accepted", routeClass: "authenticated_mcp_write",
        mcpToolName: "vrdex_profile_media_submit", targetProfileId: args.profileId,
        createdAt: Date.now(),
      });
      return await ctx.db.insert("mcpToolEvents", event);
    });
    assert.deepEqual(await t.query(internal.e2eMedia.inspectAudit, args), {
      auditRows: 1, toolRows: 1, deniedToolRows: 1, redacted: true,
    });
    await t.run((ctx) => ctx.db.patch(id, { requestId: "https://private.invalid/source?signature=secret" }));
    await assert.rejects(t.query(internal.e2eMedia.inspectAudit, args), /Audit redaction check failed/);
    const storageKey = await t.run(async (ctx) => (await ctx.db.query("profileAssetUploadIntents").first())!.storageKey);
    await t.run((ctx) => ctx.db.patch(id, { requestId: storageKey }));
    await assert.rejects(t.query(internal.e2eMedia.inspectAudit, args), /Audit redaction check failed/);
    await t.run((ctx) => ctx.db.patch(id, { requestId: "fixture-request" }));
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) await ctx.db.insert("mcpToolEvents", event);
    });
    await assert.rejects(t.query(internal.e2eMedia.inspectAudit, args), /Audit fixture bound exceeded/);
  });
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
  it("removes exact fixture review records and keeps other submissions' receipts", async () => {
    const { t, args, users, intent } = await seed();
    const other = await t.mutation(api.e2e.submitProfile, {
      secret, runId: "media-other-review", profileType: "person", displayName: "Other media test",
    });
    const records = await t.run(async (ctx) => {
      const submission = (await ctx.db.get(intent.submissionId))!;
      const { _id, _creationTime, ...fields } = submission;
      const otherSubmissionId = await ctx.db.insert("profileMediaSubmissions", {
        ...fields, profileId: other.profileId, uploadIntentId: undefined,
      });
      const receipt = {
        actorUserId: users.reviewerId, idempotencyKey: "review-fixture", inputHash: "hash",
        submissionId: intent.submissionId,
        receipt: { operationId: "review-fixture", operationState: "committed" as const },
        createdAt: Date.now(),
      };
      const reviewReceipt = await ctx.db.insert("mediaReviewReceipts", receipt);
      const unrelatedReceipt = await ctx.db.insert("mediaReviewReceipts", {
        ...receipt, idempotencyKey: "other-review", submissionId: otherSubmissionId,
      });
      const rebase = await ctx.db.insert("mediaReviewRebases", {
        submissionId: intent.submissionId, actorUserId: users.reviewerId,
        priorTargetUpdatedAt: 1, currentTargetUpdatedAt: 2,
        priorTargetSnapshot: "prior", currentTargetSnapshot: "current",
        currentPlacementSnapshot: "placement", priorReviewVersion: "v1",
        reviewRevision: 1, createdAt: Date.now(),
      });
      const evidence = await ctx.db.insert("mediaPublicationEvidence", {
        submissionId: intent.submissionId, actorUserId: users.reviewerId,
        candidateVersion: "v1", identityConfirmed: true, attributionConfirmed: true,
        publicationPermitted: true, noKnownRestrictions: true, createdAt: Date.now(),
      });
      const restriction = await ctx.db.insert("mediaPublicationRestrictions", {
        profileId: args.profileId, submissionId: intent.submissionId,
        actorUserId: users.reviewerId, kind: "rejection", createdAt: Date.now(),
      });
      const unrelatedRestriction = await ctx.db.insert("mediaPublicationRestrictions", {
        profileId: other.profileId, submissionId: otherSubmissionId,
        actorUserId: users.reviewerId, kind: "rejection", createdAt: Date.now(),
      });
      return { reviewReceipt, unrelatedReceipt, rebase, evidence, restriction, unrelatedRestriction };
    });
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    await t.mutation(internal.e2eMedia.finishCleanup, {
      ...args, deletedStorageKeys: prepared.storageKeys,
    });
    for (const id of [records.reviewReceipt, records.rebase, records.evidence, records.restriction])
      assert.equal(await t.run((ctx) => ctx.db.get(id)), null);
    assert.ok(await t.run((ctx) => ctx.db.get(records.unrelatedReceipt)));
    assert.ok(await t.run((ctx) => ctx.db.get(records.unrelatedRestriction)));
  });
  it("refuses review records written by an actor outside the fixture", async () => {
    const { t, args, intent } = await seed();
    const rebaseId = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", {
        clerkUserId: newClerkUserId(), email: "ordinary@example.test",
      });
      return ctx.db.insert("mediaReviewRebases", {
        submissionId: intent.submissionId, actorUserId,
        priorTargetUpdatedAt: 1, currentTargetUpdatedAt: 2,
        priorTargetSnapshot: "prior", currentTargetSnapshot: "current",
        currentPlacementSnapshot: "placement", priorReviewVersion: "v1",
        reviewRevision: 1, createdAt: Date.now(),
      });
    });
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Unscoped media fixture review row/);
    assert.ok(await t.run((ctx) => ctx.db.get(rebaseId)));
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "published");
  });
  it("refuses a foreign review receipt tied to the fixture submission", async () => {
    const { t, args, intent } = await seed();
    const receiptId = await t.run(async (ctx) => {
      const actorUserId = await ctx.db.insert("users", {
        clerkUserId: newClerkUserId(), email: "ordinary@example.test",
      });
      return ctx.db.insert("mediaReviewReceipts", {
        actorUserId, idempotencyKey: "foreign-review", inputHash: "hash",
        submissionId: intent.submissionId,
        receipt: { operationId: "foreign-review", operationState: "committed" },
        createdAt: Date.now(),
      });
    });
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Unscoped media fixture review row/);
    assert.ok(await t.run((ctx) => ctx.db.get(receiptId)));
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "published");
  });
  it("refuses a publication restriction for a foreign submission on the fixture profile", async () => {
    const { t, args, users, intent } = await seed();
    const other = await t.mutation(api.e2e.submitProfile, {
      secret, runId: "media-other-restriction", profileType: "person", displayName: "Other media test",
    });
    const restrictionId = await t.run(async (ctx) => {
      const submission = (await ctx.db.get(intent.submissionId))!;
      const { _id, _creationTime, ...fields } = submission;
      const foreignSubmissionId = await ctx.db.insert("profileMediaSubmissions", {
        ...fields, profileId: other.profileId, uploadIntentId: undefined,
      });
      return ctx.db.insert("mediaPublicationRestrictions", {
        profileId: args.profileId, submissionId: foreignSubmissionId,
        actorUserId: users.reviewerId, kind: "rejection", createdAt: Date.now(),
      });
    });
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Unscoped media fixture publication restriction/);
    assert.ok(await t.run((ctx) => ctx.db.get(restrictionId)));
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "published");
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

  it("removes a completed local fixture upload, its exact S3 keys, and every capacity charge", async () => {
    const { t, args, intent, users } = await seed();
    const quarantineStorageKey = "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000";
    const reservationId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, { issuer: "mcp_local", quarantineStorageKey,
        expiresAt: Date.now() - 120_000 });
      const reservation = (await ctx.db.query("contributionUploadReservations").first())!;
      await changeContributionCharge(ctx.db, reservation, 476 - reservation.chargedBytes, 0);
      await ctx.db.patch(reservation._id, {
        chargedBytes: 476, quarantineBytes: 476, publishedBytes: 200, state: "committed",
      });
      await ctx.db.insert("contributionCapacity", {
        scope: "published", bytes: 200, processing: 0, byteLimit: 1000, processingLimit: 5,
      });
      await ctx.db.insert("contributionCapacity", { scope: `actor:${users.reviewerId}`, bytes: 12, processing: 0 });
      return reservation._id;
    });
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.ok(prepared.storageKeys.includes(quarantineStorageKey));
    await t.mutation(internal.e2eMedia.finishCleanup, { ...args, deletedStorageKeys: prepared.storageKeys });
    assert.equal(await t.run((ctx) => ctx.db.get(reservationId)), null);
    assert.deepEqual(
      (await t.run((ctx) => ctx.db.query("contributionCapacity").collect()))
        .map((row) => [row.scope, row.bytes, row.processing, row.byteLimit, row.processingLimit]),
      [["published", 0, 0, 1000, 5], [`actor:${users.reviewerId}`, 12, 0, undefined, undefined]],
    );
  });

  it("freezes a direct upload but retains its signed expiry until deletion is safe", async () => {
    const { t, args, intent } = await seed();
    const expiresAt = Date.now() + 5 * 60_000;
    await t.run((ctx) => ctx.db.patch(intent.intentId, {
      issuer: "mcp_local", expiresAt,
      quarantineStorageKey: "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000",
    }));
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.equal(prepared.safeDeleteAfter, expiresAt + 60_000);
    assert.equal((await t.run((ctx) => ctx.db.get(intent.intentId)))?.expiresAt, expiresAt);
    assert.equal((await t.run((ctx) => ctx.db.get(intent.intentId)))?.state, "expired");
    await assert.rejects(t.mutation(internal.e2eMedia.finishCleanup, {
      ...args, deletedStorageKeys: prepared.storageKeys,
    }), /signed transfer may still be valid/);
    assert.ok(await t.run((ctx) => ctx.db.get(intent.intentId)));
    const retried = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.equal(retried.safeDeleteAfter, prepared.safeDeleteAfter);
    await t.run((ctx) => ctx.db.patch(intent.intentId, { expiresAt: Date.now() - 61_000 }));
    const safe = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    await t.mutation(internal.e2eMedia.finishCleanup, { ...args, deletedStorageKeys: safe.storageKeys });
    assert.equal(await t.run((ctx) => ctx.db.get(intent.intentId)), null);
  });

  it("recovers only a scoped pending direct upload after its signed transfer expires", async () => {
    const { t, args, intent, users } = await seed();
    const expiresAt = Date.now() + 5 * 60_000;
    const reservationId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, { issuer: "mcp_local", expiresAt,
        quarantineStorageKey: "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000" });
      const row = (await ctx.db.query("contributionUploadReservations").first())!;
      await changeContributionCharge(ctx.db, row, 0, 1);
      await ctx.db.patch(row._id, { state: "pending", processing: true });
      return row._id;
    });
    await t.run((ctx) => ctx.db.patch(reservationId, { processingToken: "active-worker" }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
    await t.run((ctx) => ctx.db.patch(reservationId, {
      processingToken: undefined, actorUserId: users.reviewerId,
    }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Non-fixture upload reservation/);
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "published");
    await t.run((ctx) => ctx.db.patch(reservationId, { actorUserId: users.contributorId }));
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.equal(prepared.safeDeleteAfter, expiresAt + 60_000);
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "draft_private");
    assert.equal((await t.run((ctx) => ctx.db.get(reservationId)))?.processing, true);
    await assert.rejects(t.mutation(internal.e2eMedia.finishCleanup, {
      ...args, deletedStorageKeys: prepared.storageKeys,
    }), /active storage work|signed transfer may still be valid/);
    await t.run((ctx) => ctx.db.patch(intent.intentId, { expiresAt: Date.now() - 61_000 }));
    const retry = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.equal((await t.run((ctx) => ctx.db.get(reservationId)))?.state, "failed");
    assert.equal((await t.run((ctx) => ctx.db.get(reservationId)))?.processing, false);
    await t.mutation(internal.e2eMedia.finishCleanup, { ...args, deletedStorageKeys: retry.storageKeys });
    assert.equal(await t.run((ctx) => ctx.db.get(reservationId)), null);
    assert.deepEqual(await t.run((ctx) => ctx.db.query("contributionCapacity").collect()), []);
  });

  it("accepts a legacy committed token only after the upload receipt and intent prove completion", async () => {
    const { t, args, intent } = await seed();
    const reservationId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, {
        issuer: "mcp_local", state: "uploaded", processingToken: undefined,
        quarantineStorageKey: "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000",
      });
      const row = (await ctx.db.query("contributionUploadReservations").first())!;
      await ctx.db.patch(row._id, {
        state: "committed", processing: false, processingToken: "old-worker",
        receipt: { operationId: String(intent.intentId), operationState: "committed", resourceId: String(intent.submissionId) },
      });
      return row._id;
    });
    await t.run((ctx) => ctx.db.patch(reservationId, { receipt: undefined }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
    await t.run((ctx) => ctx.db.patch(reservationId, {
      receipt: { operationId: String(intent.intentId), operationState: "committed", resourceId: String(intent.submissionId) },
      processing: true,
    }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
    await t.run((ctx) => ctx.db.patch(reservationId, { processing: false }));
    await t.run((ctx) => ctx.db.patch(intent.intentId, { processingToken: "active-worker" }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
    await t.run((ctx) => ctx.db.patch(intent.intentId, { processingToken: undefined }));
    const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
    assert.equal(prepared.profileMissing, false);
    assert.equal((await t.run((ctx) => ctx.db.get(args.profileId)))?.publicationState, "draft_private");
  });

  it("refuses unscoped local keys, non-fixture reservations, and active upload leases", async () => {
    const { t, args, intent, users } = await seed();
    const reservationId = await t.run(async (ctx) => {
      await ctx.db.patch(intent.intentId, {
        issuer: "mcp_local", quarantineStorageKey: "profile-assets/quarantine/local/not-a-uuid",
      });
      return (await ctx.db.query("contributionUploadReservations").first())!._id;
    });
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Unscoped fixture storage key/);
    await t.run((ctx) => ctx.db.patch(intent.intentId, {
      quarantineStorageKey: "profile-assets/quarantine/local/123e4567-e89b-42d3-a456-426614174000",
    }));
    await t.run((ctx) => ctx.db.patch(reservationId, { actorUserId: users.reviewerId }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /Non-fixture upload reservation/);
    await t.run((ctx) => ctx.db.patch(reservationId, { actorUserId: users.contributorId, cleanupToken: "worker" }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
    await t.run((ctx) => ctx.db.patch(reservationId, { cleanupToken: undefined, processing: true }));
    await assert.rejects(t.mutation(internal.e2eMedia.prepareCleanup, args), /active storage work/);
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

it("grants only run-linked publisher and assigned reviewer actors and cleans all fixture assignment records", async () => {
  const { t, args, users, intent } = await seed();
  const result = await t.mutation(internal.e2eMedia.grantPublicationActors, args);
  assert.equal(result.granted, true);
  assert.deepEqual(await t.mutation(internal.e2eMedia.grantPublicationActors, args), result);
  const records = await t.run(async ctx => ({ grants: await ctx.db.query("accountFeatureGrants").collect(), attempts: await ctx.db.query("contributionItemAttempts").collect(), assignments: await ctx.db.query("contributionBatchReviewers").collect() }));
  assert.deepEqual(records.grants.map(row => [row.userId, row.feature]), [[users.contributorId, "trusted_publisher"], [users.reviewerId, "media_reviewer"]]);
  assert.equal(records.attempts.length, 1);
  assert.equal(records.attempts[0].submissionId, intent.submissionId);
  assert.equal(records.assignments[0].reviewerUserId, users.reviewerId);
  await t.run(ctx => ctx.db.patch(intent.submissionId, { status: "submitted" }));
  const reviewer = (await t.run(ctx => ctx.db.get(users.reviewerId)))!;
  const reviewerActor = t.withIdentity({ subject: reviewer.clerkUserId!, issuer: "test", tokenIdentifier: `test|${reviewer.clerkUserId}`, email: reviewer.email!, emailVerified: true });
  assert.equal((await reviewerActor.query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId }))?.submissionId, intent.submissionId);
  await assert.rejects(t.withIdentity(users.identity).query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId }), /MEDIA_REVIEW_ACCESS_REQUIRED/);
  const replacement = await t.run(async ctx => {
    const original = (await ctx.db.get(intent.submissionId))!;
    const { _id, _creationTime, uploadIntentId, ...fields } = original;
    return ctx.db.insert("profileMediaSubmissions", { ...fields, requestKind: "identity_placement" });
  });
  await t.mutation(internal.e2eMedia.grantPublicationActors, args);
  const noUpload = await t.run(ctx => ctx.db.query("contributionItemAttempts").withIndex("by_submissionId", q => q.eq("submissionId", replacement)).unique());
  assert.equal(noUpload?.intentId, undefined);
  const prepared = await t.mutation(internal.e2eMedia.prepareCleanup, args);
  await t.mutation(internal.e2eMedia.finishCleanup, { ...args, deletedStorageKeys: prepared.storageKeys });
  assert.deepEqual(await t.run(async ctx => [await ctx.db.query("accountFeatureGrants").collect(), await ctx.db.query("contributionBatches").collect(), await ctx.db.query("contributionItemRevisions").collect(), await ctx.db.query("contributionItemAttempts").collect(), await ctx.db.query("contributionBatchReviewers").collect()]), [[], [], [], [], []]);
});

it("rejects publication fixture actor grants on production and foreign account grants", async () => {
  const { t, args, users } = await seed();
  await t.run(ctx => ctx.db.insert("accountFeatureGrants", { userId: users.contributorId, feature: "trusted_publisher", state: "active", grantedAt: Date.now(), updatedAt: Date.now(), grantedBy: { issuer: "test", subject: "foreign", tokenIdentifier: "foreign" } }));
  await assert.rejects(t.mutation(internal.e2eMedia.grantPublicationActors, args), /Unscoped fixture grant/);
  process.env.CONVEX_CLOUD_URL = "https://production.convex.cloud";
  await assert.rejects(t.mutation(internal.e2eMedia.grantPublicationActors, args), /Staging media fixture is unavailable/);
  enable();
});
