import type {
  PublicMediaActor,
  PublicMediaHistoryEvent,
  PublicProfileMediaDetails,
} from "../packages/api-contracts/src/public-media-details";
import { PublicProfileMediaDetailsSchema } from "../packages/api-contracts/src/public-media-details";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import type { PublicProfileAsset } from "./_profileAssets";
import { sanitizeProfileAssetCreditUrl } from "./_profileAssets";
import { canReadProfile } from "./_profilePermissions";

export async function resolvePublicMediaActor(
  db: DatabaseReader,
  userId: Id<"users">,
): Promise<PublicMediaActor | null> {
  if (!(await db.get(userId))) return null;
  const ownerships = await db
    .query("profileOwners")
    .withIndex("by_userId_state", (q) =>
      q.eq("userId", userId).eq("state", "active"),
    )
    .take(11);
  if (ownerships.length > 10) return null;
  const eligible = new Map<Id<"profiles">, Doc<"profiles">>();
  for (const ownership of ownerships) {
    const profile = await db.get(ownership.profileId);
    if (profile?.profileType === "person" && canReadProfile("public", profile))
      eligible.set(profile._id, profile);
  }
  if (eligible.size !== 1) return null;
  const profile = eligible.values().next().value;
  return profile
    ? {
        displayName: profile.displayName,
        profileSlug: profile.slug,
        profileUrl: `/${profile.slug}`,
      }
    : null;
}

async function subjectUserId(
  db: DatabaseReader,
  subject: Doc<"profileAssets">["uploadedBy"],
): Promise<Id<"users"> | null> {
  if (subject.issuer === "vrdex:api") {
    const id = db.normalizeId("users", subject.subject);
    return id && (await db.get(id)) ? id : null;
  }
  // Only the configured Clerk issuer owns the clerkUserId namespace.
  if (
    !process.env.CLERK_JWT_ISSUER_DOMAIN ||
    subject.issuer !== process.env.CLERK_JWT_ISSUER_DOMAIN
  )
    return null;
  const users = await db
    .query("users")
    .withIndex("clerkUserId", (q) => q.eq("clerkUserId", subject.subject))
    .take(2);
  return users.length === 1 ? users[0]._id : null;
}

export async function projectPublicMediaDetails(
  db: DatabaseReader,
  input: {
    profile: Doc<"profiles">;
    asset: Doc<"profileAssets">;
    publicAsset: PublicProfileAsset;
  },
): Promise<PublicProfileMediaDetails> {
  const { profile, asset, publicAsset } = input;
  const cache = new Map<Id<"users">, Promise<PublicMediaActor | null>>();
  const actor = (id: Id<"users"> | null) => {
    if (id === null) return Promise.resolve(null);
    let result = cache.get(id);
    if (!result) {
      result = resolvePublicMediaActor(db, id);
      cache.set(id, result);
    }
    return result;
  };
  const candidate = asset.sourceSubmissionId
    ? await db.get(asset.sourceSubmissionId)
    : null;
  const submission =
    candidate &&
    candidate.profileId === profile._id &&
    candidate.approvedAssetId === asset._id &&
    candidate.requestKind !== "identity_placement" &&
    candidate.status === "approved"
      ? candidate
      : null;
  const uploaderId = submission
    ? submission.submitterUserId
    : asset.sourceSubmissionId
      ? null
      : await subjectUserId(db, asset.uploadedBy);
  const uploadedBy = await actor(uploaderId);
  const history: PublicMediaHistoryEvent[] = [
    { kind: "uploaded", at: asset.uploadedAt, actor: uploadedBy },
  ];
  if (submission?.publicationMethod) {
    if (submission.publicationMethod === "independent_review") {
      history.push({
        kind: "approved",
        at: submission.reviewedAt ?? null,
        actor: await actor(
          submission.reviewer
            ? await subjectUserId(db, submission.reviewer)
            : null,
        ),
      });
    }
    let publishedAt: number | null = null;
    const operationId = submission.publicationOperationId;
    if (operationId && submission.publicationActorUserId) {
      const receipts = await db
        .query("mediaReviewReceipts")
        .withIndex("by_submissionId_operationId", (q) =>
          q
            .eq("submissionId", submission._id)
            .eq("receipt.operationId", operationId),
        )
        .take(2);
      const receipt = receipts.length === 1 ? receipts[0] : null;
      if (
        receipt?.receipt.operationState === "committed" &&
        receipt.actorUserId === submission.publicationActorUserId
      )
        publishedAt = receipt.createdAt;
    }
    history.push({
      kind: "published",
      at: publishedAt,
      actor: await actor(submission.publicationActorUserId ?? null),
    });
  }
  let referenceUrl: string | null = null;
  try {
    referenceUrl = sanitizeProfileAssetCreditUrl(publicAsset.creditUrl) ?? null;
  } catch {
    // Invalid legacy references do not make private provenance a public fallback.
  }
  const { creditUrl: _creditUrl, ...assetWithoutReference } = publicAsset;
  return PublicProfileMediaDetailsSchema.parse({
    profileSlug: profile.slug,
    asset: {
      ...assetWithoutReference,
      ...(referenceUrl ? { creditUrl: referenceUrl } : {}),
    },
    referenceUrl,
    credit: publicAsset.credit ?? null,
    uploadedBy,
    history,
  });
}
