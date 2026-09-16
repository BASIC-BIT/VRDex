import assert from "node:assert/strict";
import { it } from "node:test";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import { reviewDetailSchema } from "../../packages/api-contracts/src/media-review";
import { newClerkUserId } from "./_clerkTestIdentity";
import {
  modules,
  schema,
  NOW,
  seed,
  createAndUpload,
} from "./_mediaReviewFixture";
process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

it("projects and versions the automatic image used by the public profile", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const externalUserId = "usr_7023d326-083f-41fe-a3e9-27ea303b50c5";
  await t.run(async (ctx) => {
    await ctx.db.patch(seeded.profileId, {
      outboundLinks: [{
        type: "vrchat_profile",
        label: "VRChat",
        url: `https://vrchat.com/home/user/${externalUserId}`,
        source: "community_submitted",
      }],
    });
    await ctx.db.insert("profileLinkDestinations", {
      key: `vrchat_user:${externalUserId}`,
      kind: "vrchat_user",
      locator: externalUserId,
      provider: "vrchat",
      status: "resolved",
      artworkSourceUrl: "https://example.test/user-icon.png",
      artworkType: "user_icon",
      observedAt: 1,
    });
  });
  const actor = t.withIdentity(seeded.moderatorIdentity);
  const before = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(before);
  assert.match(before.currentAutomaticImageUrl ?? "", /size=512/);
  await t.run(async (ctx) => {
    const destination = await ctx.db.query("profileLinkDestinations").first();
    assert.ok(destination);
    await ctx.db.patch(destination._id, { observedAt: 2 });
  });
  const after = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(after);
  assert.notEqual(after.currentAutomaticImageUrl, before.currentAutomaticImageUrl);
  assert.notEqual(after.reviewVersion, before.reviewVersion);
});

it("projects owner evidence separately and rechecks revoked authority on replay", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const ownerId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      clerkUserId: newClerkUserId(),
      email: "owner@example.test",
      emailVerificationTime: NOW,
    });
    await ctx.db.patch(seeded.profileId, { claimState: "claimed_verified" });
    await ctx.db.insert("profileOwners", {
      profileId: seeded.profileId,
      userId: id,
      roleKey: "owner",
      state: "active",
      grantedAt: NOW,
      updatedAt: NOW,
    });
    return id;
  });
  const owner = await t.query(
    internal.profileMediaSubmissions.reviewDetailForMcpActor,
    {
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
      actorUserId: ownerId,
      submissionId: intent.submissionId,
    },
  );
  const admin = await t.query(
    internal.profileMediaSubmissions.reviewDetailForMcpActor,
    {
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
      actorUserId: seeded.moderatorUserId,
      submissionId: intent.submissionId,
    },
  );
  assert.ok(owner && admin);
  assert.equal(reviewDetailSchema.safeParse(owner).success, true);
  assert.equal(reviewDetailSchema.safeParse(admin).success, true);
  assert.equal("submitterEmail" in owner, false);
  assert.equal("privateReason" in owner, false);
  assert.equal(admin.submitterEmail, "contributor@example.test");
  assert.ok(owner.candidate.rendition);
  assert.equal("storageKey" in owner.candidate, false);
  const command = {
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
    actorUserId: ownerId,
    submissionId: intent.submissionId,
    expectedReviewVersion: owner.reviewVersion,
    decision: "reject" as const,
    privateReason: "Owner declined",
    publicReason: "Declined",
    idempotencyKey: "owner-decision",
  };
  assert.equal(
    (
      await t.mutation(
        internal.profileMediaSubmissions.decideForMcpActor,
        command,
      )
    ).operationState,
    "committed",
  );
  await assert.rejects(
    t.mutation(internal.profileMediaSubmissions.decideForMcpActor, {
      ...command,
      emailVerified: false,
      emailVerificationAttestedAt: Date.now(),
    }),
    /verified email/i,
  );
  await t.run(async (ctx) => {
    const ownership = await ctx.db.query("profileOwners").first();
    assert.ok(ownership);
    await ctx.db.delete(ownership._id);
  });
  await assert.rejects(
    t.mutation(internal.profileMediaSubmissions.decideForMcpActor, command),
    /access is required/,
  );
  await assert.rejects(
    t.query(internal.profileMediaSubmissions.candidateForMcpActor, {
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
      actorUserId: ownerId,
      submissionId: intent.submissionId,
    }),
    /access is required/,
  );
});
it("persists same-user refusal for a super admin", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  await t.run(async (ctx) => {
    const grant = await ctx.db.query("accountFeatureGrants").first();
    assert.ok(grant);
    await ctx.db.patch(grant._id, { userId: seeded.contributorUserId });
  });
  const actor = t.withIdentity(seeded.contributorIdentity);
  const detail = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(detail);
  const command = {
    submissionId: intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    decision: "approve" as const,
    privateReason: "Own upload",
    idempotencyKey: "self",
  };
  const receipt = await actor.mutation(
    api.profileMediaSubmissions.decideWithReceipt,
    command,
  );
  assert.equal(receipt.code, "self_review");
  assert.deepEqual(
    await actor.mutation(
      api.profileMediaSubmissions.decideWithReceipt,
      command,
    ),
    receipt,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.query("profileAssets").collect())).length,
    0,
  );
});
it("excludes expired rows before indexed pagination and refuses expired decisions", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const actor = t.withIdentity(seeded.moderatorIdentity);
  const detail = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(detail);
  await t.run((ctx) =>
    ctx.db.patch(intent.submissionId, { expiresAt: Date.now() - 1 }),
  );
  const page = await actor.query(api.profileMediaSubmissions.listForReview, {
    paginationOpts: { cursor: null, numItems: 1 },
  });
  assert.equal(page.page.length, 0);
  assert.equal(page.isDone, true);
  const receipt = await actor.mutation(
    api.profileMediaSubmissions.decideWithReceipt,
    {
      submissionId: intent.submissionId,
      expectedReviewVersion: detail.reviewVersion,
      decision: "approve",
      privateReason: "Expired",
      idempotencyKey: "expired",
    },
  );
  assert.equal(receipt.code, "expired");
});
it("startReview is advisory and concurrent reviewers create only one asset", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const actor = t.withIdentity(seeded.moderatorIdentity);
  const detail = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(detail);
  await actor.mutation(api.profileMediaSubmissions.startReview, {
    submissionId: intent.submissionId,
  });
  const anotherId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      clerkUserId: newClerkUserId(),
      email: "second@example.test",
    });
    const grant = await ctx.db.query("accountFeatureGrants").first();
    assert.ok(grant);
    await ctx.db.insert("accountFeatureGrants", {
      userId: id,
      feature: "super_admin",
      state: "active",
      grantedBy: grant.grantedBy,
      grantedAt: NOW,
      updatedAt: NOW,
    });
    return id;
  });
  const command = {
    submissionId: intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    decision: "approve" as const,
    privateReason: "Verified",
    idempotencyKey: "race",
  };
  const results = await Promise.all([
    actor.mutation(api.profileMediaSubmissions.decideWithReceipt, command),
    t.mutation(internal.profileMediaSubmissions.decideForMcpActor, {
      ...command,
      emailVerified: true,
      emailVerificationAttestedAt: Date.now(),
      actorUserId: anotherId,
    }),
  ]);
  assert.equal(
    results.filter((r) => r.operationState === "committed").length,
    1,
  );
  assert.equal(results.filter((r) => r.code === "already_decided").length, 1);
  assert.equal(
    (await t.run((ctx) => ctx.db.query("profileAssets").collect())).length,
    1,
  );
});

