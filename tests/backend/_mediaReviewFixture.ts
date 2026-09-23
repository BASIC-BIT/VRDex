import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schemaModule from "../../convex/schema";
import { newClerkUserId } from "./_clerkTestIdentity";
export const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/profileAssets.ts": () => import("../../convex/profileAssets"),
  "../../convex/profileMediaSubmissions.ts": () =>
    import("../../convex/profileMediaSubmissions"),
  "../../convex/mcpToolEvents.ts": () => import("../../convex/mcpToolEvents"),
};
export const schema =
  (schemaModule as unknown as { default?: typeof schemaModule }).default ??
  schemaModule;
export const NOW = Date.parse("2026-08-26T12:00:00.000Z");
export const FIRST_REVIEW_PAGE = {
  paginationOpts: { numItems: 40, cursor: null },
} as const;
export const TARGET_PROFILE_SNAPSHOT = {
  targetProfileSlug: "community-dj",
  targetProfileDisplayName: "Community DJ",
} as const;

export async function seed(
  t: ReturnType<typeof convexTest>,
  profileType: "person" | "community" = "person",
) {
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
      grantedBy: {
        tokenIdentifier: "test:operator",
        issuer: "test",
        subject: "operator",
      },
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

export async function createAndUpload(
  t: ReturnType<typeof convexTest>,
  seeded: Awaited<ReturnType<typeof seed>>,
  hash = "proposal-hash",
) {
  const intent = await t
    .withIdentity(seeded.contributorIdentity)
    .mutation(api.profileMediaSubmissions.createUploadIntent, {
      profileId: seeded.profileId,
      requestedPlacement:
        (await t.run((ctx) => ctx.db.get(seeded.profileId)))?.profileType ===
        "community"
          ? "primary_logo"
          : "profile_image",
      originalFileName: "artist.webp",
      mimeType: "image/webp",
      byteSize: 512,
      sourceUrl: "https://artist.example/press",
      altText: "Portrait of Community DJ.",
      credit: "Community DJ press kit",
      expectedProfileUpdatedAt: NOW,
    });
  const pendingSubmission = await t.run((ctx) =>
    ctx.db.get(intent.submissionId),
  );
  const processingToken = `processing-${crypto.randomUUID()}`;
  const claim = await t.mutation(
    internal.profileAssets.claimUploadIntentForStorage,
    {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
    },
  );
  assert.equal(claim.status, "claimed");
  const completed = await t.mutation(
    internal.profileAssets.markUploadIntentUploaded,
    {
      intentId: intent.intentId,
      uploadToken: intent.uploadToken,
      processingToken,
      mimeType: "image/webp",
      byteSize: 512,
      contentSha256: hash,
      width: 800,
      height: 800,
    },
  );
  return { intent, completed, pendingExpiresAt: pendingSubmission?.expiresAt };
}
