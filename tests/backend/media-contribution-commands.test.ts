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
    await occupyFallback(f);
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
    if (condition === "other_contributor") assert.equal(await f.detail(), null);
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
    await occupyFallback(f);
  const d = await f.detail();
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { headline: "Changed biography", updatedAt: Date.now() }));
  assert.equal((await f.detail()).contributionVersion, d.contributionVersion);
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "proposal" });
  assert.equal(p.operationState, "committed");
  await f.t.run(ctx => selectProfileAssetIdentity(ctx.db, { profileId: f.s.profileId, assetId: d.assetId, placement: "profile_image", actorUserId: f.s.moderatorUserId, now: Date.now() }));
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
    await occupyFallback(f);
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
    await occupyFallback(f);
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
  assert.equal((await f.place("select_primary")).code, "target_unavailable");
});

it("does not interpret a rejected placement as a digest-wide content rejection", async () => {
  const f = await fixture();
  await occupyFallback(f);
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

it("projects replacement capability for an ordinary contributor only on eligible occupied targets", async () => {
  const f = await fixture();
  await f.t.run(ctx => ctx.db.patch(f.grant, { state: "revoked" }));
  assert.equal((await f.detail()).canProposePlacement, false);
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { avatarImageUrl: "https://example.test/current.png" }));
  assert.equal((await f.detail()).canSelectPrimary, false);
  assert.equal((await f.detail()).canProposePlacement, true);
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { claimState: "claimed_verified" }));
  assert.equal((await f.detail()).canProposePlacement, false);
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { claimState: "unclaimed", publicSurfacingState: "opted_out" }));
  assert.equal((await f.detail()).canProposePlacement, false);
  await f.t.run(async ctx => {
    await ctx.db.patch(f.s.profileId, { publicSurfacingState: "public" });
    await ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, kind: "identity", submissionId: f.intent.submissionId, createdAt: Date.now(), actorUserId: f.s.moderatorUserId });
  });
  assert.equal((await f.detail()).canProposePlacement, false);
});

it("browser inventory hides logically removed and unavailable contributions and removal retry preserves its receipt", async () => {
  const f = await fixture();
  const d = await f.detail();
  const input = { submissionId: f.intent.submissionId, expectedContributionVersion: d!.contributionVersion, idempotencyKey: "removed-inventory", action: "remove" as const };
  const receipt = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, input);
  assert.equal(receipt.operationState, "committed");
  assert.equal(await f.detail(), null);
  assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.manageContribution, input), receipt);
  const second = await fixture();
  const current = await second.detail();
  await second.t.run(ctx => ctx.db.patch(current!.assetId, { moderatorSuppressedAt: Date.now() }));
  assert.equal(await second.detail(), null);
});

for (const gate of ["VRDEX_PROFILE_MEDIA_KIT_ENABLED", "VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED"] as const) {
  it(`disables management capabilities and new commands when ${gate} is disabled, preserving receipts`, async () => {
    const f = await fixture();
    const d = await f.detail();
    const priorArgs = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion,
      idempotencyKey: "before-disabled", action: "update_metadata" as const, metadata: { credit: "Corrected credit" } };
    const prior = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, priorArgs);
    assert.equal(prior.operationState, "committed");
    const fresh = await f.detail();
    const before = await f.t.run(ctx => ctx.db.get(fresh.assetId));
    const previousGate = process.env[gate];
    process.env[gate] = "false";
    try {
      const disabled = await f.detail();
      assert.equal(disabled.canEditMetadata, false);
      assert.equal(disabled.canRemove, false);
      for (const action of ["update_metadata", "remove"] as const) {
        const receipt = await f.actor.mutation(api.profileMediaSubmissions.manageContribution, {
          submissionId: f.intent.submissionId, expectedContributionVersion: fresh.contributionVersion,
          idempotencyKey: `disabled-${action}`, action, ...(action === "update_metadata" ? { metadata: priorArgs.metadata } : {}),
        });
        assert.equal(receipt.operationState, "refused");
        assert.equal(receipt.code, "review_disabled");
      }
      assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.manageContribution, priorArgs), prior);
      assert.deepEqual(await f.t.run(ctx => ctx.db.get(fresh.assetId)), before);
    } finally {
      process.env[gate] = previousGate;
    }
  });
}

