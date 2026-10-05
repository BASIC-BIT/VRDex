import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import { modules, schema, seed, createAndUpload } from "./_mediaReviewFixture";
import { getProfileMediaVersion, getPublicProfileMediaKit, selectProfileAssetIdentity } from "../../convex/_profileAssets";

process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

it("corrects own approved kit metadata without publisher authority and keeps evidence immutable", async () => {
  const f = await fixture();
  await f.t.run(ctx => ctx.db.patch(f.grant, { state: "revoked" }));
  const before = await f.t.run(ctx => ctx.db.get(f.intent.submissionId));
  const d = await f.detail();
  const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion,
    idempotencyKey: "correct", action: "update_metadata" as const,
    metadata: { label: " Updated image ", altText: null, credit: " New credit ", sourceUrl: null, sourceDescription: "Local photograph" } };
  const first = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, args);
  assert.equal(first.operationState, "committed");
  assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.manageContribution, args), first);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { ...args, metadata: { credit: "different" } })).code, "idempotency_conflict");
  const next = await f.detail();
  assert.notEqual(next.contributionVersion, d.contributionVersion);
  assert.equal(next.metadata.label, "Updated image");
  assert.equal(next.metadata.credit, "New credit");
  assert.equal(next.metadata.altText, undefined);
  assert.equal(next.metadata.sourceUrl, undefined);
  assert.equal(next.metadata.sourceDescription, "Local photograph");
  assert.deepEqual(await f.t.run(ctx => ctx.db.get(f.intent.submissionId)), before);
  const audits = await f.t.run(ctx => ctx.db.query("profileAuditEvents").collect());
  const correction = audits.filter(row => row.action === "profile_media_contribution_metadata_updated");
  assert.equal(correction.length, 1);
  const audit = JSON.parse(correction[0].note!);
  assert.equal(audit.before.credit, d.metadata.credit);
  assert.equal(audit.after.credit, "New credit");
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { ...args, idempotencyKey: "stale" })).code, "contribution_changed");
});

it("removes own kit item once, retains bytes/accounting/history and refuses key reuse for another item", async () => {
  const f = await fixture();
  const d = await f.detail();
  const charge = await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first());
  const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "remove", action: "remove" as const };
  const first = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, args);
  assert.equal(first.operationState, "committed");
  assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.manageContribution, args), first);
  const removed = await f.t.run(ctx => ctx.db.get(d.assetId));
  assert.equal(removed?.state, "deleted");
  assert.ok(removed?.deletedAt);
  assert.equal(removed?.retiredAt, undefined);
  assert.deepEqual(await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first()), charge);
  const kit = await f.t.run(async ctx => getPublicProfileMediaKit(ctx.db, (await ctx.db.get(f.s.profileId))!));
  assert.equal(kit.galleryAssets.length, 0);
  assert.equal((await f.actor.query(api.profileMediaSubmissions.getMine, { submissionId: f.intent.submissionId }))?.status, "approved");
  const second = await seed(f.t);
  const otherId = await f.t.run(async ctx => {
    const original = (await ctx.db.get(f.intent.submissionId))!;
    const asset = (await ctx.db.get(d.assetId))!;
    const { _id, _creationTime, ...fields } = original;
    const id = await ctx.db.insert("profileMediaSubmissions", { ...fields, profileId: second.profileId });
    const { _id: assetId, _creationTime: assetCreatedAt, ...assetFields } = asset;
    const newAsset = await ctx.db.insert("profileAssets", { ...assetFields, profileId: second.profileId, sourceSubmissionId: id, state: "active", deletedAt: undefined });
    await ctx.db.patch(id, { approvedAssetId: newAsset });
    return id;
  });
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { ...args, submissionId: otherId })).code, "idempotency_conflict");
  assert.equal((await f.t.run(async ctx => ctx.db.get((await ctx.db.get(otherId))!.approvedAssetId!)))?.state, "active");
});

