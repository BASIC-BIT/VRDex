import { isProfileFieldVisible } from "./_profileFieldVisibility";
import { queueProfileLinkDestinations } from "./_profileLinkDestinationCache";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getProfileBySlug } from "./_profileSlugs";
import { changeContributionCharge, localUploadModes } from "./_contributionCapacity";
import { failReservation } from "./contributionUploads";

// Deliberately pinned: this fixture has no production override.
const STAGING_URL = "https://scrupulous-corgi-247.convex.cloud";
// The S3 POST policy can outlive the Convex intent by clock skew.
const SIGNED_TRANSFER_SKEW_MS = 60_000;
function signedTransferSafeAfter(intents: { issuer?: string; expiresAt: number }[]) {
  return intents.reduce((safeAfter, intent) => intent.issuer === "mcp_local"
    ? Math.max(safeAfter, intent.expiresAt + SIGNED_TRANSFER_SKEW_MS) : safeAfter, 0);
}
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
  const reservations = (await Promise.all(intents.map((intent) => ctx.db
    .query("contributionUploadReservations")
    .withIndex("by_intentId", (q) => q.eq("intentId", intent._id))
    .unique()))).filter((row) => row !== null);
  return { intents, submissions, assets, placements, owners, reservations };
}

function pendingFixtureUpload(data: Awaited<ReturnType<typeof rows>>,
  row: (Awaited<ReturnType<typeof rows>>)["reservations"][number]) {
  return row.state === "pending" && row.processing &&
    row.processingToken === undefined && row.signingToken === undefined &&
    row.cleanupToken === undefined && row.cleanupLeaseUntil === undefined &&
    data.intents.some((intent) => intent._id === row.intentId && intent.issuer === "mcp_local");
}

function committedUploadWithLegacyToken(data: Awaited<ReturnType<typeof rows>>,
  row: (Awaited<ReturnType<typeof rows>>)["reservations"][number]) {
  return row.state === "committed" && !row.processing &&
    row.receipt?.operationState === "committed" &&
    row.receipt.operationId === String(row.intentId) &&
    data.intents.some((intent) => intent._id === row.intentId && intent.processingToken === undefined);
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
  args: { secret: v.string(), cleanupOnly: v.optional(v.boolean()) },
  handler: async (_ctx, args) => {
    guard(args.secret);
    if (
      process.env.VRDEX_PROFILE_MEDIA_SUBMISSIONS_ENABLED !== "true" ||
      process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED !== "true" ||
      (!args.cleanupOnly && !localUploadModes().contributor) ||
      process.env.VRDEX_CONTRIBUTION_INTAKE_PAUSED === "true"
    )
      throw new Error("Media fixture flags are unavailable.");
    return { ready: true };
  },
});

// Exercise retention cleanup with one rejected, run-linked URL import. This
// staging fixture changes only the deadline, never the production policy.
export const makeRejectedFixtureDue = internalMutation({
  args: { ...fixtureArgs, submissionId: v.id("profileMediaSubmissions") },
  handler: async (ctx, args) => {
    const data = await cleanupRows(ctx, args);
    const submission = data.submissions.find((row) => row._id === args.submissionId);
    const intent = data.intents.find((row) => row._id === submission?.uploadIntentId);
    const reservation = data.reservations.find((row) => row.intentId === intent?._id);
    if (
      data.submissions.length !== 1 ||
      data.intents.length !== 1 ||
      submission?.status !== "rejected" ||
      submission.blobDeletedAt !== undefined ||
      submission.blobCleanupToken !== undefined ||
      submission.blobDeleteAfter === undefined ||
      submission.blobDeleteAfter <= Date.now() ||
      !intent ||
      intent.issuer !== undefined ||
      intent.state !== "uploaded" || // Rejected URL proposals retain their uploaded intent.
      intent.originalFileName !== undefined ||
      intent.targetProfileId !== args.profileId ||
      intent.targetSubmissionId !== submission._id ||
      intent.mcpActorUserId !== submission.submitterUserId ||
      intent.mcpIdempotencyKeyHash === undefined ||
      intent.sourceUrl === undefined ||
      intent.sourceUrl !== submission.sourceUrl ||
      intent.requestedBy.issuer !== "vrdex:api" ||
      reservation?.state !== "committed" ||
      !intent.quarantineStorageKey ||
      data.storageKeys.length === 0
    ) throw new Error("Exact rejected URL fixture required.");
    await ctx.db.patch(submission._id, { blobDeleteAfter: Date.now() - 1 });
    return { storageKeys: data.storageKeys };
  },
});