it("invalidates versions when candidate, placement or rebase evidence changes", async () => {
  for (const change of [
    "candidate",
    "placement",
    "rebase",
    "legacy-image",
  ] as const) {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    const actor = t.withIdentity(seeded.moderatorIdentity);
    const detail = await actor.query(api.profileMediaSubmissions.reviewDetail, {
      submissionId: intent.submissionId,
    });
    assert.ok(detail);
    await t.run(async (ctx) => {
      if (change === "candidate")
        await ctx.db.patch(intent.intentId, {
          contentSha256: "replaced-bytes",
        });
      if (change === "rebase")
        await ctx.db.patch(intent.submissionId, { reviewRevision: 1 });
      if (change === "legacy-image")
        await ctx.db.patch(seeded.profileId, {
          avatarImageUrl: "https://example.test/new.webp",
        });
      if (change === "placement") {
        const assetId = await ctx.db.insert("profileAssets", {
          profileId: seeded.profileId,
          storageKey: "stored/new.webp",
          mimeType: "image/webp",
          byteSize: 100,
          visibility: "public",
          source: "owner_authored",
          uploadedBy: {
            tokenIdentifier: "test:owner",
            issuer: "test",
            subject: "owner",
          },
          uploadedAt: NOW,
          state: "active",
          updatedAt: NOW,
        });
        await ctx.db.insert("profileAssetPlacements", {
          profileId: seeded.profileId,
          assetId,
          placement: "profile_image",
          position: 0,
          state: "active",
          updatedAt: NOW,
        });
      }
    });
    const receipt = await actor.mutation(
      api.profileMediaSubmissions.decideWithReceipt,
      {
        submissionId: intent.submissionId,
        expectedReviewVersion: detail.reviewVersion,
        decision: "approve",
        privateReason: "Check changed evidence",
        idempotencyKey: change,
      },
    );
    assert.equal(receipt.code, "review_changed", change);
    assert.equal(
      (await t.run((ctx) => ctx.db.get(intent.submissionId)))?.status,
      "submitted",
    );
  }
});