for (const metadata of [{ credit: null }, { credit: " " }, { sourceUrl: null, sourceDescription: null }, { sourceUrl: "http://example.test" }, { creditUrl: "javascript:alert(1)" }, { label: null }, {}]) {
  it(`refuses invalid correction ${JSON.stringify(metadata)}`, async () => {
    const f = await fixture();
    const d = await f.detail();
    const result = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { submissionId: f.intent.submissionId,
      expectedContributionVersion: d.contributionVersion, idempotencyKey: "invalid", action: "update_metadata", metadata });
    assert.equal(result.operationState, "refused");
    assert.deepEqual(await f.detail(), d);
  });
}

for (const condition of ["primary", "other_selection", "claimed", "private_profile", "private_asset", "hidden_kit", "suppressed", "held", "wrong_submitter"] as const) {
  it(`protects contribution management after ${condition}`, async () => {
    const f = await fixture();
    const d = await f.detail();
    await f.t.run(async ctx => {
      if (condition === "primary" || condition === "other_selection") await selectProfileAssetIdentity(ctx.db, { profileId: f.s.profileId, assetId: d.assetId, placement: "profile_image", actorUserId: condition === "primary" ? f.s.contributorUserId : f.s.moderatorUserId, now: Date.now() });
      if (condition === "claimed") await ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" });
      if (condition === "private_profile") await ctx.db.patch(f.s.profileId, { publicSurfacingState: "opted_out" });
      if (condition === "private_asset") await ctx.db.patch(d.assetId, { visibility: "private", credit: "Private owner credit" });
      if (condition === "hidden_kit") await ctx.db.patch(f.s.profileId, { fieldVisibility: { mediaKit: "private" } });
      if (condition === "suppressed") await ctx.db.patch(d.assetId, { moderatorSuppressedAt: Date.now() });
      if (condition === "held") await ctx.db.patch(f.intent.submissionId, { legalHoldAt: Date.now() });
      if (condition === "wrong_submitter") await ctx.db.patch(f.intent.submissionId, { submitterUserId: f.s.moderatorUserId });
    });
    const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "blocked", action: "remove" as const };
    if (condition === "private_asset" || condition === "suppressed" || condition === "wrong_submitter") await assert.rejects(f.actor.mutation(api.profileMediaSubmissions.manageContribution, args), /unavailable/i);
    else assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, args)).operationState, "refused");
    assert.equal((await f.t.run(ctx => ctx.db.get(d.assetId)))?.state, "active");
    if (condition !== "wrong_submitter") {
      const history = await f.actor.query(api.profileMediaSubmissions.getMine, { submissionId: f.intent.submissionId });
      assert.equal(history?.status, "approved");
      assert.ok(!JSON.stringify(history).includes("Private owner credit"));
    }
  });
}

it("metadata correction invalidates inspected placement review and refreshes its candidate projection", async () => {
  const f = await fixture();
  const d = await f.detail();
  const proposal = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal" });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const before = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: proposal.resourceId! });
  assert.ok(before);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { submissionId: f.intent.submissionId,
    expectedContributionVersion: d.contributionVersion, idempotencyKey: "correct", action: "update_metadata", metadata: { credit: "Corrected credit", sourceUrl: "https://corrected.example/source" } })).operationState, "committed");
  const after = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: proposal.resourceId! });
  assert.ok(after);
  assert.notEqual(after.reviewVersion, before.reviewVersion);
  assert.equal(after.candidate.credit, "Corrected credit");
  assert.equal(after.candidate.sourceUrl, "https://corrected.example/source");
  assert.equal(after.credit, "Corrected credit");
  assert.equal(after.sourceUrl, "https://corrected.example/source");
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: proposal.resourceId!, expectedReviewVersion: before.reviewVersion, decision: "approve", privateReason: "Checked", idempotencyKey: "stale" })).code, "review_changed");
});

