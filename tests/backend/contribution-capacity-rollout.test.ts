import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import {
  schema,
  modules as base,
  seed,
  createAndUpload,
} from "./_mediaReviewFixture";
const modules = {
  ...base,
  "../../convex/contributionOperations.ts": () =>
    import("../../convex/contributionOperations"),
  "../../convex/contributionCleanup.ts": () =>
    import("../../convex/contributionCleanup"),
  "../../convex/contributionCapacity.ts": () =>
    import("../../convex/contributionCapacity"),
  "../../convex/contributionBatches.ts": () =>
    import("../../convex/contributionBatches"),
};
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

it("reserves derivatives for pending legacy uploads and settles all retained variants", async () => {
  const t = convexTest({ schema, modules }), s = await seed(t);
  const intent = await t.withIdentity(s.contributorIdentity).mutation(
    api.profileMediaSubmissions.createUploadIntent, {
      profileId: s.profileId, requestedPlacement: "profile_image",
      originalFileName: "source.png", mimeType: "image/png", byteSize: 512,
      sourceUrl: "https://example.test/source", credit: "Artist",
      expectedProfileUpdatedAt: (await t.run(ctx => ctx.db.get(s.profileId)))!.updatedAt,
    },
  );
  await t.run(async ctx => {
    for (const row of await ctx.db.query("contributionUploadReservations").collect()) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("contributionCapacity").collect()) await ctx.db.delete(row._id);
  });
  await t.mutation(internal.contributionOperations.backfillSubmissions, { cursor: null });
  const reservation = (await t.run(ctx => ctx.db.query("contributionUploadReservations").unique()))!;
  assert.equal(reservation.chargedBytes, 2 * 512 + 2 * 12 * 1024 * 1024);
  await t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
    intentId: intent.intentId, uploadToken: intent.uploadToken, processingToken: "legacy",
  });
  await t.mutation(internal.profileAssets.markUploadIntentUploaded, {
    intentId: intent.intentId, uploadToken: intent.uploadToken, processingToken: "legacy",
    mimeType: "image/webp", byteSize: 200, contentSha256: "display", width: 10, height: 10,
    sourceMimeType: "image/png", sourceByteSize: 512, sourceContentSha256: "source",
    downloadMimeType: "image/png", downloadByteSize: 400, downloadContentSha256: "download",
  });
  const settled = (await t.run(ctx => ctx.db.get(reservation._id)))!;
  assert.equal(settled.chargedBytes, 1112);
  assert.equal(settled.processing, false);
});

it("backfills consumed approved legacy media as committed and never leases published keys", async () => {
  const t = convexTest({ schema, modules }),
    s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  // Reproduce a submission admitted before the ledger writer existed.
  await t.run(async (ctx) => {
    for (const row of await ctx.db
      .query("contributionUploadReservations")
      .collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("contributionCapacity").collect())
      await ctx.db.delete(row._id);
  });
  const reviewer = t.withIdentity(s.moderatorIdentity);
  const detail = await reviewer.query(
    api.profileMediaSubmissions.reviewDetail,
    { submissionId: intent.submissionId },
  );
  assert.ok(detail);
  assert.equal(
    (
      await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, {
        submissionId: intent.submissionId,
        expectedReviewVersion: detail.reviewVersion,
        decision: "approve",
        privateReason: "Synthetic legacy publication",
        idempotencyKey: "approve",
      })
    ).operationState,
    "committed",
  );
  await t.run((ctx) => ctx.db.patch(intent.intentId, { expiresAt: 1 }));
  const stored = (await t.run((ctx) => ctx.db.get(intent.intentId)))!;
  assert.equal(stored.state, "consumed");
  const migration = await t.mutation(
    internal.contributionOperations.backfillSubmissions,
    { cursor: null },
  );
  assert.equal(migration.updated, 1);
  const reservation = (await t.run((ctx) =>
    ctx.db.query("contributionUploadReservations").unique(),
  ))!;
  assert.equal(reservation.state, "committed");
  assert.equal(reservation.receipt?.operationState, "committed");
  assert.equal(reservation.chargedBytes, 0);
  assert.equal(reservation.publishedBytes, 512);
  assert.equal(
    (
      await t.run((ctx) =>
        ctx.db
          .query("contributionCapacity")
          .withIndex("by_scope", (q) => q.eq("scope", "published"))
          .unique(),
      )
    )?.bytes,
    512,
  );
  for (const corrupted of [false, true]) {
    if (corrupted)
      await t.run((ctx) =>
        ctx.db.patch(reservation._id, {
          state: "failed",
          cleanupAfter: 1,
          cleanupLeaseUntil: 0,
          cleanupToken: undefined,
        }),
      );
    const cleanup = await t.mutation(internal.contributionCleanup.claim, {});
    assert.ok(
      cleanup.uploads.some((row) => row.reservationId === reservation._id),
      "published row must be evaluated rather than skipped by a live lease",
    );
    const keys = [
      ...cleanup.uploads.flatMap((row) => row.keys),
      ...cleanup.proposals.flatMap((row) => row.storageKeys),
    ];
    for (const key of [
      stored.storageKey,
      stored.sourceStorageKey,
      stored.downloadStorageKey,
    ].filter(Boolean))
      assert.equal(keys.includes(key!), false);
    await t.mutation(internal.contributionCleanup.confirm, {
      uploads: cleanup.uploads.map(({ reservationId, token }) => ({
        reservationId,
        token,
      })),
      proposals: [],
    });
    assert.equal(
      (await t.run((ctx) => ctx.db.get(reservation._id)))?.publishedBytes,
      512,
    );
    assert.equal(
      (await t.run((ctx) => ctx.db.get(stored._id)))?.state,
      "consumed",
    );
    assert.equal(
      (
        await t.run((ctx) =>
          ctx.db
            .query("contributionCapacity")
            .withIndex("by_scope", (q) => q.eq("scope", "published"))
            .unique(),
        )
      )?.bytes,
      512,
    );
  }
});