it("withdraws only the trusted actor's own submission and prevents approval afterward", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  assert.equal(
    await t.mutation(internal.profileMediaSubmissions.withdrawForMcpActor, {
      actorUserId: seeded.moderatorUserId,
      submissionId: intent.submissionId,
    }),
    false,
  );
  assert.equal(
    await t.mutation(internal.profileMediaSubmissions.withdrawForMcpActor, {
      actorUserId: seeded.contributorUserId,
      submissionId: intent.submissionId,
    }),
    true,
  );
  const actor = t.withIdentity(seeded.moderatorIdentity);
  const detail = await actor.query(api.profileMediaSubmissions.reviewDetail, {
    submissionId: intent.submissionId,
  });
  assert.ok(detail);
  const result = await actor.mutation(
    api.profileMediaSubmissions.decideWithReceipt,
    {
      submissionId: intent.submissionId,
      expectedReviewVersion: detail.reviewVersion,
      decision: "approve",
      privateReason: "Withdrawn",
      idempotencyKey: "withdrawn",
    },
  );
  assert.equal(result.code, "already_decided");
  assert.ok(
    (await t.run((ctx) => ctx.db.get(intent.submissionId)))?.blobDeleteAfter,
  );
});

it("refuses an unverified browser reviewer with active admin authority, including replay", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const reviewer = t.withIdentity(seeded.moderatorIdentity);
  const detail = await reviewer.query(
    api.profileMediaSubmissions.reviewDetail,
    { submissionId: intent.submissionId },
  );
  assert.ok(detail);
  const command = {
    submissionId: intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    decision: "reject" as const,
    privateReason: "Declined",
    publicReason: "Declined",
    idempotencyKey: "verification-lost",
  };
  await reviewer.mutation(
    api.profileMediaSubmissions.decideWithReceipt,
    command,
  );
  const unverified = t.withIdentity({
    ...seeded.moderatorIdentity,
    emailVerified: false,
  });
  await assert.rejects(
    unverified.mutation(api.profileMediaSubmissions.decideWithReceipt, command),
    /verified email/i,
  );
  await assert.rejects(
    unverified.query(api.profileMediaSubmissions.reviewDetail, {
      submissionId: intent.submissionId,
    }),
    /verified email/i,
  );
  await assert.rejects(
    unverified.query(api.profileMediaSubmissions.listForReview, {
      paginationOpts: { numItems: 40, cursor: null },
    }),
    /verified email/i,
  );
});

it("requires fresh trusted email verification for all MCP review surfaces and replay", async () => {
  const t = convexTest({ schema, modules });
  const seeded = await seed(t);
  const { intent } = await createAndUpload(t, seeded);
  const trusted = {
    actorUserId: seeded.moderatorUserId,
    emailVerified: true,
    emailVerificationAttestedAt: Date.now(),
  };
  const detail = await t.query(
    internal.profileMediaSubmissions.reviewDetailForMcpActor,
    { ...trusted, submissionId: intent.submissionId },
  );
  assert.ok(detail);
  const command = {
    ...trusted,
    submissionId: intent.submissionId,
    expectedReviewVersion: detail.reviewVersion,
    decision: "reject" as const,
    privateReason: "Declined",
    publicReason: "Declined",
    idempotencyKey: "mcp-verification",
  };
  const receipt = await t.mutation(
    internal.profileMediaSubmissions.decideForMcpActor,
    command,
  );
  for (const invalid of [
    { emailVerified: false, emailVerificationAttestedAt: Date.now() },
    { emailVerified: true, emailVerificationAttestedAt: Date.now() - 121_000 },
    { emailVerified: true, emailVerificationAttestedAt: Date.now() + 31_000 },
    { emailVerified: undefined, emailVerificationAttestedAt: undefined },
  ]) {
    const actor = { actorUserId: seeded.moderatorUserId, ...invalid };
    await assert.rejects(
      t.mutation(internal.profileMediaSubmissions.decideForMcpActor, {
        ...command,
        ...invalid,
      }),
      /verified email/i,
    );
    await assert.rejects(
      t.query(internal.profileMediaSubmissions.reviewDetailForMcpActor, {
        ...actor,
        submissionId: intent.submissionId,
      }),
      /verified email/i,
    );
    await assert.rejects(
      t.query(internal.profileMediaSubmissions.candidateForMcpActor, {
        ...actor,
        submissionId: intent.submissionId,
      }),
      /verified email/i,
    );
    await assert.rejects(
      t.query(internal.profileMediaSubmissions.listForReviewForMcpActor, {
        ...actor,
        paginationOpts: { numItems: 40, cursor: null },
      }),
      /verified email/i,
    );
  }
  assert.deepEqual(
    await t.mutation(internal.profileMediaSubmissions.decideForMcpActor, {
      ...command,
      emailVerificationAttestedAt: Date.now(),
    }),
    receipt,
  );
  await t.run((ctx) =>
    ctx.db.patch(seeded.moderatorUserId, {
      email: undefined,
      emailVerificationTime: undefined,
    }),
  );
  await assert.rejects(
    t.mutation(internal.profileMediaSubmissions.decideForMcpActor, {
      ...command,
      emailVerificationAttestedAt: Date.now(),
    }),
    /verified email/i,
  );
});
