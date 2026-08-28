import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { assertProfileAssetIntentCapacity } from "../../convex/_profileAssets";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";

process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED = "true";
process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED = "true";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profileMediaSubmissions.ts": () => import("../../convex/profileMediaSubmissions"),
};
const schema = (schemaModule as unknown as { default?: typeof schemaModule }).default ?? schemaModule;
const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const FIRST_REVIEW_PAGE = { paginationOpts: { numItems: 40, cursor: null } } as const;
const TARGET_PROFILE_SNAPSHOT = {
  targetProfileSlug: "community-dj",
  targetProfileDisplayName: "Community DJ",
} as const;

async function seed(t: ReturnType<typeof convexTest>, profileType: "person" | "community" = "person") {
  return await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("profiles", {
      profileType,
      slug: profileType === "person" ? "community-dj" : "community-club",
      displayName: profileType === "person" ? "Community DJ" : "Community Club",
      sortName: profileType === "person" ? "community dj" : "community club",
      aliases: [],
      tags: [],
      claimState: "unclaimed",
      publicationState: "published",
      publicSurfacingState: "public",
      creationSource: "community",
      ...(profileType === "person"
        ? { person: { roleTags: ["DJ"] } }
        : { community: { categoryTags: [] } }),
      updatedAt: NOW,
    });
    const contributorClerkId = newClerkUserId();
    const contributorUserId = await ctx.db.insert("users", {
      clerkUserId: contributorClerkId,
      email: "contributor@example.test",
      emailVerificationTime: NOW,
    });
    const moderatorClerkId = newClerkUserId();
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
      profileId,
      contributorUserId,
      moderatorUserId,
      contributorIdentity: {
        subject: contributorClerkId,
        email: "contributor@example.test",
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${contributorUserId}`,
      },
      moderatorIdentity: {
        subject: moderatorClerkId,
        email: "moderator@example.test",
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${moderatorUserId}`,
      },
    };
  });
}

async function createAndUpload(
  t: ReturnType<typeof convexTest>,
  seeded: Awaited<ReturnType<typeof seed>>,
  hash = "proposal-hash",
) {
  const intent = await t.withIdentity(seeded.contributorIdentity).mutation(
    api.profileMediaSubmissions.createUploadIntent,
    {
      profileId: seeded.profileId,
      requestedPlacement: "profile_image",
      originalFileName: "artist.webp",
      mimeType: "image/webp",
      byteSize: 512,
      sourceUrl: "https://artist.example/press",
      altText: "Portrait of Community DJ.",
      credit: "Community DJ press kit",
      expectedProfileUpdatedAt: NOW,
    },
  );
  const pendingSubmission = await t.run((ctx) => ctx.db.get(intent.submissionId));
  const processingToken = `processing-${crypto.randomUUID()}`;
  const claim = await t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
    intentId: intent.intentId,
    uploadToken: intent.uploadToken,
    processingToken,
  });
  assert.equal(claim.status, "claimed");
  const completed = await t.mutation(internal.profileAssets.markUploadIntentUploaded, {
    intentId: intent.intentId,
    uploadToken: intent.uploadToken,
    processingToken,
    mimeType: "image/webp",
    byteSize: 512,
    contentSha256: hash,
    width: 800,
    height: 800,
  });
  return { intent, completed, pendingExpiresAt: pendingSubmission?.expiresAt };
}