for (const condition of ["disabled_kit", "hidden_kit", "disabled_submissions"] as const) {
  it(`gates new placement and proposals after ${condition}, preserves historical replay and safe undo`, async () => {
    const f = await fixture();
    const initial = await f.detail();
    await f.t.run(ctx => ctx.db.insert("oauthAccessTokens", { tokenId: "placement-token", clientId: "client", subjectType: "user", userId: f.s.contributorUserId, resource: "https://example.test/mcp", scopes: ["mcp:read", "mcp:write", "assets:contribute", "assets:publish"], status: "active", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }));
    const attestation = { actorUserId: f.s.contributorUserId, oauthTokenId: "placement-token", oauthClientId: "client", emailVerified: true, emailVerificationAttestedAt: Date.now() };
    const priorInput = { submissionId: f.intent.submissionId, expectedContributionVersion: initial.contributionVersion, idempotencyKey: "historical-select", action: "select_primary" as const };
    const prior = await f.actor.mutation(api.profileMediaSubmissions.placeContribution, priorInput);
    assert.equal(prior.operationState, "committed");
    const env = { kit: process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED, submissions: process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED };
    if (condition === "hidden_kit") await f.t.run(ctx => ctx.db.patch(f.s.profileId, { fieldVisibility: { mediaKit: "private" } }));
    if (condition === "disabled_kit") process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    if (condition === "disabled_submissions") process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "false";
    try {
      const detail = await f.detail();
      assert.deepEqual(await f.t.query(internal.profileMediaSubmissions.contributionDetailForMcpActor, { submissionId: f.intent.submissionId, ...attestation }), detail);
      assert.equal(detail.canSelectPrimary, false);
      assert.equal(detail.canProposePlacement, false);
      assert.equal(detail.canClearPrimary, condition !== "disabled_submissions");
      assert.deepEqual(await f.actor.mutation(api.profileMediaSubmissions.placeContribution, priorInput), prior);
      const cleared = await f.place("clear_primary", "new-clear");
      assert.equal(cleared.operationState, condition === "disabled_submissions" ? "refused" : "committed");
      if (condition === "disabled_submissions") assert.equal(cleared.code, "review_disabled");
      const empty = await f.detail();
      assert.equal(empty.canSelectPrimary, false);
      assert.equal((await f.place("select_primary", "new-select")).code, condition === "disabled_submissions" ? "review_disabled" : "target_unavailable");
      await f.t.run(ctx => ctx.db.patch(f.s.profileId, { avatarImageUrl: "https://example.test/current.png" }));
      const mcpSelection = await f.t.mutation(internal.profileMediaSubmissions.placeContributionForMcpActor, { submissionId: f.intent.submissionId, expectedContributionVersion: (await f.detail()).contributionVersion, idempotencyKey: "mcp-new-select", action: "select_primary", ...attestation });
      assert.equal(mcpSelection.code, condition === "disabled_submissions" ? "review_disabled" : "target_unavailable");
      const occupied = await f.detail();
      assert.equal(occupied.canProposePlacement, false);
      const proposal = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: occupied.contributionVersion, idempotencyKey: "new-proposal" });
      assert.equal(proposal.code, condition === "disabled_submissions" ? "review_disabled" : "target_unavailable");
      const mcpProposal = await f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, { submissionId: f.intent.submissionId, expectedContributionVersion: occupied.contributionVersion, idempotencyKey: "mcp-new-proposal", ...attestation });
      assert.equal(mcpProposal.code, proposal.code);
    } finally {
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = env.kit;
      process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = env.submissions;
    }
  });
}