async function fixture(profileType: "person" | "community" = "person", independentlyApproved = false) {
  const t = convexTest({ schema, modules });
  const s = await seed(t, profileType);
  const { intent } = await createAndUpload(t, s);
  const grant = await t.run(ctx => ctx.db.insert("accountFeatureGrants", {
    userId: s.contributorUserId, feature: "trusted_publisher", state: "active",
    grantedBy: { tokenIdentifier: "test:operator", issuer: "test", subject: "operator" },
    grantedAt: Date.now(), updatedAt: Date.now(),
  }));
  const actor = t.withIdentity(s.contributorIdentity);
  if (independentlyApproved) await t.run(ctx => ctx.db.patch(grant, { state: "revoked" }));
  const reviewer = independentlyApproved ? t.withIdentity(s.moderatorIdentity) : actor;
  const pending = await reviewer.query(independentlyApproved ? api.profileMediaSubmissions.reviewDetail : api.profileMediaSubmissions.publisherDetail, { submissionId: intent.submissionId });
  assert.ok(pending);
  assert.equal((await reviewer.mutation(independentlyApproved ? api.profileMediaSubmissions.decideWithReceipt : api.profileMediaSubmissions.publish, {
    submissionId: intent.submissionId, expectedReviewVersion: pending.reviewVersion, idempotencyKey: "publish",
    ...(independentlyApproved ? { decision: "approve", privateReason: "Independently reviewed" } : {}),
  })).operationState, "committed");
  await t.run(ctx => ctx.db.patch(intent.submissionId, { createdAt: Date.now() - 60_000 }));
  const detail = () => actor.query(api.profileMediaSubmissions.contributionDetail, { submissionId: intent.submissionId });
  const place = async (action: "select_primary" | "clear_primary", idempotencyKey = crypto.randomUUID()) => {
    const d = await detail();
    return actor.mutation(api.profileMediaSubmissions.placeContribution, {
      submissionId: intent.submissionId, expectedContributionVersion: d.contributionVersion, action, idempotencyKey,
    });
  };
  const placements = () => t.run(async ctx => (await ctx.db.query("profileAssetPlacements").collect()).filter(p => p.state === "active").map(p => p.placement).sort());
  return { t, s, intent, grant, actor, detail, place, placements };
}

it("allows ordinary independently approved contributors to correct and remove their own kit items", async () => {
  const f = await fixture("person", true);
  assert.equal((await f.detail()).canEditMetadata, true);
  const d = await f.detail();
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { submissionId: f.intent.submissionId,
    expectedContributionVersion: d.contributionVersion, idempotencyKey: "correct", action: "update_metadata", metadata: { credit: "Corrected credit" } })).operationState, "committed");
  const fresh = await f.detail();
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { submissionId: f.intent.submissionId,
    expectedContributionVersion: fresh.contributionVersion, idempotencyKey: "remove", action: "remove" })).operationState, "committed");
});

it("protects non-kit placement selections and exposes no current metadata for a hidden kit", async () => {
  const f = await fixture();
  const d = await f.detail();
  await f.t.run(async ctx => {
    await ctx.db.insert("profileAssetPlacements", { profileId: f.s.profileId, assetId: d.assetId, placement: "banner", position: 0,
      state: "active", selectionActorUserId: f.s.moderatorUserId, selectionOperationId: "owner", updatedAt: Date.now() });
    await ctx.db.patch(d.assetId, { credit: "Private owner metadata" });
  });
  assert.equal((await f.detail()).canEditMetadata, false);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, { submissionId: f.intent.submissionId,
    expectedContributionVersion: d.contributionVersion, idempotencyKey: "protected", action: "update_metadata", metadata: { credit: "Take over" } })).operationState, "refused");
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { fieldVisibility: { mediaKit: "private" } }));
  assert.ok(!JSON.stringify(await f.detail()).includes("Private owner metadata"));
});