export const inspectRejectedFixtureDeletion = internalQuery({
  args: { ...fixtureArgs, submissionId: v.id("profileMediaSubmissions") },
  handler: async (ctx, args) => {
    const data = await cleanupRows(ctx, args);
    const submission = data.submissions.find((row) => row._id === args.submissionId);
    if (data.submissions.length !== 1 || !submission || submission.status !== "rejected")
      throw new Error("Exact rejected URL fixture required.");
    return { blobDeleted: submission.blobDeletedAt !== undefined,
      storageKeys: data.storageKeys };
  },
});

// Advance only a signed, abandoned local transfer after its S3 POST can no
// longer be replayed. The worker must reclaim its object and capacity.
export const makePendingFixtureDue = internalMutation({
  args: { ...fixtureArgs, intentId: v.id("profileAssetUploadIntents") },
  handler: async (ctx, args) => {
    const data = await cleanupRows(ctx, args, true);
    const intent = data.intents.find((row) => row._id === args.intentId);
    const reservation = data.reservations.find((row) => row.intentId === args.intentId);
    const submission = data.submissions.find((row) => row.uploadIntentId === args.intentId);
    const now = Date.now();
    if (data.intents.length !== 1 || data.reservations.length !== 1 ||
      data.submissions.length !== 1 || !intent || !reservation || !submission ||
      intent.issuer !== "mcp_local" || intent.state !== "pending" ||
      intent.targetProfileId !== args.profileId || intent.targetSubmissionId !== submission._id ||
      submission.sourceKind !== "local" ||
      !(submission.status === "upload_pending" ||
        (submission.status === "superseded" && submission.expiresAt < now &&
          submission.blobDeletedAt === undefined && submission.blobDeleteAfter !== undefined)) ||
      !pendingFixtureUpload(data, reservation) ||
      reservation.expiresAt !== intent.expiresAt ||
      reservation.cleanupAfter !== intent.expiresAt + 24 * 60 * 60 * 1000 ||
      reservation.chargedBytes <= 0 || reservation.quarantineBytes <= 0 ||
      reservation.publishedBytes !== undefined ||
      !intent.quarantineStorageKey ||
      now < intent.expiresAt + SIGNED_TRANSFER_SKEW_MS ||
      reservation.cleanupAfter <= now)
      throw new Error("Exact expired pending upload fixture required.");
    await ctx.db.patch(reservation._id, { cleanupAfter: now - 1 });
    return { storageKey: intent.quarantineStorageKey };
  },
});

export const inspectPendingFixtureCleanup = internalQuery({
  args: { ...fixtureArgs, intentId: v.id("profileAssetUploadIntents") },
  handler: async (ctx, args) => {
    const data = await cleanupRows(ctx, args);
    const reservation = data.reservations.find((row) => row.intentId === args.intentId);
    if (data.intents.length !== 1 || data.reservations.length !== 1 ||
      data.submissions.length !== 1 || !reservation)
      throw new Error("Exact pending upload fixture required.");
    const [actor, target] = await Promise.all([
      ctx.db.query("contributionCapacity")
        .withIndex("by_scope", (q) => q.eq("scope", `actor:${reservation.actorUserId}`)).unique(),
      ctx.db.query("contributionCapacity")
        .withIndex("by_scope", (q) => q.eq("scope", `target:${args.profileId}`)).unique(),
    ]);
    return {
      state: reservation.state,
      code: reservation.receipt?.code,
      chargedBytes: reservation.chargedBytes,
      quarantineBytes: reservation.quarantineBytes,
      processing: reservation.processing,
      cleanupLeaseActive: reservation.cleanupToken !== undefined || reservation.cleanupLeaseUntil !== undefined,
      cleanupDeferred: reservation.cleanupAfter > Date.now() + 23 * 60 * 60 * 1000,
      actorBytes: actor?.bytes ?? 0,
      actorProcessing: actor?.processing ?? 0,
      targetBytes: target?.bytes ?? 0,
      targetProcessing: target?.processing ?? 0,
    };
  },
});

