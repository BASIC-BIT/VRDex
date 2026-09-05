import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getProfileBySlug } from "./_profileSlugs";

// Deliberately pinned: this fixture has no production override.
const STAGING_URL = "https://scrupulous-corgi-247.convex.cloud";
const fixtureArgs = {
  secret: v.string(),
  runId: v.string(),
  profileId: v.id("profiles"),
};

function guard(secret: string) {
  if (
    process.env.CONVEX_CLOUD_URL !== STAGING_URL ||
    process.env.VRDEX_ENABLE_E2E_HELPERS !== "true" ||
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true" ||
    !process.env.VRDEX_E2E_CONVEX_SECRET?.trim() ||
    secret !== process.env.VRDEX_E2E_CONVEX_SECRET.trim()
  ) {
    throw new Error("Staging media fixture is unavailable.");
  }
}

async function fixture(
  ctx: QueryCtx,
  args: { secret: string; runId: string; profileId: Id<"profiles"> },
) {
  guard(args.secret);
  if (!/^media-[a-z0-9-]{1,32}$/.test(args.runId))
    throw new Error("Invalid media run ID.");
  const profile = await ctx.db.get(args.profileId);
  if (
    !profile ||
    profile.profileType !== "person" ||
    profile.creationSource !== "community" ||
    profile.sourceAttribution?.submitter.tokenIdentifier !==
      `e2e:${args.runId}` ||
    profile.sourceAttribution.submitter.subject !== args.runId ||
    profile.sourceAttribution.submitter.issuer !== "vrdex:e2e"
  ) {
    throw new Error("Exact media fixture profile required.");
  }
  return profile;
}

async function rows(ctx: QueryCtx, profileId: Id<"profiles">) {
  const [intents, submissions, assets, placements, owners] = await Promise.all([
    ctx.db
      .query("profileAssetUploadIntents")
      .withIndex("by_targetProfileId_state_expiresAt", (q) =>
        q.eq("targetProfileId", profileId),
      )
      .take(21),
    ctx.db
      .query("profileMediaSubmissions")
      .withIndex("by_profileId_createdAt", (q) => q.eq("profileId", profileId))
      .take(21),
    ctx.db
      .query("profileAssets")
      .withIndex("by_profileId", (q) => q.eq("profileId", profileId))
      .take(21),
    ctx.db
      .query("profileAssetPlacements")
      .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId))
      .take(21),
    ctx.db
      .query("profileOwners")
      .withIndex("by_profileId_state", (q) => q.eq("profileId", profileId))
      .take(21),
  ]);
  if (
    [intents, submissions, assets, placements, owners].some(
      (list) => list.length > 20,
    )
  )
    throw new Error("Media fixture bound exceeded.");
  return { intents, submissions, assets, placements, owners };
}

export const findFixture = internalQuery({
  args: { secret: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    guard(args.secret);
    if (!/^media-[a-z0-9-]{1,32}$/.test(args.runId))
      throw new Error("Invalid media run ID.");
    const profile = await getProfileBySlug(ctx.db, `media-test-${args.runId}`);
    if (profile === null) return { profileId: null };
    await fixture(ctx, { ...args, profileId: profile._id });
    return { profileId: profile._id };
  },
});

export const preflight = internalQuery({
  args: { secret: v.string() },
  handler: async (_ctx, args) => {
    guard(args.secret);
    if (
      process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" ||
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true"
    )
      throw new Error("Media fixture flags are unavailable.");
    return { ready: true };
  },
});