it("attested MCP contributors manage with contribute scope and lose replay after delegation revocation", async () => {
  const f = await fixture("person", true);
  const d = await f.detail();
  const tokenId = await f.t.run(ctx => ctx.db.insert("oauthAccessTokens", { tokenId: "manage-token", clientId: "client", subjectType: "user",
    userId: f.s.contributorUserId, resource: "https://example.test/mcp", scopes: ["mcp:read", "mcp:write", "assets:contribute"], status: "active", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }));
  const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "mcp-correct",
    action: "update_metadata" as const, metadata: { credit: "MCP credit" }, actorUserId: f.s.contributorUserId,
    oauthTokenId: "manage-token", oauthClientId: "client", emailVerified: true, emailVerificationAttestedAt: Date.now() };
  await assert.rejects(f.t.mutation(internal.profileMediaSubmissions.manageContributionForMcpActor, { ...args, emailVerified: false }), /verified/i);
  const first = await f.t.mutation(internal.profileMediaSubmissions.manageContributionForMcpActor, args);
  assert.equal(first.operationState, "committed");
  assert.deepEqual(await f.t.mutation(internal.profileMediaSubmissions.manageContributionForMcpActor, args), first);
  await f.t.run(ctx => ctx.db.patch(tokenId, { status: "revoked" }));
  await assert.rejects(f.t.mutation(internal.profileMediaSubmissions.manageContributionForMcpActor, args), /DENIED/);
});

for (const profileType of ["person", "community"] as const) {
  it(`selects and clears its own ${profileType} primary while keeping gallery and bytes`, async () => {
    const f = await fixture(profileType);
    assert.equal((await f.detail()).canSelectPrimary, true);
    assert.equal((await f.place("select_primary")).operationState, "committed");
    assert.deepEqual(await f.placements(), ["gallery", profileType === "person" ? "profile_image" : "primary_logo"].sort());
    assert.equal((await f.detail()).canClearPrimary, true);
    assert.equal((await f.place("clear_primary")).operationState, "committed");
    assert.deepEqual(await f.placements(), ["gallery"]);
    assert.equal((await f.t.run(ctx => ctx.db.query("profileAssets").first()))?.state, "active");
  });
}

it("replays a command once and refuses changed-key input and stale versions", async () => {
  const f = await fixture();
  const d = await f.detail();
  const input = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, action: "select_primary" as const, idempotencyKey: "selection" };
  const first = await f.actor.mutation(api.profileMediaSubmissions.placeContribution, input);
  assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.placeContribution, input), first);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.placeContribution, { ...input, action: "clear_primary" })).code, "idempotency_conflict");
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.placeContribution, { ...input, action: "clear_primary", idempotencyKey: "stale" })).code, "contribution_changed");
});

for (const condition of ["legacy", "revoked", "claimed", "private", "other_contributor"] as const) {
  it(`refuses selection after ${condition}`, async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      if (condition === "legacy") await ctx.db.patch(f.s.profileId, { avatarImageUrl: "https://example.test/current.webp" });
      if (condition === "revoked") await ctx.db.patch(f.grant, { state: "revoked" });
      if (condition === "claimed") await ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" });
      if (condition === "private") await ctx.db.patch(f.s.profileId, { publicSurfacingState: "opted_out" });
      if (condition === "other_contributor") await ctx.db.patch(f.intent.submissionId, { submitterUserId: f.s.moderatorUserId });
    });
    if (condition === "other_contributor") await assert.rejects(f.detail(), /unavailable/i);
    else {
      assert.equal((await f.detail()).canSelectPrimary, false);
      assert.equal((await f.place("select_primary")).operationState, "refused");
    }
    assert.deepEqual(await f.placements(), ["gallery"]);
  });
}

it("same-asset reselection by another authorized actor invalidates publisher undo", async () => {
  const f = await fixture();
  await f.place("select_primary");
  await f.t.run(async ctx => {
    const p = await ctx.db.query("profileAssetPlacements").filter(q => q.eq(q.field("placement"), "profile_image")).first();
    assert.ok(p);
    await ctx.db.patch(p._id, { selectionActorUserId: f.s.moderatorUserId, selectionOperationId: "admin-reselection" });
  });
  assert.equal((await f.detail()).canClearPrimary, false);
  assert.equal((await f.place("clear_primary")).operationState, "refused");
});

