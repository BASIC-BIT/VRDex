import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { modules, schema, seed, createAndUpload } from "./_mediaReviewFixture";
const migrationModules = { ...modules, "../../convex/mediaKitPublicationMigration.ts": () => import("../../convex/mediaKitPublicationMigration") };
const convert = makeFunctionReference<"mutation">("mediaKitPublicationMigration:convertBatch");
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
it("previews and converts a stored legacy candidate once without changing its bytes or evidence", async () => {
  const t = convexTest({ schema, modules: migrationModules });
  const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  await t.run(ctx => ctx.db.patch(intent.submissionId, { requestKind: undefined, requestedPlacement: "profile_image" }));
  const before = await t.run(ctx => ctx.db.get(intent.submissionId));
  const upload = await t.run(ctx => ctx.db.get(intent.intentId));
  const preview = await t.mutation(convert, { dryRun: true, cursor: null, limit: 40 });
  assert.equal(preview.changed, 1);
  assert.deepEqual(await t.run(ctx => ctx.db.get(intent.submissionId)), before);
  assert.equal((await t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).changed, 1);
  const after = await t.run(ctx => ctx.db.get(intent.submissionId));
  assert.equal(after?.requestKind, "kit_asset");
  assert.equal(after?.requestedPlacement, "gallery");
  assert.equal(after?.reviewRevision, (before?.reviewRevision ?? 0) + 1);
  assert.equal(after?.contentSha256, before?.contentSha256);
  assert.equal(after?.sourceUrl, before?.sourceUrl);
  const nextUpload = await t.run(ctx => ctx.db.get(intent.intentId));
  assert.equal(nextUpload?.storageKey, upload?.storageKey);
  assert.equal(nextUpload?.contentSha256, upload?.contentSha256);
  assert.equal((await t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).changed, 0);
});
it("rejects limits outside the bounded operator window", async () => {
  const t = convexTest({ schema, modules: migrationModules });
  for (const limit of [0, 41, 1.5]) await assert.rejects(t.mutation(convert, { dryRun: true, cursor: null, limit }));
});