export const grantPublicationActors = internalMutation({
  args: fixtureArgs,
  handler: async (ctx, args) => {
    const profile = await fixture(ctx, args);
    if (profile.claimState !== "unclaimed" || profile.publicationState !== "published")
      throw new Error("Unclaimed fixture required.");
    const now = Date.now();
    const actors: Id<"users">[] = [];
    for (const [suffix, feature] of [["contributor", "trusted_publisher"], ["reviewer", "media_reviewer"]] as const) {
      const user = await ctx.db.query("users").withIndex("email", q => q.eq("email", `${args.runId}-${suffix}+clerk_test@e2e.vrdex.net`)).unique();
      if (!user?.clerkUserId || user.emailVerificationTime === undefined) throw new Error("Verified fixture actor required.");
      actors.push(user._id);
      const previous = await ctx.db.query("accountFeatureGrants").withIndex("by_userId_feature_state", q => q.eq("userId", user._id).eq("feature", feature).eq("state", "active")).take(3);
      if (previous.length > 1 || previous.some(row => row.grantedBy.tokenIdentifier !== `e2e:${args.runId}`)) throw new Error("Unscoped fixture grant.");
      if (!previous.length) await ctx.db.insert("accountFeatureGrants", {
        userId: user._id, feature, state: "active", grantedAt: now, updatedAt: now, expiresAt: now + 60 * 60_000,
        grantedBy: { tokenIdentifier: `e2e:${args.runId}`, issuer: "vrdex:e2e", subject: args.runId },
      });
    }
    const [contributorId, reviewerId] = actors;
    let batch = await ctx.db.query("contributionBatches").withIndex("by_actor_key", q => q.eq("actorUserId", contributorId!).eq("idempotencyKey", `e2e:${args.runId}`)).unique();
    const batchId = batch?._id ?? await ctx.db.insert("contributionBatches", { actorUserId: contributorId!, idempotencyKey: `e2e:${args.runId}`, label: args.runId, archived: false, rowCount: 0, createdAt: now });
    batch ??= await ctx.db.get(batchId);
    if (!batch || batch.archived || batch.rowCount > 20) throw new Error("Invalid fixture collection.");
    const assignment = await ctx.db.query("contributionBatchReviewers").withIndex("by_batch_reviewer", q => q.eq("batchId", batchId).eq("reviewerUserId", reviewerId!)).unique();
    if (!assignment) await ctx.db.insert("contributionBatchReviewers", { batchId, reviewerUserId: reviewerId!, active: true, expiresAt: now + 60 * 60_000 });
    let rowCount = batch.rowCount;
    for (const submission of (await rows(ctx, profile._id)).submissions) {
      if (submission.submitterUserId !== contributorId) throw new Error("Unscoped fixture contribution.");
      const attempt = await ctx.db.query("contributionItemAttempts").withIndex("by_submissionId", q => q.eq("submissionId", submission._id)).unique();
      if (attempt) {
        const revision = await ctx.db.get(attempt.revisionId);
        if (revision?.batchId !== batchId || attempt.actorUserId !== contributorId) throw new Error("Unscoped fixture attempt.");
        continue;
      }
      const payload = JSON.stringify({ kind: "media" });
      const revisionId = await ctx.db.insert("contributionItemRevisions", { actorUserId: contributorId!, batchId, itemKey: submission._id, revision: 1, payload, bytes: payload.length, createdAt: now });
      await ctx.db.insert("contributionItemAttempts", { actorUserId: contributorId!, revisionId, oauthClientId: `e2e:${args.runId}`, submissionId: submission._id, receipt: { operationId: submission._id, operationState: "committed" }, createdAt: now });
      rowCount++;
    }
    await ctx.db.patch(batchId, { rowCount });
    return { granted: true, batchId };
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
        (s) => ["submitted", "approved"].includes(s.status) && s.submitterUserId !== user._id,
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
    const profile = await fixture(ctx, args);
    const data = await rows(ctx, args.profileId);
    return {
      mediaKitEnabled: process.env.VRDEX_PROFILE_MEDIA_KIT_ENABLED === "true",
      mediaKitPublic: isProfileFieldVisible(profile, "mediaKit", "profile_page"),
      counts: {
        intents: data.intents.length,
        reservations: data.reservations.length,
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

// Only aggregate evidence leaves this fixture. Never return retained ledger rows.
export const inspectAudit = internalQuery({
  args: fixtureArgs,
  handler: async (ctx, args) => {
    await fixture(ctx, args);
    const contributor = await ctx.db.query("users")
      .withIndex("email", (q) => q.eq("email", `${args.runId}-contributor+clerk_test@e2e.vrdex.net`))
      .unique();
    if (!contributor?.clerkUserId || contributor.emailVerificationTime === undefined)
      throw new Error("Verified fixture contributor required.");
    const [audit, tools] = await Promise.all([
      ctx.db.query("apiWriteAuditEvents")
        .withIndex("by_actorUserId_createdAt", (q) => q.eq("actorUserId", contributor._id)).take(101),
      ctx.db.query("mcpToolEvents")
        .withIndex("by_actorUserId_createdAt", (q) => q.eq("actorUserId", contributor._id)).take(101),
    ]);
    if (audit.length > 100 || tools.length > 100) throw new Error("Audit fixture bound exceeded.");
    const common = ["_id", "_creationTime", "actorUserId", "ownerUserId", "oauthClientId", "oauthTokenId",
      "requestId", "idempotencyKeyHash", "targetProfileId", "targetEventId", "routeClass", "result", "createdAt"];
    const auditKeys = new Set([...common, "action", "actorKind", "mcpToolName", "resourceType",
      "targetIntentId", "targetSubmissionId", "assetIds"]);
    const toolKeys = new Set([...common, "toolName", "eventType"]);
    const data = await rows(ctx, args.profileId);
    const privateValues = [
      ...data.submissions.flatMap((s) => [s.sourceUrl, s.privateReason, s.contributorNote]),
      ...data.intents.flatMap((i) => [i.uploadToken, i.storageKey, i.quarantineStorageKey,
        i.sourceStorageKey, i.downloadStorageKey]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    for (const [entries, allowed] of [[audit, auditKeys], [tools, toolKeys]] as const) {
      for (const entry of entries) {
        const serialized = JSON.stringify(entry);
        if (Object.keys(entry).some((key) => !allowed.has(key)) ||
          /https?:\/\/|data:image\/|Bearer\s/i.test(serialized) ||
          privateValues.some((value) => serialized.includes(JSON.stringify(value).slice(1, -1))))
          throw new Error("Audit redaction check failed.");
      }
    }
    const mediaAudit = audit.filter((row) => row.result === "accepted" && row.action === "profile_media_submission_submitted" &&
      row.mcpToolName === "vrdex_profile_media_submit" && row.targetProfileId === args.profileId);
    const mediaTools = tools.filter((row) => row.toolName === "vrdex_profile_media_submit");
    return {
      auditRows: mediaAudit.length, toolRows: mediaTools.length,
      deniedToolRows: mediaTools.filter((row) => row.result === "denied").length,
      redacted: true,
    };
  },
});

async function cleanupRows(
  ctx: QueryCtx,
  args: { secret: string; runId: string; profileId: Id<"profiles"> },
  allowPendingLocal = false,
) {
  const profile = await fixture(ctx, args);
  const data = await rows(ctx, profile._id);
  // An expired DB lease does not fence the importer's captured S3 credentials
  // or object keys. Keep failed workers fail-closed until their storage work is
  // known to have stopped; age alone cannot make external deletion safe.
  if (
    data.intents.some((i) => i.processingToken !== undefined) ||
    data.reservations.some((r) => (r.processing &&
      !(allowPendingLocal && pendingFixtureUpload(data, r))) || r.state === "processing" ||
      (r.processingToken !== undefined && !committedUploadWithLegacyToken(data, r)) ||
      r.signingToken !== undefined ||
      r.cleanupToken !== undefined || r.cleanupLeaseUntil !== undefined) ||
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
  for (const reservation of data.reservations) {
    const actor = await ctx.db.get(reservation.actorUserId);
    if (reservation.profileId !== profile._id || reservation.mode !== "contributor" ||
      reservation.batchRevisionId !== undefined || reservation.allowanceId !== undefined ||
      actor?.email !== `${args.runId}-contributor+clerk_test@e2e.vrdex.net` ||
      !data.intents.some((intent) => intent._id === reservation.intentId &&
        data.submissions.some((submission) => submission.uploadIntentId === intent._id &&
          submission.submitterUserId === reservation.actorUserId)))
      throw new Error("Non-fixture upload reservation.");
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
        !(key.startsWith(`profile-assets/${date}/${token}/`) ||
          key.startsWith(`profile-assets/quarantine/${date}/${token}/`) ||
          (intent.issuer === "mcp_local" && key === intent.quarantineStorageKey &&
            /^profile-assets\/quarantine\/local\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)))
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
  const reviewer = await ctx.db.query("users")
    .withIndex("email", (q) => q.eq("email", `${args.runId}-reviewer+clerk_test@e2e.vrdex.net`))
    .unique();
  const disposableActors = new Set([contributor?._id, reviewer?._id]);
  const featureGrants = (await Promise.all([...disposableActors].filter((id): id is Id<"users"> => id !== undefined).map(async userId =>
    (await Promise.all((["trusted_publisher", "media_reviewer"] as const).flatMap(feature => (["active", "revoked"] as const).map(state =>
      ctx.db.query("accountFeatureGrants").withIndex("by_userId_feature_state", q => q.eq("userId", userId).eq("feature", feature).eq("state", state)).take(3))))).flat(),
  ))).flat();
  if (featureGrants.length > 2 || featureGrants.some(row => row.grantedBy.tokenIdentifier !== `e2e:${args.runId}`))
    throw new Error("Unscoped media fixture feature grant.");
  const batch = contributor ? await ctx.db.query("contributionBatches").withIndex("by_actor_key", q => q.eq("actorUserId", contributor._id).eq("idempotencyKey", `e2e:${args.runId}`)).unique() : null;
  const revisions = batch ? await ctx.db.query("contributionItemRevisions").withIndex("by_batch_key_revision", q => q.eq("batchId", batch._id)).take(21) : [];
  const assignments = batch ? await ctx.db.query("contributionBatchReviewers").withIndex("by_batch_reviewer", q => q.eq("batchId", batch._id)).take(3) : [];
  const attempts = (await Promise.all(revisions.map(revision => ctx.db.query("contributionItemAttempts").withIndex("by_revision", q => q.eq("revisionId", revision._id)).take(2)))).flat();
  if (revisions.length > 20 || attempts.length !== revisions.length || assignments.length > 1 ||
    assignments.some(row => row.reviewerUserId !== reviewer?._id) ||
    revisions.some(row => row.actorUserId !== contributor?._id || row.legalHoldAt !== undefined) ||
    attempts.some(row => row.actorUserId !== contributor?._id || row.oauthClientId !== `e2e:${args.runId}` || !data.submissions.some(submission => submission._id === row.submissionId)))
    throw new Error("Unscoped media fixture assignment.");
  const reviewRows = await Promise.all(data.submissions.map(async (submission) => {
    const [rebases, reviewReceipts, publicationEvidence] = await Promise.all([
      ctx.db.query("mediaReviewRebases")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id)).take(21),
      ctx.db.query("mediaReviewReceipts")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id)).take(21),
      ctx.db.query("mediaPublicationEvidence")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id)).take(21),
    ]);
    if (rebases.length > 20 || reviewReceipts.length > 20 || publicationEvidence.length > 20 ||
      [...rebases, ...reviewReceipts, ...publicationEvidence]
        .some((row) => !disposableActors.has(row.actorUserId)))
      throw new Error("Unscoped media fixture review row.");
    return { rebases, reviewReceipts, publicationEvidence };
  }));
  const submissionIds = new Set(data.submissions.map((row) => row._id));
  const publicationRestrictions = await ctx.db.query("mediaPublicationRestrictions")
    .withIndex("by_profileId_kind", (q) => q.eq("profileId", args.profileId)).take(21);
  if (publicationRestrictions.length > 20 || publicationRestrictions.some((row) =>
    !submissionIds.has(row.submissionId) || !disposableActors.has(row.actorUserId)))
    throw new Error("Unscoped media fixture publication restriction.");
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
  return {
    profile, ...data, refusalReceipts, publicationRestrictions, featureGrants,
    batchRows: [...attempts, ...revisions, ...assignments, ...(batch ? [batch] : [])],
    reviewRebases: reviewRows.flatMap((row) => row.rebases),
    reviewReceipts: reviewRows.flatMap((row) => row.reviewReceipts),
    publicationEvidence: reviewRows.flatMap((row) => row.publicationEvidence),
    storageKeys: [...keys].sort(),
  };
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
    const data = await cleanupRows(ctx, args, true);
    const now = Date.now();
    const safeDeleteAfter = signedTransferSafeAfter(data.intents);
    if (now >= safeDeleteAfter)
      for (const row of data.reservations)
        if (pendingFixtureUpload(data, row)) await failReservation(ctx, row, "UPLOAD_EXPIRED");
    // Freeze new submissions and ordinary owner authority before any external IO.
    await ctx.db.patch(args.profileId, {
      publicationState: "draft_private",
      claimState: "unclaimed",
      updatedAt: now,
    });
    if (data.profile) await queueProfileLinkDestinations(ctx, { ...data.profile, publicationState: "draft_private" }, now);
    for (const owner of data.owners)
      await ctx.db.patch(owner._id, {
        state: "revoked",
        revokedAt: now,
        updatedAt: now,
      });
    for (const intent of data.intents)
      await ctx.db.patch(intent._id, {
        state: "expired",
        // Preserve the mint deadline so retries cannot delete a replayable S3 key.
        expiresAt: intent.issuer === "mcp_local" ? intent.expiresAt : now - 1,
        updatedAt: now,
      });
    for (const submission of data.submissions)
      await ctx.db.patch(submission._id, {
        status: "withdrawn",
        blobDeleteAfter: undefined,
        expiresAt: now - 1,
        updatedAt: now,
      });
    return { storageKeys: data.storageKeys, profileMissing: false, safeDeleteAfter };
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
    if (Date.now() < signedTransferSafeAfter(data.intents))
      throw new Error("Fixture signed transfer may still be valid.");
    for (const row of data.reservations) {
      if (row.chargedBytes || row.processing)
        await changeContributionCharge(ctx.db, row, -row.chargedBytes, row.processing ? -1 : 0);
      if (row.publishedBytes) {
        const published = await ctx.db.query("contributionCapacity")
          .withIndex("by_scope", (q) => q.eq("scope", "published")).unique();
        if (!published || published.bytes < row.publishedBytes)
          throw new Error("Fixture published charge is invalid.");
        await ctx.db.patch(published._id, { bytes: published.bytes - row.publishedBytes });
      }
      await ctx.db.delete(row._id);
    }
    for (const scope of [
      ...new Set(data.reservations.flatMap((row) =>
        [`actor:${row.actorUserId}`, `target:${row.profileId}`, "deployment", "published"])),
    ]) {
      const capacity = await ctx.db.query("contributionCapacity")
        .withIndex("by_scope", (q) => q.eq("scope", scope)).unique();
      if (capacity?.bytes === 0 && capacity.processing === 0 &&
        capacity.byteLimit === undefined && capacity.processingLimit === undefined)
        await ctx.db.delete(capacity._id);
    }
    for (const row of [
      ...data.placements,
      ...data.assets,
      ...data.reviewRebases,
      ...data.reviewReceipts,
      ...data.publicationEvidence,
      ...data.publicationRestrictions,
      ...data.submissions,
      ...data.intents,
      ...data.refusalReceipts,
      ...data.featureGrants,
      ...data.batchRows,
    ])
      await ctx.db.delete(row._id);
    return { slug: data.profile.slug, deletedMedia: true, releasedReservations: data.reservations.length };
  },
});