it("owner same-asset selection stamps new provenance and retains the contribution gallery", async () => {
  const f = await fixture();
  await f.place("select_primary");
  const d = await f.detail();
  const before = await f.t.run(async ctx => (await ctx.db.query("profileAssetPlacements").collect()).find(p => p.placement === "profile_image" && p.state === "active"));
  await f.t.run(async ctx => {
    await ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" });
    await ctx.db.insert("profileOwners", { profileId: f.s.profileId, userId: f.s.moderatorUserId, roleKey: "owner", state: "active", grantedAt: Date.now(), updatedAt: Date.now() });
  });
  const version = await f.t.run(ctx => getProfileMediaVersion(ctx.db, f.s.profileId));
  await f.t.mutation(internal.profileAssets.manageOwnedMediaForMcpActor, {
    ownerUserId: f.s.moderatorUserId, oauthClientId: "client", oauthTokenId: "token", requestId: "reselect",
    slug: "community-dj", expectedMediaVersion: version, asset: { assetId: d.assetId, placements: ["profile_image"] },
  });
  assert.deepEqual(await f.placements(), ["gallery", "profile_image"]);
  const after = await f.t.run(async ctx => (await ctx.db.query("profileAssetPlacements").collect()).find(p => p.placement === "profile_image" && p.state === "active"));
  assert.equal(after?.selectionActorUserId, f.s.moderatorUserId);
  assert.notEqual(after?.selectionOperationId, before?.selectionOperationId);
  assert.notEqual(await f.t.run(ctx => getProfileMediaVersion(ctx.db, f.s.profileId)), version);
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { claimState: "unclaimed" }));
  assert.equal((await f.detail()).canClearPrimary, false);
});

it("ignores biography edits but binds review to the exact original primary selection", async () => {
  const f = await fixture();
  const d = await f.detail();
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { headline: "Changed biography", updatedAt: Date.now() }));
  assert.equal((await f.detail()).contributionVersion, d.contributionVersion);
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal" });
  assert.equal(p.operationState, "committed");
  await f.place("select_primary");
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
  assert.ok(review);
  const result = await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: review.reviewVersion, decision: "approve", privateReason: "Placement checked", idempotencyKey: "changed-placement" });
  assert.equal(result.code, "placement_changed");
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.rebase, { submissionId: p.resourceId!, expectedReviewVersion: review.reviewVersion, idempotencyKey: "rebase-placement" })).operationState, "committed");
  const rebased = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
  assert.ok(rebased);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: rebased.reviewVersion, decision: "approve", privateReason: "Current placement checked", idempotencyKey: "approve-rebased" })).operationState, "committed");
  assert.equal((await f.detail()).canClearPrimary, false);
});

it("legacy placements never authorize undo and publisher revocation refuses historical command replay", async () => {
  const f = await fixture();
  const d = await f.detail();
  const input = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, action: "select_primary" as const, idempotencyKey: "original-selection" };
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.placeContribution, input)).operationState, "committed");
  await f.t.run(async ctx => {
    const p = await ctx.db.query("profileAssetPlacements").filter(q => q.eq(q.field("placement"), "profile_image")).first();
    assert.ok(p);
    await ctx.db.patch(p._id, { selectionActorUserId: undefined, selectionOperationId: undefined });
  });
  assert.equal((await f.detail()).canClearPrimary, false);
  assert.equal((await f.place("clear_primary")).operationState, "refused");
  await f.t.run(ctx => ctx.db.patch(f.grant, { state: "revoked" }));
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.placeContribution, input)).code, "authority_changed");
});