const correct = makeFunctionReference<"mutation">("mediaKitPublicationMigration:correctPrimaryToKit");
async function legacyFixture() {
  const t = convexTest({ schema, modules: migrationModules });
  const s = await seed(t);
  const { intent } = await createAndUpload(t, s, "legacy-digest");
  const assetId = await t.run(async ctx => {
    const upload = (await ctx.db.get(intent.intentId))!;
    const id = await ctx.db.insert("profileAssets", { profileId: s.profileId, storageKey: upload.storageKey,
      mimeType: "image/webp", byteSize: 512, contentSha256: "legacy-digest", visibility: "public", source: "community_submitted",
      uploadedBy: upload.requestedBy, uploadedAt: 10, updatedAt: 11, state: "active", credit: "Artist", label: "Image" });
    await ctx.db.patch(intent.submissionId, { status: "approved", requestKind: undefined, approvedAssetId: id, sourceUrl: undefined, sourceDescription: "Original photograph", reviewedAt: 11 });
    return id;
  });
  const placementId = await t.run(ctx => ctx.db.insert("profileAssetPlacements", { profileId: s.profileId, assetId, placement: "profile_image", position: 0, state: "active", updatedAt: 12 }));
  return { t, s, intent, assetId, placementId, args: { dryRun: true, submissionId: intent.submissionId, expectedAssetId: assetId, expectedPlacementId: placementId, expectedPlacementUpdatedAt: 12, expectedSelectionOperationId: null } };
}
it("backfills unique public legacy provenance and gallery while preserving primary and immutable records", async () => {
  const f = await legacyFixture();
  const before = await f.t.run(ctx => ctx.db.get(f.intent.submissionId));
  assert.equal((await f.t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).changed, 1);
  const asset = await f.t.run(ctx => ctx.db.get(f.assetId));
  assert.equal(asset?.sourceSubmissionId, f.intent.submissionId);
  assert.equal(asset?.sourceDescription, "Original photograph");
  assert.equal(asset?.contentSha256, "legacy-digest");
  assert.deepEqual(await f.t.run(ctx => ctx.db.get(f.intent.submissionId)), before);
  assert.equal((await f.t.run(ctx => ctx.db.get(f.placementId)))?.state, "active");
  assert.equal((await f.t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).changed, 0);
});
it("refuses ambiguous asset provenance rather than choosing a submission", async () => {
  const f = await legacyFixture();
  await f.t.run(async ctx => { const { _id, _creationTime, ...fields } = (await ctx.db.get(f.intent.submissionId))!; await ctx.db.insert("profileMediaSubmissions", fields); });
  assert.equal((await f.t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).conflicts, 2);
  assert.equal((await f.t.run(ctx => ctx.db.get(f.assetId)))?.sourceSubmissionId, undefined);
});
it("previews exact legacy primary correction then preserves public active gallery bytes", async () => {
  const f = await legacyFixture();
  assert.equal((await f.t.mutation(correct, f.args)).code, "would_correct");
  assert.equal((await f.t.run(ctx => ctx.db.get(f.placementId)))?.state, "active");
  assert.equal((await f.t.mutation(correct, { ...f.args, dryRun: false })).code, "corrected");
  assert.equal((await f.t.run(ctx => ctx.db.get(f.placementId)))?.state, "deleted");
  assert.equal((await f.t.run(ctx => ctx.db.get(f.assetId)))?.state, "active");
  const rows = await f.t.run(ctx => ctx.db.query("profileAssetPlacements").collect());
  assert.deepEqual(rows.filter(p => p.state === "active").map(p => p.placement), ["gallery"]);
  assert.equal((await f.t.mutation(correct, { ...f.args, dryRun: false })).changed, false);
});
it("refuses changed, reselected, claimed, private, held and foreign exact candidates", async () => {
  for (const change of ["changed", "reselected", "claimed", "private", "held", "foreign"] as const) {
    const f = await legacyFixture();
    const other = change === "foreign" ? await seed(f.t, "community") : undefined;
    await f.t.run(async ctx => {
      if (change === "changed") await ctx.db.patch(f.placementId, { updatedAt: 13 });
      if (change === "reselected") await ctx.db.patch(f.placementId, { selectionActorUserId: f.s.moderatorUserId, selectionOperationId: "owner-new-selection" });
      if (change === "claimed") await ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" });
      if (change === "private") await ctx.db.patch(f.assetId, { visibility: "private" });
      if (change === "held") await ctx.db.patch(f.intent.submissionId, { legalHoldAt: 14 });
      if (change === "foreign") await ctx.db.patch(f.placementId, { profileId: other!.profileId });
    });
    assert.equal((await f.t.mutation(correct, { ...f.args, dryRun: false })).changed, false, change);
    assert.equal((await f.t.run(ctx => ctx.db.get(f.placementId)))?.state, "active");
  }
});

it("preserves intentional provenance clears and skips private or corrected legacy initialization", async () => {
  for (const condition of ["current", "corrected", "audit", "owner_audit", "private"] as const) {
    const f = await legacyFixture();
    await f.t.run(async ctx => {
      if (condition === "current") await ctx.db.patch(f.assetId, { sourceUrl: "https://current.example/source" });
      if (condition === "corrected") await ctx.db.patch(f.assetId, { updatedAt: 20 });
      if (condition === "private") await ctx.db.patch(f.assetId, { visibility: "private" });
      if (condition === "audit" || condition === "owner_audit") await ctx.db.insert("profileAuditEvents", { profileId: f.s.profileId, action: condition === "owner_audit" ? "profile_asset_metadata_updated" : "profile_media_contribution_metadata_updated", actor: { subject: "operator", issuer: "test", tokenIdentifier: "operator" }, sourceType: "community", createdAt: 20 });
    });
    await f.t.mutation(convert, { dryRun: false, cursor: null, limit: 40 });
    assert.equal((await f.t.run(ctx => ctx.db.get(f.assetId)))?.sourceDescription, undefined, condition);
  }
});


