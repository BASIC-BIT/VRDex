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
        ctx.db.patch(reservation._id, { state: "failed", cleanupAfter: 1 }),
      );
    const cleanup = await t.mutation(internal.contributionCleanup.claim, {});
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
  }
});