it("reviews existing-asset placement without a new upload or published charge", async () => {
  const f = await fixture();
  const d = await f.detail();
  const proposal = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, {
    submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal",
  });
  assert.equal(proposal.operationState, "committed");
  const publisherPreview = await f.actor.query(api.profileMediaSubmissions.publisherDetail, { submissionId: proposal.resourceId! });
  assert.ok(publisherPreview);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.publish, { submissionId: proposal.resourceId!, expectedReviewVersion: publisherPreview.reviewVersion, idempotencyKey: "publish-placement" })).code, "placement_requires_review");
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: proposal.resourceId! });
  assert.ok(review?.candidate.rendition);
  const stored = await reviewer.query(api.profileMediaSubmissions.getCandidateForStorage, { submissionId: proposal.resourceId! });
  assert.equal(stored?.storageKey, (await f.t.run(ctx => ctx.db.query("profileAssets").first()))?.storageKey);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, {
    submissionId: proposal.resourceId!, expectedReviewVersion: review.reviewVersion, decision: "approve", privateReason: "Correct identity", idempotencyKey: "approve-placement",
  })).operationState, "committed");
  assert.deepEqual(await f.placements(), ["gallery", "profile_image"]);
  assert.equal((await f.t.run(ctx => ctx.db.query("profileAssetUploadIntents").collect())).length, 1);
  assert.equal((await f.t.run(ctx => ctx.db.query("profileAssets").collect())).length, 1);
});

for (const disposition of ["reject", "withdraw"] as const) {
  it(`${disposition} leaves the published asset and its bytes alone`, async () => {
    const f = await fixture();
    const beforeCharge = await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first());
    const d = await f.detail();
    const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal" });
    assert.equal(p.operationState, "committed");
    const id = p.resourceId!;
    if (disposition === "withdraw") await f.actor.mutation(api.profileMediaSubmissions.withdraw, { submissionId: id });
    else {
      const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
      const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: id });
      assert.ok(review);
      await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: id, expectedReviewVersion: review.reviewVersion, decision: "reject", privateReason: "Placement declined", publicReason: "Declined", idempotencyKey: "reject" });
    }
    assert.equal((await f.t.run(ctx => ctx.db.get(id)))?.blobDeleteAfter, undefined);
    assert.equal((await f.t.run(ctx => ctx.db.query("mediaPublicationRestrictions").collect())).length, 0);
    assert.equal((await f.t.run(ctx => ctx.db.query("profileAssets").first()))?.state, "active");
    assert.deepEqual(await f.placements(), ["gallery"]);
    assert.deepEqual(await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first()), beforeCharge);
  });
}

it("requires a distinct reviewer and replaces identity at full capacity without moving either gallery item", async () => {
  const f = await fixture();
  const d = await f.detail();
  const beforeBytes = await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first());
  const oldAssetId = await f.t.run(async ctx => {
    const asset = await ctx.db.get(d.assetId);
    assert.ok(asset);
    const { _id, _creationTime, sourceSubmissionId, ...fields } = asset;
    let old;
    for (let i = 0; i < 11; i++) {
      const id = await ctx.db.insert("profileAssets", { ...fields, storageKey: `stored/${i}.webp`, contentSha256: `other-${i}` });
      await ctx.db.insert("profileAssetPlacements", { profileId: f.s.profileId, assetId: id, placement: "gallery", position: i + 1, state: "active", updatedAt: Date.now() });
      if (i === 0) old = id;
    }
    assert.ok(old);
    await selectProfileAssetIdentity(ctx.db, { profileId: f.s.profileId, assetId: old, placement: "profile_image", actorUserId: f.s.moderatorUserId, now: Date.now() });
    await ctx.db.insert("accountFeatureGrants", { userId: f.s.contributorUserId, feature: "super_admin", state: "active", grantedBy: { tokenIdentifier: "test:operator", issuer: "test", subject: "operator" }, grantedAt: Date.now(), updatedAt: Date.now() });
    return old;
  });
  const current = await f.detail();
  const input = { submissionId: f.intent.submissionId, expectedContributionVersion: current.contributionVersion, idempotencyKey: "replacement" };
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, input);
  assert.equal(p.operationState, "committed");
  assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, input), p);
  const ownReview = await f.actor.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
  assert.ok(ownReview);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: ownReview.reviewVersion, decision: "approve", privateReason: "Self", idempotencyKey: "self" })).code, "self_review");
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
  assert.ok(review);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: review.reviewVersion, decision: "approve", privateReason: "Correct replacement", idempotencyKey: "independent" })).operationState, "committed");
  const active = await f.t.run(ctx => ctx.db.query("profileAssetPlacements").filter(q => q.eq(q.field("state"), "active")).collect());
  assert.ok(active.some(p => p.assetId === oldAssetId && p.placement === "gallery"));
  assert.ok(active.some(p => p.assetId === d.assetId && p.placement === "gallery"));
  assert.equal(active.find(p => p.placement === "profile_image")?.assetId, d.assetId);
  assert.equal((await f.t.run(ctx => ctx.db.query("profileAssets").collect())).length, 12);
  assert.deepEqual(await f.t.run(ctx => ctx.db.query("contributionUploadReservations").first()), beforeBytes);
  assert.equal((await f.detail()).canClearPrimary, false);
});