export const exercisePublicationGuards = internalMutation({
  args: { ...fixtureArgs, action: v.union(v.literal("edit_bio"), v.literal("reselect_primary"), v.literal("revoke_actors")) },
  handler: async (ctx, args) => {
    const profile = await fixture(ctx, args);
    if (profile.claimState !== "unclaimed" || profile.publicationState !== "published" || profile.publicSurfacingState !== "public") throw new Error("Unclaimed fixture required.");
    const actors = await Promise.all(["contributor", "reviewer"].map(suffix => ctx.db.query("users").withIndex("email", q =>
      q.eq("email", `${args.runId}-${suffix}+clerk_test@e2e.vrdex.net`)).unique()));
    if (actors.some(user => !user?.clerkUserId || user.emailVerificationTime === undefined)) throw new Error("Verified fixture actors required.");
    const now = Date.now();
    if (args.action === "edit_bio") await ctx.db.patch(profile._id, { bio: "Synthetic unrelated biography edit", updatedAt: Math.max(now, profile.updatedAt + 1) });
    else if (args.action === "revoke_actors") {
      for (const [index, feature] of ["trusted_publisher", "media_reviewer"].entries()) {
        const grants = await ctx.db.query("accountFeatureGrants").withIndex("by_userId_feature_state", q =>
          q.eq("userId", actors[index]!._id).eq("feature", feature as "trusted_publisher" | "media_reviewer").eq("state", "active")).take(2);
        if (grants.length !== 1 || grants[0].grantedBy.tokenIdentifier !== `e2e:${args.runId}`) throw new Error("Exact fixture grant required.");
        await ctx.db.patch(grants[0]._id, { state: "revoked", updatedAt: now });
      }
    } else {
      const primary = await ctx.db.query("profileAssetPlacements").withIndex("by_profileId_placement_state_position", q =>
        q.eq("profileId", profile._id).eq("placement", "profile_image").eq("state", "active")).take(2);
      const data = await rows(ctx, profile._id);
      if (primary.length !== 1 || !data.assets.some(asset => asset._id === primary[0].assetId && asset.state === "active" && asset.visibility === "public") ||
        !data.submissions.some(submission => submission.submitterUserId === actors[0]!._id && submission.status === "approved" && submission.approvedAssetId === primary[0].assetId))
        throw new Error("Exact published fixture selection required.");
      await ctx.db.patch(primary[0]._id, { selectionActorUserId: actors[1]!._id, selectionOperationId: `e2e:${args.runId}:${crypto.randomUUID()}`, updatedAt: Math.max(now, primary[0].updatedAt + 1) });
    }
    return { changed: true };
  },
});