for (const unavailable of ["hidden", "disabled"] as const) {
  it(`refuses fresh candidate approval for a ${unavailable} kit, including a fresh inspection and legacy decisions`, async () => {
    const f = await fixture();
    await occupyFallback(f);
    const d = await f.detail();
    const proposal = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "candidate-proposal" });
    const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
    const id = proposal.resourceId!;
    if (unavailable === "hidden") await f.t.run(ctx => ctx.db.patch(f.s.profileId, { fieldVisibility: { mediaKit: "private" } }));
    else process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
    try {
      const fresh = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: id });
      assert.ok(fresh);
      assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: id, expectedReviewVersion: fresh.reviewVersion, decision: "approve", privateReason: "Checked", idempotencyKey: "unavailable" })).code, "target_unavailable");
      await assert.rejects(reviewer.mutation(api.profileMediaSubmissions.decide, { submissionId: id, expectedProfileUpdatedAt: (await f.t.run(ctx => ctx.db.get(f.s.profileId)))!.updatedAt, decision: "approve", privateReason: "Checked" }), /unavailable/i);
      assert.deepEqual(await f.placements(), ["gallery"]);
      assert.equal((await f.t.run(ctx => ctx.db.query("profileMediaSubmissions").filter(q => q.eq(q.field("candidateAssetId"), d.assetId)).first()))?.status, "submitted");
    } finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
  });
}
for (const kind of ["identity", "dispute", "suppression", "rejection"] as const) {
  it(`rechecks current ${kind} restrictions at receipt and legacy candidate approval`, async () => {
    const f = await fixture();
    await occupyFallback(f);
    const d = await f.detail();
    if (kind === "identity" || kind === "dispute") await f.t.run(ctx => ctx.db.patch(d.assetId, { contentSha256: undefined }));
    const freshContribution = await f.detail();
    const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: freshContribution.contributionVersion, idempotencyKey: "candidate-proposal" });
    const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
    const before = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
    assert.ok(before);
    await f.t.run(async ctx => {
      const asset = await ctx.db.get(d.assetId);
      await ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, submissionId: f.intent.submissionId, kind, actorUserId: f.s.moderatorUserId, createdAt: Date.now(), ...(kind === "identity" || kind === "dispute" ? {} : { contentSha256: asset!.contentSha256 }) });
    });
    const after = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! });
    assert.ok(after);
    assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: after.reviewVersion, decision: "approve", privateReason: "Checked", idempotencyKey: "restricted" })).code, "publication_restricted");
    await assert.rejects(reviewer.mutation(api.profileMediaSubmissions.decide, { submissionId: p.resourceId!, expectedProfileUpdatedAt: (await f.t.run(ctx => ctx.db.get(f.s.profileId)))!.updatedAt, decision: "approve", privateReason: "Checked" }), /RESTRICTED/);
    assert.deepEqual(await f.placements(), ["gallery"]);
  });
}
it("credit URL metadata accepts 2048 and rejects 2049 at the strict backend command boundary", async () => {
  const f = await fixture(); const d = await f.detail();
  const prefix = "https://credit.example/";
  const input = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "credit-boundary", action: "update_metadata" as const, metadata: { creditUrl: prefix + "a".repeat(2048 - prefix.length) } };
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.manageContribution, input)).operationState, "committed");
  const fresh = await f.detail(); assert.equal(fresh.metadata.creditUrl?.length, 2048);
  await assert.rejects(f.actor.mutation(api.profileMediaSubmissions.manageContribution, { ...input, expectedContributionVersion: fresh.contributionVersion, idempotencyKey: "credit-too-long", metadata: { creditUrl: input.metadata.creditUrl + "a" } }), /2048/);
});

it("editable profile projection uses current public-kit availability for intake", async () => {
  const t = convexTest({ schema, modules: { ...modules, "../../convex/profiles.ts": () => import("../../convex/profiles") } });
  const s = await seed(t); const actor = t.withIdentity(s.contributorIdentity);
  assert.equal((await actor.query(api.profiles.editableProfile, { slug: "community-dj" }))?.canContributeMedia, true);
  await t.run(ctx => ctx.db.patch(s.profileId, { fieldVisibility: { mediaKit: "private" } }));
  assert.equal((await actor.query(api.profiles.editableProfile, { slug: "community-dj" }))?.canContributeMedia, false);
  await t.run(ctx => ctx.db.patch(s.profileId, { fieldVisibility: {} }));
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
  try { assert.equal((await actor.query(api.profiles.editableProfile, { slug: "community-dj" }))?.canContributeMedia, false); }
  finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
});

it("replays exact committed placement review after kit withdrawal and a later restriction", async () => {
  const f = await fixture();
    await occupyFallback(f); const d = await f.detail();
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "candidate-proposal" });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const detail = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); assert.ok(detail);
  const args = { submissionId: p.resourceId!, expectedReviewVersion: detail.reviewVersion, decision: "approve" as const, privateReason: "Checked", idempotencyKey: "approved-review" };
  const receipt = await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, args); assert.equal(receipt.operationState, "committed");
  await f.t.run(async ctx => { await ctx.db.patch(f.s.profileId, { fieldVisibility: { mediaKit: "private" } }); await ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, submissionId: f.intent.submissionId, kind: "identity", actorUserId: f.s.moderatorUserId, createdAt: Date.now() }); });
  process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "false";
  try { assert.deepEqual(await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, args), receipt); }
  finally { process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true"; }
  assert.deepEqual(await f.placements(), ["gallery", "profile_image"]);
});