export const assignReviewOwner = internalMutation({
  args: { ...fixtureArgs, reviewerEmail: v.string() },
  handler: async (ctx, args) => {
    const profile = await fixture(ctx, args);
    if (
      args.reviewerEmail !== `${args.runId}-reviewer+clerk_test@e2e.vrdex.net`
    )
      throw new Error("Run-linked reviewer required.");
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.reviewerEmail))
      .unique();
    if (!user?.clerkUserId || user.emailVerificationTime === undefined)
      throw new Error("Verified fixture reviewer required.");
    const { owners, submissions } = await rows(ctx, profile._id);
    if (
      profile.claimState !== "unclaimed" ||
      owners.length ||
      profile.publicationState !== "published"
    )
      throw new Error("Unclaimed fixture required.");
    if (
      !submissions.some(
        (s) => s.status === "submitted" && s.submitterUserId !== user._id,
      )
    )
      throw new Error("A different contributor must submit first.");
    const now = Date.now();
    await ctx.db.insert("profileOwners", {
      profileId: profile._id,
      userId: user._id,
      roleKey: "owner",
      state: "active",
      grantedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(profile._id, {
      claimState: "claimed_unverified",
      claimedAt: now,
      updatedAt: now,
    });
    return { assigned: true };
  },
});

export const inspect = internalQuery({
  args: fixtureArgs,
  handler: async (ctx, args) => {
    await fixture(ctx, args);
    const data = await rows(ctx, args.profileId);
    return {
      counts: {
        intents: data.intents.length,
        submissions: data.submissions.length,
        assets: data.assets.length,
        placements: data.placements.length,
      },
      submissions: data.submissions.map((s) => ({
        id: s._id,
        status: s.status,
        approvedAssetId: s.approvedAssetId,
      })),
      assets: data.assets.map((a) => ({
        id: a._id,
        state: a.state,
        visibility: a.visibility,
        source: a.source,
      })),
      placements: data.placements.map((p) => ({
        assetId: p.assetId,
        placement: p.placement,
        state: p.state,
      })),
    };
  },
});

async function cleanupRows(
  ctx: QueryCtx,
  args: { secret: string; runId: string; profileId: Id<"profiles"> },
) {
  const profile = await fixture(ctx, args);
  const data = await rows(ctx, profile._id);
  // An expired DB lease does not fence the importer's captured S3 credentials
  // or object keys. Keep failed workers fail-closed until their storage work is
  // known to have stopped; age alone cannot make external deletion safe.
  if (
    data.intents.some((i) => i.processingToken !== undefined) ||
    data.submissions.some(
      (s) => s.blobCleanupToken !== undefined || s.legalHoldAt !== undefined,
    )
  )
    throw new Error("Media fixture has active storage work or a legal hold.");
  for (const submission of data.submissions) {
    const user = await ctx.db.get(submission.submitterUserId);
    if (user?.email !== `${args.runId}-contributor+clerk_test@e2e.vrdex.net`)
      throw new Error("Non-fixture contributor found.");
    if (
      submission.uploadIntentId &&
      !data.intents.some((i) => i._id === submission.uploadIntentId)
    )
      throw new Error("Unscoped fixture intent.");
  }
  for (const owner of data.owners) {
    const user = await ctx.db.get(owner.userId);
    if (user?.email !== `${args.runId}-reviewer+clerk_test@e2e.vrdex.net`)
      throw new Error("Non-fixture owner found.");
  }
  const keys = new Set<string>();
  // The DB relationship alone is insufficient: every object must also live
  // beneath the random upload token and creation date of a scoped intent.
  // Approved assets may reference only those exact recorded intent keys.
  for (const intent of data.intents) {
    if (
      intent.purpose !== "community_proposal" ||
      !data.submissions.some((s) => s.uploadIntentId === intent._id)
    )
      throw new Error("Non-proposal fixture intent.");
    const date = new Date(intent.createdAt).toISOString().slice(0, 10);
    const token = intent.uploadToken.slice(0, 24);
    if (!/^[a-zA-Z0-9_-]+$/.test(token))
      throw new Error("Invalid fixture storage token.");
    for (const key of [
      intent.storageKey,
      intent.quarantineStorageKey,
      intent.sourceStorageKey,
      intent.downloadStorageKey,
    ]) {
      if (!key) continue;
      if (
        key.includes("..") ||
        !(
          key.startsWith(`profile-assets/${date}/${token}/`) ||
          key.startsWith(`profile-assets/quarantine/${date}/${token}/`)
        )
      )
        throw new Error("Unscoped fixture storage key.");
      keys.add(key);
    }
  }
  for (const asset of data.assets) {
    if (
      ![
        asset.storageKey,
        asset.sourceStorageKey,
        asset.downloadStorageKey,
      ].every((key) => key === undefined || keys.has(key))
    )
      throw new Error("Unscoped fixture asset.");
  }
  if (
    data.placements.some((p) => !data.assets.some((a) => a._id === p.assetId))
  )
    throw new Error("Unscoped fixture placement.");
  const contributor = await ctx.db
    .query("users")
    .withIndex("email", (q) =>
      q.eq("email", `${args.runId}-contributor+clerk_test@e2e.vrdex.net`),
    )
    .unique();
  // Refusal receipts have no profile ID, so the exact disposable actor is the
  // boundary. Normal account cleanup does not remove this idempotency namespace.
  const refusalReceipts =
    contributor === null
      ? []
      : await ctx.db
          .query("mcpProfileMediaSubmissionRefusalReceipts")
          .withIndex("by_actor_client_key", (q) =>
            q.eq("actorUserId", contributor._id),
          )
          .take(21);
  if (refusalReceipts.length > 20)
    throw new Error("Media fixture receipt bound exceeded.");
  return { profile, ...data, refusalReceipts, storageKeys: [...keys].sort() };
}