it("treats visible automatic artwork as occupied and refuses hidden authored identity too", async () => {
  const f = await fixture();
  await f.t.run(async ctx => {
    const external = "usr_7023d326-083f-41fe-a3e9-27ea303b50c5";
    await ctx.db.patch(f.s.profileId, { outboundLinks: [{ type: "vrchat_profile", label: "VRChat", url: `https://vrchat.com/home/user/${external}`, source: "community_submitted" }] });
    await ctx.db.insert("profileLinkDestinations", { key: `vrchat_user:${external}`, kind: "vrchat_user", locator: external, provider: "vrchat", status: "resolved", artworkSourceUrl: "https://example.test/icon.webp", artworkType: "user_icon", observedAt: 1 });
  });
  assert.equal((await f.detail()).canSelectPrimary, false);
  assert.equal((await f.place("select_primary")).code, "primary_occupied");
  await f.t.run(async ctx => {
    await ctx.db.patch(f.s.profileId, { outboundLinks: [], fieldVisibility: { mediaKit: "private" } });
    const asset = await ctx.db.query("profileAssets").first();
    assert.ok(asset);
    await selectProfileAssetIdentity(ctx.db, { profileId: f.s.profileId, assetId: asset._id, placement: "primary_logo", actorUserId: f.s.moderatorUserId, now: Date.now() });
  });
  assert.equal((await f.detail()).canSelectPrimary, false);
  assert.equal((await f.place("select_primary")).code, "primary_occupied");
});

it("does not interpret a rejected placement as a digest-wide content rejection", async () => {
  const f = await fixture();
  const d = await f.detail();
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal" });
  assert.equal(p.operationState, "committed");
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
  assert.ok(review);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: review.reviewVersion, decision: "reject", privateReason: "Placement only", publicReason: "Declined", idempotencyKey: "reject" })).operationState, "committed");
  const second = await seed(f.t);
  const { intent } = await createAndUpload(f.t, second);
  await f.t.run(ctx => ctx.db.insert("accountFeatureGrants", { userId: second.contributorUserId, feature: "trusted_publisher", state: "active", grantedBy: { tokenIdentifier: "test:operator", issuer: "test", subject: "operator" }, grantedAt: Date.now(), updatedAt: Date.now() }));
  const actor = f.t.withIdentity(second.contributorIdentity);
  const pending = await actor.query(api.profileMediaSubmissions.publisherDetail, { submissionId: intent.submissionId });
  assert.ok(pending);
  assert.equal((await actor.mutation(api.profileMediaSubmissions.publish, { submissionId: intent.submissionId, expectedReviewVersion: pending.reviewVersion, idempotencyKey: "another-publication" })).operationState, "committed");
});