it("finishes a pre-conversion admitted upload in gallery intent without replacing bytes or reservation", async () => {
  const t = convexTest({ schema, modules: migrationModules });
  const s = await seed(t);
  const { api, internal } = await import("../../convex/_generated/api");
  const intent = await t.withIdentity(s.contributorIdentity).mutation(api.profileMediaSubmissions.createUploadIntent, {
    profileId: s.profileId, requestedPlacement: "profile_image", originalFileName: "before.webp", mimeType: "image/webp", byteSize: 512,
    credit: "Artist", sourceUrl: "https://artist.example/source", expectedProfileUpdatedAt: (await t.run(ctx => ctx.db.get(s.profileId)))!.updatedAt,
  });
  await t.run(async ctx => { await ctx.db.patch(intent.submissionId, { requestKind: undefined, requestedPlacement: "profile_image" }); await ctx.db.patch(intent.intentId, { placements: ["profile_image"] }); });
  const token = "processing-before-conversion";
  await t.mutation(internal.profileAssets.claimUploadIntentForStorage, { intentId: intent.intentId, uploadToken: intent.uploadToken, processingToken: token });
  await t.mutation(internal.profileAssets.markUploadIntentUploaded, { intentId: intent.intentId, uploadToken: intent.uploadToken, processingToken: token, mimeType: "image/webp", byteSize: 512, contentSha256: "admitted-digest" });
  assert.deepEqual((await t.run(ctx => ctx.db.get(intent.intentId)))?.placements, ["gallery"]);
  assert.equal((await t.run(ctx => ctx.db.get(intent.submissionId)))?.status, "submitted");
  assert.equal((await t.run(ctx => ctx.db.query("contributionUploadReservations").collect())).length, 1);
});

it("refuses a duplicate active primary instead of correcting ambiguous placement", async () => {
  const f = await legacyFixture();
  await f.t.run(ctx => ctx.db.insert("profileAssetPlacements", { profileId: f.s.profileId, assetId: f.assetId, placement: "profile_image", position: 1, state: "active", updatedAt: 12 }));
  assert.equal((await f.t.mutation(correct, { ...f.args, dryRun: false })).changed, false);
});
it("invalidates old review then publishes refreshed converted proposal without another upload or charge", async () => {
  const t = convexTest({ schema, modules: migrationModules });
  const s = await seed(t);
  const { api } = await import("../../convex/_generated/api");
  const { intent } = await createAndUpload(t, s, "review-converted");
  await t.run(ctx => ctx.db.patch(intent.submissionId, { requestKind: undefined, requestedPlacement: "profile_image" }));
  const actor = t.withIdentity(s.moderatorIdentity);
  const before = await actor.query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
  const stored = await t.run(ctx => ctx.db.get(intent.intentId));
  await t.mutation(convert, { dryRun: false, cursor: null, limit: 40 });
  const stale = await actor.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: intent.submissionId, expectedReviewVersion: before!.reviewVersion, decision: "approve", privateReason: "Synthetic stale", idempotencyKey: "stale-converted" });
  assert.equal(stale.code, "review_changed");
  const after = await actor.query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
  assert.notEqual(after?.reviewVersion, before?.reviewVersion);
  const receipt = await actor.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: intent.submissionId, expectedReviewVersion: after!.reviewVersion, decision: "approve", privateReason: "Synthetic refreshed", idempotencyKey: "fresh-converted" });
  assert.equal(receipt.operationState, "committed");
  const asset = await t.run(ctx => ctx.db.query("profileAssets").first());
  assert.equal(asset?.storageKey, stored?.storageKey);
  assert.equal(asset?.contentSha256, stored?.contentSha256);
  assert.deepEqual((await t.run(ctx => ctx.db.query("profileAssetPlacements").collect())).map(row => row.placement), ["gallery"]);
  const charge = await t.run(ctx => ctx.db.query("contributionUploadReservations").first());
  await t.mutation(convert, { dryRun: false, cursor: null, limit: 40 });
  assert.deepEqual(await t.run(ctx => ctx.db.query("contributionUploadReservations").first()), charge);
  assert.equal((await t.run(ctx => ctx.db.query("profileAssets").collect())).length, 1);
});
it("preserves restricted legacy primary and refuses exact correction", async () => {
  const f = await legacyFixture();
  await f.t.run(ctx => ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, kind: "identity", submissionId: f.intent.submissionId, createdAt: Date.now(), actorUserId: f.s.moderatorUserId }));
  assert.equal((await f.t.mutation(correct, { ...f.args, dryRun: false })).changed, false);
});

it("does not add gallery references for a restricted legacy contribution", async () => {
  const f = await legacyFixture();
  await f.t.run(ctx => ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, kind: "dispute", submissionId: f.intent.submissionId, createdAt: Date.now(), actorUserId: f.s.moderatorUserId }));
  assert.equal((await f.t.mutation(convert, { dryRun: false, cursor: null, limit: 40 })).changed, 0);
});