export const prepareCleanup = internalMutation({
  args: fixtureArgs,
  handler: async (ctx, args) => {
    guard(args.secret);
    if (!/^media-[a-z0-9-]{1,32}$/.test(args.runId)) throw new Error("Invalid media run ID.");
    // A completed DELETE can lose its HTTP response. Absence is already the
    // desired terminal state; no object or unrelated row is touched on retry.
    if (await ctx.db.get(args.profileId) === null) {
      const remaining = await rows(ctx, args.profileId);
      if (Object.values(remaining).some((list) => list.length > 0)) {
        throw new Error("Missing fixture profile still has dependent rows.");
      }
      return { storageKeys: [], profileMissing: true };
    }
    const data = await cleanupRows(ctx, args);
    const now = Date.now();
    // Freeze new submissions and ordinary owner authority before any external IO.
    await ctx.db.patch(args.profileId, {
      publicationState: "draft_private",
      claimState: "unclaimed",
      updatedAt: now,
    });
    for (const owner of data.owners)
      await ctx.db.patch(owner._id, {
        state: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    for (const intent of data.intents)
      await ctx.db.patch(intent._id, {
        state: "expired",
        expiresAt: now - 1,
        updatedAt: now,
      });
    for (const submission of data.submissions)
      await ctx.db.patch(submission._id, {
        status: "withdrawn",
        blobDeleteAfter: undefined,
        expiresAt: now - 1,
        updatedAt: now,
      });
    return { storageKeys: data.storageKeys, profileMissing: false };
  },
});

export const finishCleanup = internalMutation({
  args: { ...fixtureArgs, deletedStorageKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const data = await cleanupRows(ctx, args);
    if (
      data.profile.publicationState !== "draft_private" ||
      data.owners.some((o) => o.state === "active") ||
      data.intents.some((i) => i.state !== "expired") ||
      JSON.stringify(data.storageKeys) !==
        JSON.stringify([...new Set(args.deletedStorageKeys)].sort())
    )
      throw new Error("Fixture cleanup changed or was not prepared.");
    for (const row of [
      ...data.placements,
      ...data.assets,
      ...data.submissions,
      ...data.intents,
      ...data.refusalReceipts,
    ])
      await ctx.db.delete(row._id);
    return { slug: data.profile.slug, deletedMedia: true };
  },
});
