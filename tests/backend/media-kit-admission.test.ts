import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import { modules, schema, seed, createAndUpload, NOW } from "./_mediaReviewFixture";
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
async function fixture(assigned = false) {
  const t = convexTest({ schema, modules }); const s = await seed(t);
  const { intent } = await createAndUpload(t, s);
  await t.run(ctx => ctx.db.insert("accountFeatureGrants", { userId: s.contributorUserId,
    feature: "trusted_publisher", state: "active", grantedBy: { issuer: "test", subject: "operator", tokenIdentifier: "test:operator" },
    grantedAt: Date.now(), updatedAt: Date.now() }));
  if (assigned) await t.run(async ctx => {
    const grant = (await ctx.db.query("accountFeatureGrants").collect()).find(g => g.userId === s.moderatorUserId)!;
    await ctx.db.patch(grant._id, { feature: "media_reviewer" });
    const batchId = await ctx.db.insert("contributionBatches", { actorUserId: s.contributorUserId, idempotencyKey: "collection", label: "Collection", archived: false, rowCount: 1, createdAt: NOW });
    const revisionId = await ctx.db.insert("contributionItemRevisions", { actorUserId: s.contributorUserId, batchId, itemKey: "one", revision: 1, payload: JSON.stringify({kind: "media"}), bytes: 10, createdAt: NOW });
    await ctx.db.insert("contributionItemAttempts", { actorUserId: s.contributorUserId, revisionId, oauthClientId: "fixture", submissionId: intent.submissionId, intentId: intent.intentId, receipt: { operationId: "one", operationState: "committed" }, createdAt: NOW });
    await ctx.db.insert("contributionBatchReviewers", { batchId, reviewerUserId: s.moderatorUserId, active: true, expiresAt: Date.now() + 600000 });
  });
  return { t, s, intent };
}
for (const transport of ["browser", "mcp"] as const) for (const operation of ["publisher", "reviewer", "legacy"] as const)
for (const mode of ["hidden", "disabled", "changed"] as const) {
  if (transport === "mcp" && operation === "legacy") continue;
  it(`${transport} ${operation} refuses ${mode} kit without consuming or charging`, async () => {
    const { t, s, intent } = await fixture(operation !== "publisher");
    const publisher = operation === "publisher";
    const actor = t.withIdentity(publisher ? s.contributorIdentity : s.moderatorIdentity);
    const attestation = { actorUserId: publisher ? s.contributorUserId : s.moderatorUserId,
      emailVerified: true, emailVerificationAttestedAt: Date.now(), submissionId: intent.submissionId };
    const inspect = () => transport === "browser" ? actor.query(publisher ? api.profileMediaSubmissions.publisherDetail : api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId })
      : t.query(publisher ? internal.profileMediaSubmissions.publisherDetailForMcpActor : internal.profileMediaSubmissions.reviewDetailForMcpActor, attestation);
    const initial = await inspect(); assert.ok(initial);
    const before = await t.run(async ctx => ({ submission: await ctx.db.get(intent.submissionId), upload: await ctx.db.get(intent.intentId), reservations: await ctx.db.query("contributionUploadReservations").collect(), capacity: await ctx.db.query("contributionCapacity").collect() }));
    if (mode === "disabled") process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    else await t.run(ctx => ctx.db.patch(s.profileId, { fieldVisibility: { mediaKit: "private" } }));
    try {
      assert.equal((await t.withIdentity(s.contributorIdentity).query(api.profileMediaSubmissions.listMine, {}))[0]?.publisherTargetAvailable, false);
      assert.equal((await t.withIdentity(s.contributorIdentity).query(api.profileMediaSubmissions.getMine, { submissionId: intent.submissionId }))?.publisherTargetAvailable, false);
      const detail = mode === "changed" ? initial : await inspect(); assert.ok(detail);
      const command = { submissionId: intent.submissionId, expectedReviewVersion: detail.reviewVersion, idempotencyKey: crypto.randomUUID() };
      if (operation === "legacy") {
        await assert.rejects(actor.mutation(api.profileMediaSubmissions.decide, { submissionId: intent.submissionId, decision: "approve", expectedProfileUpdatedAt: NOW, privateReason: "Review" }), /Media contribution unavailable/);
      } else {
        const execute = () => transport === "browser" ? publisher ? actor.mutation(api.profileMediaSubmissions.publish, command) : actor.mutation(api.profileMediaSubmissions.decideWithReceipt, { ...command, decision: "approve", privateReason: "Review" })
          : publisher ? t.mutation(internal.profileMediaSubmissions.publishForMcpActor, { ...attestation, ...command }) : t.mutation(internal.profileMediaSubmissions.decideForMcpActor, { ...attestation, ...command, decision: "approve", privateReason: "Review" });
        const receipt = await execute(); assert.equal(receipt.operationState, "refused"); assert.equal(receipt.code, "target_unavailable");
        process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";
        await t.run(ctx => ctx.db.patch(s.profileId, { fieldVisibility: undefined }));
        assert.deepEqual(await execute(), receipt);
      }
      assert.deepEqual(await t.run(async ctx => ({ submission: await ctx.db.get(intent.submissionId), upload: await ctx.db.get(intent.intentId), reservations: await ctx.db.query("contributionUploadReservations").collect(), capacity: await ctx.db.query("contributionCapacity").collect() })), before);
      assert.equal((await t.run(ctx => ctx.db.query("profileAssets").collect())).length, 0);
    } finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
  });
}
for (const mode of ["private", "field-hidden"] as const) for (const identity of [false, true]) {
  it(`redacts ${mode} ${identity ? "identity" : "additive"} sibling in browser and MCP, preserves private admin review`, async () => {
    const { t, s, intent } = await fixture();
    await t.run(async ctx => {
      if (identity) await ctx.db.patch(intent.submissionId, { requestKind: "identity_placement", requestedPlacement: "profile_image" });
      if (mode === "field-hidden") await ctx.db.patch(s.profileId, { fieldVisibility: identity ? { avatarImageUrl: "private" } : { mediaKit: "private" } });
      const assetId = await ctx.db.insert("profileAssets", { profileId: s.profileId, storageKey: "private", mimeType: "image/png", byteSize: 100,
        visibility: mode === "private" ? "private" : "public", source: "owner_authored", uploadedBy: { issuer: "test", subject: "owner", tokenIdentifier: "test:owner" },
        uploadedAt: NOW, updatedAt: NOW, state: "active", credit: "Private credit", sourceUrl: "https://private.example/source" });
      await ctx.db.insert("profileAssetPlacements", { profileId: s.profileId, assetId, placement: identity ? "profile_image" : "gallery", position: 0, state: "active", updatedAt: NOW });
    });
    const browser = await t.withIdentity(s.contributorIdentity).query(api.profileMediaSubmissions.publisherDetail, { submissionId: intent.submissionId });
    const mcp = await t.query(internal.profileMediaSubmissions.publisherDetailForMcpActor, { submissionId: intent.submissionId, actorUserId: s.contributorUserId, emailVerified: true, emailVerificationAttestedAt: Date.now() });
    assert.equal(browser?.currentPlacement, null); assert.equal(mcp?.currentPlacement, null);
    const admin = await t.withIdentity(s.moderatorIdentity).query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
    const adminMcp = await t.query(internal.profileMediaSubmissions.reviewDetailForMcpActor, { submissionId: intent.submissionId, actorUserId: s.moderatorUserId, emailVerified: true, emailVerificationAttestedAt: Date.now() });
    assert.equal(admin?.currentPlacement?.credit, identity ? "Private credit" : undefined);
    assert.deepEqual(adminMcp?.currentPlacement, admin?.currentPlacement);
    await t.run(async ctx => {
      await ctx.db.patch(s.profileId, { claimState: "claimed_verified" });
      await ctx.db.insert("profileOwners", { profileId: s.profileId, userId: s.moderatorUserId,
        roleKey: "owner", state: "active", grantedAt: NOW, updatedAt: NOW });
      const grant = (await ctx.db.query("accountFeatureGrants").collect()).find(g => g.userId === s.moderatorUserId)!;
      await ctx.db.patch(grant._id, { state: "revoked" });
    });
    const owner = await t.withIdentity(s.moderatorIdentity).query(api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
    const ownerMcp = await t.query(internal.profileMediaSubmissions.reviewDetailForMcpActor, { submissionId: intent.submissionId, actorUserId: s.moderatorUserId, emailVerified: true, emailVerificationAttestedAt: Date.now() });
    assert.deepEqual(owner?.currentPlacement, admin?.currentPlacement);
    assert.deepEqual(ownerMcp?.currentPlacement, admin?.currentPlacement);
  });
}

it("replays exact successful receipts after kit privacy or gate changes", async () => {
  for (const publisher of [false, true]) {
    const { t, s, intent } = await fixture(!publisher);
    const actor = t.withIdentity(publisher ? s.contributorIdentity : s.moderatorIdentity);
    const detail = await actor.query(publisher ? api.profileMediaSubmissions.publisherDetail : api.profileMediaSubmissions.reviewDetail, { submissionId: intent.submissionId });
    assert.ok(detail);
    const command = { submissionId: intent.submissionId, expectedReviewVersion: detail.reviewVersion, idempotencyKey: "historical" };
    const execute = () => publisher ? actor.mutation(api.profileMediaSubmissions.publish, command)
      : actor.mutation(api.profileMediaSubmissions.decideWithReceipt, { ...command, decision: "approve", privateReason: "Review" });
    const receipt = await execute(); assert.equal(receipt.operationState, "committed");
    await t.run(ctx => ctx.db.patch(s.profileId, { fieldVisibility: { mediaKit: "private" } }));
    process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    try { assert.deepEqual(await execute(), receipt); }
    finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
  }
});
