/** Local-only transactional workflow with real PNG decoding and injected object storage. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { convexTest } from "convex-test";
import { api, internal } from "../convex/_generated/api";
import {
  schema,
  modules as base,
  seed,
  NOW,
} from "../tests/backend/_mediaReviewFixture";
import { createMcpContributionHandlers } from "../apps/web/src/lib/server/mcp-contribution-batches";
import { createMcpMediaUploadHandlers } from "../apps/web/src/lib/server/mcp-media-upload";
import { profileAssetUploadChecksum } from "../apps/web/src/lib/server/profile-asset-storage";
if (
  process.env.CONVEX_DEPLOYMENT &&
  !process.env.CONVEX_DEPLOYMENT.startsWith("local:") &&
  !process.env.CONVEX_DEPLOYMENT.startsWith("anonymous:")
)
  throw new Error("POLICY_IDENTITY_DENIED");
Object.assign(process.env, {
  CONVEX_DEPLOYMENT: "local:contributor-capacity-proof",
  VRDEX_CONTRIBUTION_POLICY: "synthetic-v1",
  VRDEX_CONTRIBUTION_BATCHES_ENABLED: "true",
  VRDEX_CONTRIBUTION_UPLOADS_ENABLED: "true",
  VRDEX_MEDIA_UPLOAD_CLEANUP_READY: "true",
  VRDEX_MEDIA_CLEANUP_URL: "https://example.test/api/internal/media-cleanup",
  VRDEX_MEDIA_CLEANUP_TOKEN: "test",
  VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED: "true",
  VRDEX_PROFILE_MEDIA_KIT_ENABLED: "true",
});
async function main() {
  const modules = {
    ...base,
    "../../convex/contributionUploads.ts": () =>
      import("../convex/contributionUploads"),
    "../../convex/contributionBatches.ts": () =>
      import("../convex/contributionBatches"),
    "../../convex/contributionCapacity.ts": () =>
      import("../convex/contributionCapacity"),
  };
  const t = convexTest({ schema, modules }),
    s = await seed(t);
  let clock = Date.now();
  Date.now = () => clock;
  const profiles = await t.run(async (ctx) => {
    const { _id, _creationTime, ...profile } = (await ctx.db.get(s.profileId))!;
    const ids = [];
    for (let i = 0; i < 50; i++)
      ids.push(
        await ctx.db.insert("profiles", { ...profile, slug: `synthetic-${i}` }),
      );
    for (const feature of ["trusted_contributor", "trusted_publisher"] as const)
      await ctx.db.insert("accountFeatureGrants", {
        userId: s.contributorUserId,
        feature,
        state: "active",
        grantedBy: {
          issuer: "test",
          subject: "operator",
          tokenIdentifier: "test:operator",
        },
        grantedAt: clock,
        updatedAt: clock,
      });
    await ctx.db.insert("oauthAccessTokens", {
      tokenId: "synthetic",
      clientId: "synthetic",
      subjectType: "user",
      userId: s.contributorUserId,
      resource: "https://example.test/mcp",
      scopes: [
        "mcp:read",
        "mcp:write",
        "assets:contribute",
        "profile:contribute",
      ],
      status: "active",
      issuedAt: clock,
      expiresAt: clock + 86400000,
    });
    return ids;
  });
  const authority = async () => ({
    actorUserId: s.contributorUserId,
    oauthClientId: "synthetic",
    oauthTokenId: "synthetic",
    emailVerified: true,
    emailVerificationAttestedAt: clock,
  });
  const admin = { mutation: t.mutation.bind(t), query: t.query.bind(t) };
  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#7064db" },
  })
    .png()
    .toBuffer();
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  let fetches = 0;
  const uploads = createMcpMediaUploadHandlers({
    authority,
    admin,
    fetchSource: async () => {
      fetches++;
      return { body: png, mimeType: "image/png" };
    },
    target: async ({ storageKey }) => ({
      url: "https://synthetic.invalid/upload",
      fields: { key: storageKey },
    }),
    put: async ({ storageKey, body, contentType }) => {
      objects.set(storageKey, { body, contentType });
    },
    read: async (key) => objects.get(key) ?? null,
  });
  const call = createMcpContributionHandlers({ authority, admin, uploads });
  const batch = await call("create", {
    idempotencyKey: "mixed",
    label: "Synthetic collection",
  });
  assert.ok("batchId" in batch);
  const source = {
    description: "Synthetic artist fixture",
    publication: "public_allowed",
  };
  const items = [
    ...profiles.slice(0, 30).map((profileId, i) => ({
      kind: "profile_links",
      itemKey: `links-${i}`,
      source,
      profileId,
      expectedUpdatedAt: NOW,
      links: [{ type: "website", url: `https://example.test/artist-${i}` }],
    })),
    ...profiles.slice(30).map((profileId, i) => ({
      kind: "media",
      itemKey: `media-${i}`,
      source,
      profileId,
      expectedUpdatedAt: NOW,
      placement: "profile_image",
      transport: i < 10 ? "url" : "local",
      ...(i < 10 ? { sourceUrl: `https://example.test/image-${i}.png` } : {}),
      credit: "Synthetic artist",
      contentType: "image/png",
      byteLength: png.length,
      sha256: profileAssetUploadChecksum(png),
    })),
  ];
  await call("append", { batchId: batch.batchId, items });
  for (const item of items.slice(0, 30))
    assert.equal(
      (
        (await call("submit", {
          batchId: batch.batchId,
          itemKey: item.itemKey,
          expectedRevision: 1,
        })) as { operationState: string }
      ).operationState,
      "committed",
    );
  for (let i = 0; i < 20; i++) {
    const args = {
      batchId: batch.batchId,
      itemKey: `media-${i}`,
      expectedRevision: 1,
    };
    if (i < 10)
      assert.equal(
        ((await call("submit", args)) as { operationState: string })
          .operationState,
        "committed",
      );
    else {
      const { transport, ...request } = await t.mutation(
        internal.contributionBatches.mediaRequest,
        { ...(await authority()), ...args },
      );
      assert.equal(transport, "local");
      const target = await uploads.begin(request);
      assert.ok("transfer" in target);
      if (i === 10) {
        // Simulate loss of the client response/session after admission, before transfer.
        const recovered = await uploads.begin(request);
        assert.ok("transfer" in recovered);
        assert.equal(recovered.intentId, target.intentId);
        assert.equal(
          (await call("status", { operationId: target.intentId })).receipt
            .operationState,
          "in_progress",
        );
        await assert.rejects(
          uploads.begin({ ...request, sha256: "f".repeat(64) }),
          /BATCH_CONFLICT/,
        );
      }
      objects.set(target.transfer.fields.key, {
        body: png,
        contentType: "image/png",
      });
      assert.equal(
        (
          await uploads.complete({
            intentId: target.intentId,
            idempotencyKey: `complete-${i}`,
          })
        ).operationState,
        "committed",
      );
    }
    clock += 6000;
  }
  const submissions = await t.run((ctx) =>
    ctx.db.query("profileMediaSubmissions").collect(),
  );
  assert.equal(submissions.length, 20);
  for (let i = 0; i < 20; i++) {
    const submissionId = submissions[i]._id;
    if (i < 5) {
      const actor = t.withIdentity(s.contributorIdentity),
        detail = await actor.query(
          api.profileMediaSubmissions.publisherDetail,
          { submissionId },
        );
      assert.ok(detail);
      await actor.mutation(
        api.profileMediaSubmissions.declarePublicationEvidence,
        {
          submissionId,
          expectedReviewVersion: detail.reviewVersion,
          identityConfirmed: true,
          attributionConfirmed: true,
          publicationPermitted: true,
          noKnownRestrictions: true,
          idempotencyKey: `declare-${i}`,
        },
      );
      const fresh = await actor.query(
        api.profileMediaSubmissions.publisherDetail,
        { submissionId },
      );
      assert.ok(fresh);
      assert.equal(
        (
          await actor.mutation(api.profileMediaSubmissions.publish, {
            submissionId,
            expectedReviewVersion: fresh.reviewVersion,
            idempotencyKey: `publish-${i}`,
          })
        ).operationState,
        "committed",
      );
    } else {
      const reviewer = t.withIdentity(s.moderatorIdentity),
        detail = await reviewer.query(
          api.profileMediaSubmissions.reviewDetail,
          { submissionId },
        );
      assert.ok(detail);
      assert.equal(
        (
          await reviewer.mutation(
            api.profileMediaSubmissions.decideWithReceipt,
            {
              submissionId,
              expectedReviewVersion: detail.reviewVersion,
              decision: i === 19 ? "reject" : "approve",
              privateReason: "Synthetic fixture checked",
              ...(i === 19 ? { publicReason: "Synthetic test rejection" } : {}),
              idempotencyKey: `review-${i}`,
            },
          )
        ).operationState,
        "committed",
      );
    }
  }
  const capacity = await call("capacity", {});
  const previewKey = await t.run(async (ctx) => {
    const row = await ctx.db.get(submissions[0].uploadIntentId!);
    return row!.storageKey;
  });
  const preview = objects.get(previewKey)!.body;
  assert.equal((await sharp(preview).metadata()).width, 32);
  writeFileSync(
    ".superpowers/sdd/2026-09-12-contributor-upload-and-review/task-7-logs/stored-candidate.webp",
    preview,
  );
  console.log(
    JSON.stringify(
      {
        engine: "convex-test with real sharp decoding and injected Map storage",
        profileLinks: 30,
        media: 20,
        url: 10,
        local: 10,
        independentReviews: 15,
        independentApprovals: 14,
        rejections: 1,
        interruptedAdmissionsRecovered: 1,
        conflictingDeclarationsRefused: 1,
        trustedPublications: 5,
        sourceFetches: fetches,
        storedObjects: objects.size,
        capacity,
        hostedStorage: false,
        hostedClients: false,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