async function occupyFallback(f: Awaited<ReturnType<typeof fixture>>) {
  await f.t.run(ctx => ctx.db.patch(f.s.profileId, { avatarImageUrl: "https://example.test/current.png" }));
}
for (const trusted of [false, true]) for (const mcp of [false, true]) {
  it(`durably refuses empty replacement for ${trusted ? "trusted" : "ordinary"} ${mcp ? "MCP" : "browser"} contributors`, async () => {
    const f = await fixture("person", !trusted); const d = await f.detail();
    const attestation = await contributionAttestation(f);
    const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "empty" };
    const call = () => mcp ? f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, { ...args, ...attestation }) : f.actor.mutation(api.profileMediaSubmissions.proposePlacement, args);
    const receipt = await call(); assert.equal(receipt.code, "primary_empty"); assert.equal(receipt.operationState, "refused");
    await occupyFallback(f); assert.deepEqual(await call(), receipt);
    assert.equal((await f.t.run(ctx => ctx.db.query("profileMediaSubmissions").collect())).length, 1);
  });
}
async function contributionAttestation(f: Awaited<ReturnType<typeof fixture>>) {
  await f.t.run(ctx => ctx.db.insert("oauthAccessTokens", { tokenId: "replacement-token", clientId: "client", subjectType: "user", userId: f.s.contributorUserId,
    resource: "https://example.test/mcp", scopes: ["mcp:read", "mcp:write", "assets:contribute"], status: "active", issuedAt: Date.now(), expiresAt: Date.now() + 60_000 }));
  return { actorUserId: f.s.contributorUserId, oauthTokenId: "replacement-token", oauthClientId: "client", emailVerified: true, emailVerificationAttestedAt: Date.now() };
}
it("actual MCP proposal boundary reports upload cooldown and admits a fresh key after the unchanged window", async () => {
  const f = await fixture(); await occupyFallback(f); const attestation = await contributionAttestation(f);
  await f.t.run(ctx => ctx.db.patch(f.intent.submissionId, { createdAt: Date.now() }));
  const d = await f.detail(); const args = { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "cooldown", ...attestation };
  const refused = await f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, args);
  assert.equal(refused.code, "proposal_rate_limited"); assert.equal(refused.operationState, "refused");
  await f.t.run(ctx => ctx.db.patch(f.intent.submissionId, { createdAt: Date.now() - 31_000 }));
  assert.deepEqual(await f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, args), refused);
  const fresh = await f.detail();
  assert.equal((await f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, { ...args, expectedContributionVersion: fresh.contributionVersion, idempotencyKey: "after-cooldown" })).operationState, "committed");
});
it("refuses fresh receipt and legacy approval after an old replacement is rebased onto an empty slot", async () => {
  const f = await fixture(); await occupyFallback(f); const d = await f.detail();
  const proposal = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "occupied" });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity); await f.t.run(ctx => ctx.db.patch(f.s.profileId, { avatarImageUrl: undefined }));
  const detail = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: proposal.resourceId! }); assert.ok(detail);
  await reviewer.mutation(api.profileMediaSubmissions.rebase, { submissionId: proposal.resourceId!, expectedReviewVersion: detail.reviewVersion, idempotencyKey: "empty-rebase" });
  const fresh = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: proposal.resourceId! }); assert.ok(fresh);
  const args = { submissionId: proposal.resourceId!, expectedReviewVersion: fresh.reviewVersion, decision: "approve" as const, privateReason: "Checked", idempotencyKey: "empty-review" };
  const refused = await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, args); assert.equal(refused.code, "primary_empty");
  assert.deepEqual(await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, args), refused);
  await assert.rejects(reviewer.mutation(api.profileMediaSubmissions.decide, { submissionId: proposal.resourceId!, expectedProfileUpdatedAt: (await f.t.run(ctx => ctx.db.get(f.s.profileId)))!.updatedAt, decision: "approve", privateReason: "Checked" }), /occupied/);
  assert.deepEqual(await f.placements(), ["gallery"]);
});
it("inherits only the original batch assignment for a candidate replacement", async () => {
  const f = await fixture(); await occupyFallback(f); const d = await f.detail();
  const assignment = await f.t.run(async ctx => {
    const grants = await ctx.db.query("accountFeatureGrants").collect();
    for (const grant of grants) if (grant.userId === f.s.moderatorUserId) await ctx.db.patch(grant._id, { state: "revoked" });
    await ctx.db.insert("accountFeatureGrants", { userId: f.s.moderatorUserId, feature: "media_reviewer", state: "active", grantedAt: Date.now(), updatedAt: Date.now(), grantedBy: { issuer: "test", subject: "operator", tokenIdentifier: "test:operator" } });
    const batchId = await ctx.db.insert("contributionBatches", { actorUserId: f.s.contributorUserId, idempotencyKey: "source-batch", label: "Source", archived: false, rowCount: 1, createdAt: Date.now() });
    const revisionId = await ctx.db.insert("contributionItemRevisions", { actorUserId: f.s.contributorUserId, batchId, itemKey: "source", revision: 1, payload: "{}", bytes: 2, createdAt: Date.now() });
    await ctx.db.insert("contributionItemAttempts", { actorUserId: f.s.contributorUserId, revisionId, oauthClientId: "client", submissionId: f.intent.submissionId, receipt: { operationId: "source", operationState: "committed" }, createdAt: Date.now() });
    return { id: await ctx.db.insert("contributionBatchReviewers", { batchId, reviewerUserId: f.s.moderatorUserId, active: true, expiresAt: Date.now() + 60_000 }), batchId };
  });
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "assigned-replacement" });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity); const detail = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); assert.ok(detail);
  const foreign = await seed(f.t, "community");
  await f.t.run(async ctx => {
    const proposal = (await ctx.db.get(ctx.db.normalizeId("profileMediaSubmissions", p.resourceId!)!))!;
    const { _id, _creationTime, ...fields } = proposal;
    await ctx.db.insert("profileMediaSubmissions", { ...fields, profileId: foreign.profileId });
    await ctx.db.insert("profileMediaSubmissions", { ...fields, submitterUserId: f.s.moderatorUserId });
    await ctx.db.insert("profileMediaSubmissions", { ...fields, status: "rejected" });
  });
  const listArgs = { batchId: assignment.batchId, status: "submitted" as const, paginationOpts: { cursor: null, numItems: 40 } };
  const queue = await reviewer.query(api.profileMediaSubmissions.listForReview, listArgs);
  assert.deepEqual(queue.page.map(row => row.submissionId), [p.resourceId]);
  const mcpQueue = await f.t.query(internal.profileMediaSubmissions.listForReviewForMcpActor, { ...listArgs, actorUserId: f.s.moderatorUserId, emailVerified: true, emailVerificationAttestedAt: Date.now() });
  assert.deepEqual(mcpQueue.page.map(row => row.submissionId), [p.resourceId]);
  assert.equal(await f.t.run(ctx => ctx.db.query("contributionItemAttempts").withIndex("by_submissionId", q => q.eq("submissionId", ctx.db.normalizeId("profileMediaSubmissions", p.resourceId!)!)).first()), null);
  await f.t.run(ctx => ctx.db.patch(assignment.id, { active: false }));
  await assert.rejects(reviewer.query(api.profileMediaSubmissions.listForReview, listArgs), /BATCH_UNAVAILABLE/);
  await assert.rejects(reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }), /ACCESS_REQUIRED/);
  await f.t.run(ctx => ctx.db.patch(assignment.id, { active: true }));
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: detail.reviewVersion, decision: "approve", privateReason: "Assigned replacement checked", idempotencyKey: "assigned-approve" })).operationState, "committed");
});
it("unbatched replacement refuses an ordinary reviewer and keeps distinct admin review", async () => {
  const f = await fixture(); await occupyFallback(f); const d = await f.detail();
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "unbatched" });
  const grant = await f.t.run(async ctx => { const old = (await ctx.db.query("accountFeatureGrants").collect()).find(g => g.userId === f.s.moderatorUserId)!; await ctx.db.patch(old._id, { feature: "media_reviewer" }); return old._id; });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  await assert.rejects(reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }), /ACCESS_REQUIRED/);
  await f.t.run(ctx => ctx.db.patch(grant, { feature: "super_admin" }));
  const detail = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); assert.ok(detail);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: detail.reviewVersion, decision: "approve", privateReason: "Admin checked", idempotencyKey: "admin" })).operationState, "committed");
});
it("MCP get returns known unavailable as null but preserves token and verification errors", async () => {
  const f = await fixture(); const attestation = await contributionAttestation(f); const d = await f.detail();
  await f.t.run(ctx => ctx.db.patch(d.assetId, { state: "deleted" }));
  assert.equal(await f.t.query(internal.profileMediaSubmissions.contributionDetailForMcpActor, { submissionId: f.intent.submissionId, ...attestation }), null);
  await assert.rejects(f.t.query(internal.profileMediaSubmissions.contributionDetailForMcpActor, { submissionId: f.intent.submissionId, ...attestation, emailVerified: false }), /verified/i);
  await f.t.run(async ctx => { const token = await ctx.db.query("oauthAccessTokens").withIndex("by_tokenId", q => q.eq("tokenId", "replacement-token")).unique(); await ctx.db.patch(token!._id, { status: "revoked" }); });
  await assert.rejects(f.t.query(internal.profileMediaSubmissions.contributionDetailForMcpActor, { submissionId: f.intent.submissionId, ...attestation }), /DENIED/);
});
it("restriction snapshot tracks bounded existence rather than append-only history", async () => {
  const f = await fixture(); await occupyFallback(f); const d = await f.detail();
  const p = await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "restricted-history" });
  const reviewer = f.t.withIdentity(f.s.moderatorIdentity);
  const insert = (count: number) => f.t.run(async ctx => { for (let i = 0; i < count; i++) await ctx.db.insert("mediaPublicationRestrictions", { profileId: f.s.profileId, submissionId: f.intent.submissionId, kind: "identity", actorUserId: f.s.moderatorUserId, createdAt: Date.now() }); });
  const clean = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); await insert(1);
  const blocked = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); assert.notEqual(blocked!.reviewVersion, clean!.reviewVersion);
  await insert(250); const more = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: p.resourceId! }); assert.equal(more!.reviewVersion, blocked!.reviewVersion);
  assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: p.resourceId!, expectedReviewVersion: more!.reviewVersion, decision: "approve", privateReason: "Checked", idempotencyKey: "blocked" })).code, "publication_restricted");
});
for (const managed of [false, true]) for (const mcp of [false, true]) {
  it(`admits ${mcp ? "MCP" : "browser"} replacement with ${managed ? "managed" : "visible fallback"} identity occupancy`, async () => {
    const f = await fixture("person", true); const d = await f.detail();
    if (!managed) await occupyFallback(f);
    else await f.t.run(async ctx => { const asset = (await ctx.db.get(d.assetId))!; const { _id, _creationTime, sourceSubmissionId, ...fields } = asset; const id = await ctx.db.insert("profileAssets", { ...fields, storageKey: "other.webp", source: "owner_authored" }); await selectProfileAssetIdentity(ctx.db, { profileId: f.s.profileId, assetId: id, placement: "profile_image", actorUserId: f.s.moderatorUserId, now: Date.now() }); });
    const fresh = await f.detail(); assert.equal(fresh.canProposePlacement, true);
    const args = { submissionId: f.intent.submissionId, expectedContributionVersion: fresh.contributionVersion, idempotencyKey: "occupied" };
    const receipt = mcp ? await f.t.mutation(internal.profileMediaSubmissions.proposePlacementForMcpActor, { ...args, ...await contributionAttestation(f) }) : await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, args);
    assert.equal(receipt.operationState, "committed");
    const reviewer = f.t.withIdentity(f.s.moderatorIdentity); const review = await reviewer.query(api.profileMediaSubmissions.reviewDetail, { submissionId: receipt.resourceId! }); assert.ok(review);
    assert.equal((await reviewer.mutation(api.profileMediaSubmissions.decideWithReceipt, { submissionId: receipt.resourceId!, expectedReviewVersion: review.reviewVersion, decision: "approve", privateReason: "Replacement checked", idempotencyKey: "approve" })).operationState, "committed");
  });
}
it("hidden fallback artwork leaves an empty replacement target", async () => {
  const f = await fixture(); await f.t.run(ctx => ctx.db.patch(f.s.profileId, { avatarImageUrl: "https://example.test/hidden.png", fieldVisibility: { avatarImageUrl: "private" } }));
  const d = await f.detail(); assert.equal(d.canProposePlacement, false);
  assert.equal((await f.actor.mutation(api.profileMediaSubmissions.proposePlacement, { submissionId: f.intent.submissionId, expectedContributionVersion: d.contributionVersion, idempotencyKey: "hidden-fallback" })).code, "primary_empty");
});