describe("unclaimed-profile media submissions", () => {
  it("does not revive a contribution withdrawn while its upload is processing", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const intent = await t.withIdentity(seeded.contributorIdentity).mutation(
      api.profileMediaSubmissions.createUploadIntent,
      {
        profileId: seeded.profileId,
        requestedPlacement: "profile_image",
        originalFileName: "artist.webp",
        mimeType: "image/webp",
        byteSize: 512,
        sourceUrl: "https://artist.example/press",
        credit: "Community DJ press kit",
        expectedProfileUpdatedAt: NOW,
      },
    );
    const processingToken = `processing-${crypto.randomUUID()}`;
    assert.equal(
      (
        await t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
          intentId: intent.intentId,
          uploadToken: intent.uploadToken,
          processingToken,
        })
      ).status,
      "claimed",
    );
    await t.withIdentity(seeded.contributorIdentity).mutation(
      api.profileMediaSubmissions.withdraw,
      { submissionId: intent.submissionId },
    );

    await assert.rejects(
      t.mutation(internal.profileAssets.markUploadIntentUploaded, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
        mimeType: "image/webp",
        byteSize: 512,
        contentSha256: "withdrawn-upload-hash",
        width: 800,
        height: 800,
      }),
      /no longer accepting this upload/i,
    );
    const stored = await t.run((ctx) => ctx.db.get(intent.submissionId));
    assert.equal(stored?.status, "withdrawn");
  });

  it("keeps a processed proposal private until a moderator approves it", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent, completed, pendingExpiresAt } = await createAndUpload(t, seeded);

    assert.deepEqual(completed.assetIds, []);
    const before = await t.run(async (ctx) => ({
      assets: await ctx.db.query("profileAssets").collect(),
      submission: await ctx.db.get(intent.submissionId),
    }));
    assert.equal(before.assets.length, 0);
    assert.equal(before.submission?.status, "submitted");
    assert.equal(before.submission?.contentSha256, "proposal-hash");
    assert.equal(pendingExpiresAt, intent.expiresAt);
    assert.ok((before.submission?.expiresAt ?? 0) - intent.expiresAt > 29 * 24 * 60 * 60 * 1_000);

    const queue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      FIRST_REVIEW_PAGE,
    );
    assert.equal(queue.page.length, 1);
    assert.equal(queue.page[0]?.profileDisplayName, "Community DJ");
    assert.equal(queue.page[0]?.submitterEmail, "contributor@example.test");
    assert.equal(queue.page[0]?.priorProposalCount, 0);
    assert.equal("privateReason" in (queue.page[0] ?? {}), false);
    const candidate = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.getCandidateForStorage,
      { submissionId: intent.submissionId },
    );
    assert.equal(candidate?.mimeType, "image/webp");
    assert.match(candidate?.storageKey ?? "", /profile-assets\//);

    const decision = await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.decide,
      {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        finalPlacement: "profile_image",
        label: "Reviewed portrait",
        altText: "Reviewed portrait of Community DJ.",
        credit: "Reviewed artist credit",
        creditUrl: "https://artist.example/credits",
        privateReason: "Official artist-controlled press source verified.",
      },
    );
    assert.equal(decision.status, "approved");
    const after = await t.run(async (ctx) => ({
      asset: await ctx.db.get(decision.assetId),
      placements: await ctx.db
        .query("profileAssetPlacements")
        .withIndex("by_profileId_state", (query) =>
          query.eq("profileId", seeded.profileId).eq("state", "active"),
        )
        .collect(),
      submission: await ctx.db.get(intent.submissionId),
    }));
    assert.equal(after.asset?.source, "community_submitted");
    assert.equal(after.asset?.visibility, "public");
    assert.equal(after.asset?.label, "Reviewed portrait");
    assert.equal(after.asset?.altText, "Reviewed portrait of Community DJ.");
    assert.equal(after.asset?.credit, "Reviewed artist credit");
    assert.equal(after.asset?.creditUrl, "https://artist.example/credits");
    assert.equal(after.placements[0]?.placement, "profile_image");
    assert.equal(after.submission?.approvedAssetId, decision.assetId);

    const publicProfile = await t.query(api.profileAssets.listPublicBySlug, {
      slug: "community-dj",
    });
    assert.equal(publicProfile?.mediaKit.profileImage?.assetId, decision.assetId);
    assert.notEqual(
      await t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );

    const unrelatedClerkId = newClerkUserId();
    const unrelatedUserId = await t.run((ctx) =>
      ctx.db.insert("users", {
        clerkUserId: unrelatedClerkId,
        email: "unrelated@example.test",
        emailVerificationTime: NOW,
      }),
    );
    await assert.rejects(
      t.withIdentity({
        subject: unrelatedClerkId,
        email: "unrelated@example.test",
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${unrelatedUserId}`,
      }).mutation(api.profileMediaSubmissions.suppressApprovedAsset, {
        submissionId: intent.submissionId,
        reason: "Trying to remove media without moderator access.",
      }),
      /super admin access is required/i,
    );

    const ownerClerkId = newClerkUserId();
    const ownerUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: ownerClerkId,
        email: "claiming-owner@example.test",
        emailVerificationTime: NOW,
      });
      await ctx.db.patch(seeded.profileId, {
        claimState: "claimed_verified",
        updatedAt: NOW + 1,
      });
      await ctx.db.insert("profileOwners", {
        profileId: seeded.profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      return userId;
    });
    const owner = t.withIdentity({
      subject: ownerClerkId,
      email: "claiming-owner@example.test",
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${ownerUserId}`,
    });
    const ownedProfiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(ownedProfiles?.[0]?.assets[0]?.source, "community_submitted");
    await owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
      profileId: seeded.profileId,
      assetId: decision.assetId,
      deleted: true,
    });
    assert.equal(
      await t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );
  });

  it("moves a submitted proposal into the browser review queue", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);

    assert.equal(
      await t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.startReview,
        { submissionId: intent.submissionId },
      ),
      true,
    );
    const queue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { status: "under_review", ...FIRST_REVIEW_PAGE },
    );
    assert.deepEqual(queue.page.map((row) => row.submissionId), [intent.submissionId]);
  });

  it("rejects a review decision after the proposal expires", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    await t.run((ctx) =>
      ctx.db.patch(intent.submissionId, { expiresAt: Date.now() - 1 }),
    );

    await assert.rejects(
      t.withIdentity(seeded.moderatorIdentity).mutation(api.profileMediaSubmissions.decide, {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "This should be too late.",
      }),
      /has expired/i,
    );
    assert.equal((await t.run((ctx) => ctx.db.query("profileAssets").collect())).length, 0);
  });

  it("does not let an unrelated contributor review or approve a proposal", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);

    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).query(api.profileMediaSubmissions.listForReview, {
        profileId: seeded.profileId,
        ...FIRST_REVIEW_PAGE,
      }),
      /review access is required/i,
    );
    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).query(
        api.profileMediaSubmissions.getCandidateForStorage,
        { submissionId: intent.submissionId },
      ),
      /review access is required/i,
    );
    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).mutation(api.profileMediaSubmissions.decide, {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "Trying to self-approve.",
      }),
      /review access is required/i,
    );
    await t.run((ctx) =>
      ctx.db.insert("accountFeatureGrants", {
        userId: seeded.contributorUserId,
        feature: "super_admin",
        state: "active",
        grantedBy: { tokenIdentifier: "test:operator", issuer: "test", subject: "operator" },
        grantedAt: NOW,
        updatedAt: NOW,
      }),
    );
    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).mutation(api.profileMediaSubmissions.decide, {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "Trying again with moderator access.",
      }),
      /cannot decide your own/i,
    );
  });

  it("lets a super admin suppress approved contributed media without erasing the audit trail", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    const decision = await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.decide,
      {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "Approved for the profile.",
      },
    );
    assert.equal(decision.status, "approved");
    const approvedQueue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { status: "approved", ...FIRST_REVIEW_PAGE },
    );
    assert.equal(approvedQueue.page[0]?.canSuppress, true);
    assert.notEqual(
      await t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );

    assert.deepEqual(
      await t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.suppressApprovedAsset,
        {
          submissionId: intent.submissionId,
          reason: "Disputed community contribution.",
        },
      ),
      { suppressed: true },
    );
    assert.equal(
      await t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: decision.assetId,
      }),
      null,
    );
    const ownerClerkId = newClerkUserId();
    const ownerUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: ownerClerkId,
        email: "owner-after-suppression@example.test",
        emailVerificationTime: NOW,
      });
      await ctx.db.patch(seeded.profileId, {
        claimState: "claimed_verified",
        updatedAt: NOW + 1,
      });
      await ctx.db.insert("profileOwners", {
        profileId: seeded.profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      return userId;
    });
    await assert.rejects(
      t.withIdentity({
        subject: ownerClerkId,
        email: "owner-after-suppression@example.test",
        emailVerified: true,
        issuer: "test",
        tokenIdentifier: `test|${ownerUserId}`,
      }).mutation(api.profileAssets.setOwnedAssetDeleted, {
        profileId: seeded.profileId,
        assetId: decision.assetId,
        deleted: false,
      }),
      /moderator-suppressed media cannot be restored/i,
    );
    const ownerInventory = await t.withIdentity({
      subject: ownerClerkId,
      email: "owner-after-suppression@example.test",
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${ownerUserId}`,
    }).query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.deepEqual(ownerInventory?.[0]?.assets, []);
    const audit = await t.run((ctx) =>
      ctx.db
        .query("profileAuditEvents")
        .withIndex("by_profileId_createdAt", (query) => query.eq("profileId", seeded.profileId))
        .collect(),
    );
    assert.equal(audit.at(-1)?.action, "profile_media_submission_asset_suppressed");
    assert.equal(audit.at(-1)?.note, "Disputed community contribution.");
  });

  it("scopes duplicate review evidence to the profile before applying its bound", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const now = Date.now();
    const targetSubmissionId = await t.run(async (ctx) => {
      const unrelatedProfileId = await ctx.db.insert("profiles", {
        profileType: "person",
        slug: "unrelated-dj",
        displayName: "Unrelated DJ",
        sortName: "unrelated dj",
        aliases: [],
        tags: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        person: { roleTags: ["DJ"] },
        updatedAt: NOW,
      });
      const insertSubmission = (profileId: Id<"profiles">, createdAt: number) =>
        ctx.db.insert("profileMediaSubmissions", {
          profileId,
          ...(profileId === seeded.profileId
            ? TARGET_PROFILE_SNAPSHOT
            : {
                targetProfileSlug: "unrelated-dj",
                targetProfileDisplayName: "Unrelated DJ",
              }),
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status: "submitted",
          targetProfileUpdatedAt: NOW,
          contentSha256: "widely-reused-hash",
          expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
          createdAt,
          updatedAt: createdAt,
        });
      for (let index = 0; index < 21; index += 1) {
        await insertSubmission(unrelatedProfileId, now - 30_000 + index);
      }
      await insertSubmission(seeded.profileId, now - 1_000);
      return await insertSubmission(seeded.profileId, now);
    });

    const queue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { profileId: seeded.profileId, ...FIRST_REVIEW_PAGE },
    );
    assert.equal(
      queue.page.find((row) => row.submissionId === targetSubmissionId)?.priorProposalCount,
      1,
    );
    assert.equal(
      queue.page.find((row) => row.submissionId === targetSubmissionId)?.priorProposalCountTruncated,
      false,
    );
  });

  it("marks saturated duplicate evidence instead of presenting a capped count as exact", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const now = Date.now();
    const targetSubmissionId = await t.run(async (ctx) => {
      const insertSubmission = (createdAt: number) =>
        ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status: "submitted" as const,
          targetProfileUpdatedAt: NOW,
          contentSha256: "saturated-hash",
          expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
          createdAt,
          updatedAt: createdAt,
        });
      for (let index = 0; index < 21; index += 1) {
        await insertSubmission(now - 30_000 + index);
      }
      return await insertSubmission(now);
    });

    const queue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { profileId: seeded.profileId, ...FIRST_REVIEW_PAGE },
    );
    const row = queue.page.find((candidate) => candidate.submissionId === targetSubmissionId);
    assert.equal(row?.priorProposalCount, 20);
    assert.equal(row?.priorProposalCountTruncated, true);
  });

  it("does not count later matching submissions as prior evidence", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const now = Date.now();
    const targetSubmissionId = await t.run(async (ctx) => {
      const insertSubmission = (createdAt: number) =>
        ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status: "submitted" as const,
          targetProfileUpdatedAt: NOW,
          contentSha256: "later-duplicates-hash",
          expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
          createdAt,
          updatedAt: createdAt,
        });
      const submissionId = await insertSubmission(now);
      for (let index = 0; index < 21; index += 1) {
        await insertSubmission(now + index + 1);
      }
      return submissionId;
    });

    const queue = await t.withIdentity(seeded.moderatorIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { profileId: seeded.profileId, ...FIRST_REVIEW_PAGE },
    );
    const row = queue.page.find((candidate) => candidate.submissionId === targetSubmissionId);
    assert.equal(row?.priorProposalCount, 0);
    assert.equal(row?.priorProposalCountTruncated, false);
  });

  it("lets the new owner decide a still-pending submission after claim", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    const ownerClerkId = newClerkUserId();
    const ownerUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: ownerClerkId,
        email: "owner@example.test",
        emailVerificationTime: NOW,
      });
      await ctx.db.patch(seeded.profileId, {
        claimState: "claimed_verified",
        updatedAt: NOW + 1,
      });
      await ctx.db.insert("profileOwners", {
        profileId: seeded.profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      return userId;
    });
    const ownerIdentity = {
      subject: ownerClerkId,
      email: "owner@example.test",
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${ownerUserId}`,
    };

    const queue = await t.withIdentity(ownerIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { profileId: seeded.profileId, ...FIRST_REVIEW_PAGE },
    );
    assert.equal(queue.page.length, 1);
    assert.equal("submitterEmail" in (queue.page[0] ?? {}), false);
    assert.equal("submitterTokenIdentifier" in (queue.page[0] ?? {}), false);
    assert.notEqual(
      await t.withIdentity(ownerIdentity).query(
        api.profileMediaSubmissions.getCandidateForStorage,
        { submissionId: intent.submissionId },
      ),
      null,
    );
    await t.withIdentity(ownerIdentity).mutation(api.profileMediaSubmissions.decide, {
      submissionId: intent.submissionId,
      decision: "reject",
      expectedProfileUpdatedAt: NOW + 1,
      publicDisposition: "Please coordinate directly with the profile owner.",
      privateReason: "Owner declined this community contribution.",
    });
    const rejectedQueue = await t.withIdentity(ownerIdentity).query(
      api.profileMediaSubmissions.listForReview,
      { profileId: seeded.profileId, status: "rejected", ...FIRST_REVIEW_PAGE },
    );
    assert.equal(rejectedQueue.page.length, 1);
    assert.equal(rejectedQueue.page[0]?.canViewCandidate, false);
    assert.equal("submitterEmail" in (rejectedQueue.page[0] ?? {}), false);
    assert.equal(
      await t.withIdentity(ownerIdentity).query(
        api.profileMediaSubmissions.getCandidateForStorage,
        { submissionId: intent.submissionId },
      ),
      null,
    );
    const mine = await t.withIdentity(seeded.contributorIdentity).query(
      api.profileMediaSubmissions.listMine,
      {},
    );
    assert.equal(mine[0]?.status, "rejected");
    assert.equal(mine[0]?.publicDisposition, "Please coordinate directly with the profile owner.");
    assert.equal("privateReason" in (mine[0] ?? {}), false);
  });

  it("returns up to forty contributions from one status", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 30; index += 1) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status: "approved",
          targetProfileUpdatedAt: NOW,
          expiresAt: NOW + 30 * 24 * 60 * 60 * 1_000,
          createdAt: NOW + index,
          updatedAt: NOW + index,
        });
      }
    });

    const mine = await t.withIdentity(seeded.contributorIdentity).query(
      api.profileMediaSubmissions.listMine,
      {},
    );
    assert.equal(mine.length, 30);
  });

  it("keeps the public target name shown at submission time after a private rename", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    await createAndUpload(t, seeded);
    await t.run((ctx) =>
      ctx.db.patch(seeded.profileId, {
        slug: "private-rename",
        displayName: "Private Rename",
        publicationState: "draft_private",
        publicSurfacingState: "suppressed",
        updatedAt: NOW + 1,
      }),
    );

    const mine = await t.withIdentity(seeded.contributorIdentity).query(
      api.profileMediaSubmissions.listMine,
      {},
    );
    assert.equal(mine[0]?.profileSlug, "community-dj");
    assert.equal(mine[0]?.profileDisplayName, "Community DJ");
    assert.equal(mine[0]?.profileIsPublic, false);
  });

  it("does not let approval replace a newer singleton placement", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    await t.run(async (ctx) => {
      const assetId = await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/owner/newer.webp",
        mimeType: "image/webp",
        byteSize: 512,
        contentSha256: "newer-owner-image",
        visibility: "public",
        source: "owner_authored",
        uploadedBy: {
          tokenIdentifier: "owner:newer-image",
          issuer: "test",
          subject: "owner",
        },
        uploadedAt: NOW + 1,
        state: "active",
        updatedAt: NOW + 1,
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId: seeded.profileId,
        assetId,
        placement: "profile_image",
        position: 0,
        state: "active",
        updatedAt: NOW + 1,
      });
    });

    await assert.rejects(
      t.withIdentity(seeded.moderatorIdentity).mutation(api.profileMediaSubmissions.decide, {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "Would replace newer owner media.",
      }),
      /media placement changed/i,
    );
  });

  it("retires the replaced singleton asset instead of exposing it as unplaced media", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const oldAssetId = await t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, {
        fieldVisibility: { avatarImageUrl: "private" },
      });
      const assetId = await ctx.db.insert("profileAssets", {
        profileId: seeded.profileId,
        storageKey: "profile-assets/community/old-private.webp",
        mimeType: "image/webp",
        byteSize: 512,
        contentSha256: "old-private-image",
        visibility: "public",
        source: "community_submitted",
        uploadedBy: {
          tokenIdentifier: "moderator:old-image",
          issuer: "test",
          subject: "moderator",
        },
        uploadedAt: NOW - 1,
        state: "active",
        updatedAt: NOW - 1,
      });
      await ctx.db.insert("profileAssetPlacements", {
        profileId: seeded.profileId,
        assetId,
        placement: "profile_image",
        position: 0,
        state: "active",
        updatedAt: NOW - 1,
      });
      return assetId;
    });
    const { intent } = await createAndUpload(t, seeded, "replacement-image");
    await t.run((ctx) =>
      ctx.db.patch(oldAssetId, {
        state: "deleted",
        deletedAt: NOW,
        updatedAt: NOW,
      }),
    );

    const decision = await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.decide,
      {
        submissionId: intent.submissionId,
        decision: "approve",
        expectedProfileUpdatedAt: NOW,
        privateReason: "Replacement approved.",
      },
    );
    assert.equal(decision.status, "approved");
    const retiredAsset = await t.run((ctx) => ctx.db.get(oldAssetId));
    assert.equal(retiredAsset?.state, "deleted");
    assert.equal(retiredAsset?.retiredAt !== undefined, true);
    assert.equal(
      await t.query(api.profileAssets.getPublicAssetForStorage, {
        slug: "community-dj",
        assetId: oldAssetId,
      }),
      null,
    );

    const ownerClerkId = newClerkUserId();
    const ownerUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkUserId: ownerClerkId,
        email: "owner@example.test",
        emailVerificationTime: NOW,
      });
      await ctx.db.patch(seeded.profileId, { claimState: "claimed_verified", updatedAt: NOW + 1 });
      await ctx.db.insert("profileOwners", {
        profileId: seeded.profileId,
        userId,
        roleKey: "owner",
        state: "active",
        grantedAt: NOW + 1,
        updatedAt: NOW + 1,
      });
      return userId;
    });
    const owner = t.withIdentity({
      subject: ownerClerkId,
      email: "owner@example.test",
      emailVerified: true,
      issuer: "test",
      tokenIdentifier: `test|${ownerUserId}`,
    });
    const ownedProfiles = await owner.query(api.profileAssets.listOwnedMediaKitProfiles, {});
    assert.equal(
      ownedProfiles?.[0]?.assets.some((asset) => asset.assetId === oldAssetId),
      false,
    );
    await assert.rejects(
      owner.mutation(api.profileAssets.setOwnedAssetDeleted, {
        profileId: seeded.profileId,
        assetId: oldAssetId,
        deleted: false,
      }),
      /not found/i,
    );
  });

  it("approves a singleton replacement when the profile already has twelve active assets", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 12; index += 1) {
        const assetId = await ctx.db.insert("profileAssets", {
          profileId: seeded.profileId,
          storageKey: `profile-assets/existing-${index}.webp`,
          mimeType: "image/webp",
          byteSize: 512,
          contentSha256: `existing-${index}`,
          visibility: "public",
          source: "community_submitted",
          uploadedBy: { tokenIdentifier: "test:moderator", issuer: "test", subject: "moderator" },
          uploadedAt: NOW - 1,
          state: "active",
          updatedAt: NOW - 1,
        });
        if (index === 0) {
          await ctx.db.insert("profileAssetPlacements", {
            profileId: seeded.profileId,
            assetId,
            placement: "profile_image",
            position: 0,
            state: "active",
            updatedAt: NOW - 1,
          });
        }
      }
    });
    const { intent } = await createAndUpload(t, seeded, "twelfth-slot-replacement");

    await t.withIdentity(seeded.moderatorIdentity).mutation(api.profileMediaSubmissions.decide, {
      submissionId: intent.submissionId,
      decision: "approve",
      expectedProfileUpdatedAt: NOW,
      privateReason: "Replacement approved.",
    });

    const activeAssets = await t.run((ctx) =>
      ctx.db
        .query("profileAssets")
        .withIndex("by_profileId_state_visibility", (query) =>
          query.eq("profileId", seeded.profileId).eq("state", "active").eq("visibility", "public"),
        )
        .collect(),
    );
    assert.equal(activeAssets.length, 12);
  });

  it("cleans terminal candidate files after retention and skips a legal hold", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    await t.withIdentity(seeded.contributorIdentity).mutation(
      api.profileMediaSubmissions.withdraw,
      { submissionId: intent.submissionId },
    );
    await t.run((ctx) =>
      ctx.db.patch(intent.submissionId, { blobDeleteAfter: Date.now() - 1 }),
    );
    await t.run(async (ctx) => {
      for (let index = 0; index < 200; index += 1) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: `https://artist.example/cleanup-blocker-${index}`,
          credit: "Artist",
          status: "withdrawn",
          targetProfileUpdatedAt: NOW,
          expiresAt: Date.now() - 86_400_000,
          blobDeleteAfter: Date.now() - 60_000,
          ...(index < 100
            ? { blobDeletedAt: Date.now() - 30_000 }
            : { legalHoldAt: Date.now() - 30_000 }),
          createdAt: NOW - index,
          updatedAt: NOW - index,
        });
      }
      for (let index = 0; index < 201; index += 1) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: `https://artist.example/published-${index}`,
          credit: "Artist",
          status: "approved",
          targetProfileUpdatedAt: NOW,
          expiresAt: Date.now() + 86_400_000,
          createdAt: NOW + index,
          updatedAt: NOW + index,
        });
      }
    });
    const protectedSubmissionId = await t.run((ctx) =>
      ctx.db.insert("profileMediaSubmissions", {
        profileId: seeded.profileId,
        ...TARGET_PROFILE_SNAPSHOT,
        submitterUserId: seeded.contributorUserId,
        submitter: {
          tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
          issuer: seeded.contributorIdentity.issuer,
          subject: seeded.contributorIdentity.subject,
        },
        requestedPlacement: "profile_image",
        sourceUrl: "https://artist.example/new",
        credit: "Artist",
        status: "submitted",
        targetProfileUpdatedAt: NOW,
        expiresAt: Date.now() + 86_400_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.setBlobLegalHold,
      {
        submissionId: intent.submissionId,
        held: true,
        reason: "Dispute under review.",
      },
    );
    assert.deepEqual(
      await t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.prepareDueBlobCleanup,
        {},
      ),
      [],
    );
    await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.setBlobLegalHold,
      {
        submissionId: intent.submissionId,
        held: false,
        reason: "Dispute resolved.",
      },
    );
    const due = await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.prepareDueBlobCleanup,
      {},
    );
    assert.equal(due[0]?.submissionId, intent.submissionId);
    assert.match(due[0]?.storageKeys[0] ?? "", /profile-assets\//);
    assert.equal(typeof due[0]?.cleanupToken, "string");
    const retriedDue = await t.withIdentity(seeded.moderatorIdentity).mutation(
      api.profileMediaSubmissions.prepareDueBlobCleanup,
      {},
    );
    assert.equal(retriedDue[0]?.cleanupToken, due[0]?.cleanupToken);
    await assert.rejects(
      t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.setBlobLegalHold,
        {
          submissionId: intent.submissionId,
          held: true,
          reason: "Too late to hold this reserved cleanup.",
        },
      ),
      /cleanup is already in progress/i,
    );
    assert.deepEqual(
      await t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.markBlobCleanupComplete,
        {
          items: [{ submissionId: intent.submissionId, cleanupToken: "wrong-token" }],
        },
      ),
      { completed: 0 },
    );
    assert.deepEqual(
      await t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.markBlobCleanupComplete,
        {
          items: [{
            submissionId: intent.submissionId,
            cleanupToken: due[0]!.cleanupToken,
          }],
        },
      ),
      { completed: 1 },
    );
    const stored = await t.run((ctx) => ctx.db.get(intent.submissionId));
    assert.equal(typeof stored?.blobDeletedAt, "number");
    assert.equal(stored?.blobDeleteAfter, undefined);
    assert.equal(stored?.blobCleanupToken, undefined);
    const protectedSubmission = await t.run((ctx) => ctx.db.get(protectedSubmissionId));
    assert.equal(protectedSubmission?.blobDeletedAt, undefined);
    await assert.rejects(
      t.withIdentity(seeded.moderatorIdentity).mutation(
        api.profileMediaSubmissions.setBlobLegalHold,
        {
          submissionId: intent.submissionId,
          held: true,
          reason: "The file is already gone.",
        },
      ),
      /already been deleted/i,
    );
  });

  it("returns structured errors for recoverable contribution validation", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const base = {
      profileId: seeded.profileId,
      requestedPlacement: "profile_image" as const,
      originalFileName: "artist.webp",
      mimeType: "image/webp",
      byteSize: 512,
      sourceUrl: "https://artist.example/press",
      credit: "Artist press kit",
      expectedProfileUpdatedAt: NOW,
    };
    await assert.rejects(
      t.withIdentity({ ...seeded.contributorIdentity, emailVerified: false }).mutation(
        api.profileMediaSubmissions.createUploadIntent,
        base,
      ),
      (error) => {
        assert.ok(error instanceof ConvexError);
        assert.equal((error.data as { code?: string }).code, "MEDIA_EMAIL_UNVERIFIED");
        return true;
      },
    );
    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).mutation(
        api.profileMediaSubmissions.createUploadIntent,
        { ...base, expectedProfileUpdatedAt: NOW - 1 },
      ),
      (error) => {
        assert.ok(error instanceof ConvexError);
        assert.equal((error.data as { code?: string }).code, "MEDIA_PROFILE_CHANGED");
        return true;
      },
    );
    await t.run((ctx) => ctx.db.patch(seeded.profileId, { claimState: "claimed_verified" }));
    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).mutation(
        api.profileMediaSubmissions.createUploadIntent,
        base,
      ),
      (error) => {
        assert.ok(error instanceof ConvexError);
        assert.equal((error.data as { code?: string }).code, "MEDIA_TARGET_CLAIMED");
        return true;
      },
    );
  });

  it("does not count expired proposals against open submission slots", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: `https://artist.example/expired-${index}`,
          credit: "Artist",
          status: "upload_pending",
          targetProfileUpdatedAt: NOW,
          expiresAt: Date.now() - 1,
          createdAt: NOW - index,
          updatedAt: NOW - index,
        });
      }
    });

    const created = await t.withIdentity(seeded.contributorIdentity).mutation(
      api.profileMediaSubmissions.createUploadIntent,
      {
        profileId: seeded.profileId,
        requestedPlacement: "profile_image",
        originalFileName: "fresh.webp",
        mimeType: "image/webp",
        byteSize: 512,
        sourceUrl: "https://artist.example/fresh",
        credit: "Artist",
        expectedProfileUpdatedAt: NOW,
      },
    );
    assert.equal(typeof created.submissionId, "string");
  });

  it("bounds repeated submissions even after earlier rows are withdrawn", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let index = 0; index < 6; index += 1) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status: "withdrawn",
          targetProfileUpdatedAt: NOW,
          expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
          createdAt: now - index * 1_000,
          updatedAt: now - index * 1_000,
        });
      }
    });

    await assert.rejects(
      t.withIdentity(seeded.contributorIdentity).mutation(
        api.profileMediaSubmissions.createUploadIntent,
        {
          profileId: seeded.profileId,
          requestedPlacement: "profile_image",
          originalFileName: "artist.webp",
          mimeType: "image/webp",
          byteSize: 512,
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          expectedProfileUpdatedAt: NOW,
        },
      ),
      /could not be submitted/i,
    );
  });

  it("finds a live duplicate after older terminal rows with the same hash", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const status of ["rejected", "withdrawn", "submitted"] as const) {
        await ctx.db.insert("profileMediaSubmissions", {
          profileId: seeded.profileId,
          ...TARGET_PROFILE_SNAPSHOT,
          submitterUserId: seeded.contributorUserId,
          submitter: {
            tokenIdentifier: seeded.contributorIdentity.tokenIdentifier,
            issuer: seeded.contributorIdentity.issuer,
            subject: seeded.contributorIdentity.subject,
          },
          requestedPlacement: "profile_image",
          sourceUrl: "https://artist.example/press",
          credit: "Artist press kit",
          status,
          targetProfileUpdatedAt: NOW,
          contentSha256: "reused-hash",
          expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
          createdAt: now - 60_000,
          updatedAt: now - 60_000,
        });
      }
    });
    const intent = await t.withIdentity(seeded.contributorIdentity).mutation(
      api.profileMediaSubmissions.createUploadIntent,
      {
        profileId: seeded.profileId,
        requestedPlacement: "profile_image",
        originalFileName: "duplicate.webp",
        mimeType: "image/webp",
        byteSize: 512,
        sourceUrl: "https://artist.example/press",
        credit: "Artist press kit",
        expectedProfileUpdatedAt: NOW,
      },
    );
    const processingToken = `processing-${crypto.randomUUID()}`;
    await t.mutation(internal.profileAssets.claimUploadIntentForStorage, {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
    });

    await assert.rejects(
      t.mutation(internal.profileAssets.markUploadIntentUploaded, {
        intentId: intent.intentId,
        uploadToken: intent.uploadToken,
        processingToken,
        mimeType: "image/webp",
        byteSize: 512,
        contentSha256: "reused-hash",
        width: 800,
        height: 800,
      }),
      /already proposed/i,
    );
  });

  it("cannot attach a purpose-bound proposal through the ordinary asset consumer", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    const { intent } = await createAndUpload(t, seeded);
    const storedIntent = await t.run((ctx) => ctx.db.get(intent.intentId));
    assert(storedIntent !== null);

    await assert.rejects(
      t.run(async (ctx) => {
        const { consumeProfileAssetUploads } = await import("../../convex/_profileAssets");
        await consumeProfileAssetUploads(ctx.db, {
          profileId: seeded.profileId,
          requestedBy: storedIntent.requestedBy,
          uploads: [{
            intentId: intent.intentId as Id<"profileAssetUploadIntents">,
            uploadToken: intent.uploadToken,
            placements: ["profile_image"],
          }],
          source: "community_submitted",
          now: NOW,
        });
      }),
      /requires an approved submission/i,
    );
  });

  it("does not reserve owner capacity for pending community proposals", async () => {
    const t = convexTest({ schema, modules });
    const seeded = await seed(t);
    await t.withIdentity(seeded.contributorIdentity).mutation(api.profileMediaSubmissions.createUploadIntent, {
      profileId: seeded.profileId,
      requestedPlacement: "profile_image",
      originalFileName: "proposal.webp",
      mimeType: "image/webp",
      byteSize: 512,
      sourceUrl: "https://artist.example/press",
      credit: "Artist press kit",
      expectedProfileUpdatedAt: NOW,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.profileId, { claimState: "claimed_verified" });
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("profileAssets", {
          profileId: seeded.profileId,
          storageKey: `profile-assets/claimed-${index}.webp`,
          mimeType: "image/webp",
          byteSize: 512,
          visibility: "public",
          source: "owner_authored",
          uploadedBy: { tokenIdentifier: "test:owner", issuer: "test", subject: "owner" },
          uploadedAt: NOW,
          state: "active",
          updatedAt: NOW,
        });
      }
      await assertProfileAssetIntentCapacity(ctx.db, seeded.profileId, Date.now(), 0);
    });
  });
});
