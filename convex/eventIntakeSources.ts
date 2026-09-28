import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type DatabaseReader } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getActorIntakeDraft } from "./_eventIntake";
import { requireUser } from "./_identity";
import { canReadProfile } from "./_profilePermissions";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { EventPosterDeclarationSchema, EVENT_POSTER_MAX_BYTES } from "../packages/api-contracts/src/event-intake";
const DAY = 86_400_000;
const ARTWORK_WRITE_MS = 10 * 60_000;
const actor = { actorUserId: v.id("users") };
const sourceArg = { posterAssetId: v.id("eventPosterSources") };
export async function sourceExpiry(db: DatabaseReader, source: Doc<"eventPosterSources">) {
  if (source.state === "pending") return source.uploadExpiresAt;
  const draft = await db.get(source.draftId);
  const event = source.eventId ? await db.get(source.eventId) : null;
  const date = event?.eventDate ? Date.parse(`${event.eventDate}T23:59:59.999Z`) : event?.startAt;
  return Math.min(source.uploadedAt + 180 * DAY, (date ?? draft?.updatedAt ?? source.lastActivityAt) + 30 * DAY);
}
async function ownSource(db: DatabaseReader, actorUserId: Id<"users">, id: Id<"eventPosterSources">) {
  const source = await db.get(id);
  if (!await db.get(actorUserId) || !source || source.actorUserId !== actorUserId || source.state === "expired" || source.state === "deleting" || (!source.holdReportId && await sourceExpiry(db, source) <= Date.now())) throw new Error("POSTER_NOT_FOUND");
  return source;
}
export const beginPosterUpload = internalMutation({
  args: { ...actor, draftId: v.id("eventIntakeDrafts"), contentType: v.string(), byteLength: v.number(), sha256: v.string() }, returns: v.any(),
  handler: async (ctx, args) => {
    const declaration = EventPosterDeclarationSchema.parse({ contentType: args.contentType, byteLength: args.byteLength, sha256: args.sha256 });
    const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId);
    if (draft.publishedReceiptId) throw new Error("DRAFT_PUBLISHED");
    const active = (await Promise.all((["pending", "ready", "deleting"] as const).map(state => ctx.db.query("eventPosterSources").withIndex("by_actor_state", q => q.eq("actorUserId", args.actorUserId).eq("state", state)).take(101)))).flat();
    const reservedBytes = declaration.byteLength * 2;
    if (active.length >= 20 || active.reduce((sum, row) => sum + row.reservedBytes, 0) + reservedBytes > 120 * 1024 * 1024) throw new Error("POSTER_QUOTA");
    const now = Date.now();
    const token = crypto.randomUUID();
    const storageKey = `profile-assets/event-posters/private/${token}/source`;
    const uploadStorageKey = `profile-assets/event-posters/private/${token}/upload`;
    const uploadExpiresAt = now + 10 * 60_000;
    const posterAssetId = await ctx.db.insert("eventPosterSources", { purpose: "event_poster", actorUserId: args.actorUserId, draftId: args.draftId, ...declaration,
      reservedBytes, storageKey, uploadStorageKey, state: "pending", uploadedAt: now, lastActivityAt: draft.updatedAt, expiresAt: uploadExpiresAt + DAY, uploadExpiresAt });
    return { posterAssetId, storageKey, uploadStorageKey, expiresAt: uploadExpiresAt, ...declaration };
  },
});
export const readActorSource = internalQuery({ args: { ...actor, ...sourceArg }, returns: v.any(), handler: (ctx, args) => ownSource(ctx.db, args.actorUserId, args.posterAssetId) });
// Internal completion is called only by the server bridge after full decoding and digest verification.
export const completePosterUpload = internalMutation({ args: { ...actor, ...sourceArg, sha256: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const source = await ownSource(ctx.db, args.actorUserId, args.posterAssetId);
  if (source.sha256 !== args.sha256) throw new Error("POSTER_DIGEST_MISMATCH");
  const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, source.draftId);
  if (draft.publishedReceiptId) throw new Error("DRAFT_PUBLISHED");
  await ctx.db.patch(source._id, { state: "ready", lastActivityAt: draft.updatedAt, expiresAt: Math.min(source.uploadedAt + 180 * DAY, draft.updatedAt + 30 * DAY, Date.now() + DAY) });
  return null;
} });
export const getPosterSource = query({ args: sourceArg, returns: v.any(), handler: async (ctx, args) => {
  const { userId } = await requireUser(ctx);
  const source = await ctx.db.get(args.posterAssetId);
  if (!source || source.state !== "ready" || (!source.holdReportId && await sourceExpiry(ctx.db, source) <= Date.now())) throw new Error("POSTER_NOT_FOUND");
  if (source.actorUserId !== userId && !(await getAccountFeatureAccess(ctx.db, userId)).superAdmin) throw new Error("POSTER_NOT_FOUND");
  return source;
} });
export const selectPosterArtwork = internalMutation({ args: { ...actor, ...sourceArg, draftId: v.id("eventIntakeDrafts"), expectedVersion: v.number() }, returns: v.any(), handler: async (ctx, args) => {
  const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId);
  if (draft.version !== args.expectedVersion) throw new Error("VERSION_CONFLICT");
  if (draft.publishedReceiptId) throw new Error("DRAFT_PUBLISHED");
  const source = await ownSource(ctx.db, args.actorUserId, args.posterAssetId);
  if (source.draftId !== draft._id || source.state !== "ready") throw new Error("POSTER_NOT_READY");
  const previous = await ctx.db.query("eventPosterArtwork").withIndex("by_source", q => q.eq("sourceId", source._id)).order("desc").take(1);
  const writeExpiresAt = Date.now() + ARTWORK_WRITE_MS;
  if (previous[0] && ["pending", "ready"].includes(previous[0].state)) {
    await ctx.db.patch(previous[0]._id, { expiresAt: Math.max(previous[0].expiresAt, writeExpiresAt + DAY) });
    return { artworkAssetId: previous[0]._id, storageKey: previous[0].storageKey, expectedVersion: draft.version, writeExpiresAt };
  }
  const storageKey = `profile-assets/event-posters/artwork/${crypto.randomUUID()}.webp`;
  const artworkAssetId = await ctx.db.insert("eventPosterArtwork", { actorUserId: args.actorUserId, draftId: draft._id, sourceId: source._id, storageKey, state: "pending", createdAt: Date.now(), expiresAt: writeExpiresAt + DAY });
  return { artworkAssetId, storageKey, expectedVersion: draft.version, writeExpiresAt };
} });
export const completeArtwork = internalMutation({ args: { ...actor, artworkAssetId: v.id("eventPosterArtwork"), expectedVersion: v.number(), sha256: v.string(), byteLength: v.number() }, returns: v.any(), handler: async (ctx, args) => {
  const artwork = await ctx.db.get(args.artworkAssetId);
  if (!artwork || artwork.actorUserId !== args.actorUserId || !["pending", "ready"].includes(artwork.state)) throw new Error("ARTWORK_NOT_FOUND");
  const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, artwork.draftId);
  if (draft.artworkAssetId === artwork._id && artwork.state === "ready") return { artworkAssetId: artwork._id, version: draft.version };
  if (draft.publishedReceiptId || draft.version !== args.expectedVersion) throw new Error("VERSION_CONFLICT");
  if (!/^[a-f0-9]{64}$/.test(args.sha256) || !Number.isSafeInteger(args.byteLength) || args.byteLength < 1 || args.byteLength > EVENT_POSTER_MAX_BYTES) throw new Error("ARTWORK_INVALID");
  await ownSource(ctx.db, args.actorUserId, artwork.sourceId);
  await ctx.db.patch(artwork._id, { state: "ready", sha256: args.sha256, byteLength: args.byteLength, expiresAt: Date.now() + 30 * DAY });
  await ctx.db.patch(draft._id, { artworkAssetId: artwork._id, version: draft.version + 1, updatedAt: Date.now(), expiresAt: Date.now() + 30 * DAY });
  return { artworkAssetId: artwork._id, version: draft.version + 1 };
} });
export const publicArtwork = query({ args: { artworkAssetId: v.id("eventPosterArtwork") }, returns: v.any(), handler: async (ctx, args) => {
  const artwork = await ctx.db.get(args.artworkAssetId);
  const event = artwork?.eventId ? await ctx.db.get(artwork.eventId) : null;
  const community = event?.communityProfileId ? await ctx.db.get(event.communityProfileId) : null;
  if (artwork?.state !== "published" || !event || event.publicationState !== "published" || event.moderationRemovedAt !== undefined || !community || !canReadProfile("public", community)) return null;
  return { eventId: event._id, storageKey: artwork.storageKey, contentType: "image/webp", byteLength: artwork.byteLength };
} });
export const authorizeExtraction = internalMutation({ args: { ...actor, draftId: v.id("eventIntakeDrafts"), posterAssetId: v.optional(v.id("eventPosterSources")) }, returns: v.any(), handler: async (ctx, args) => {
  const draft = await getActorIntakeDraft(ctx.db, args.actorUserId, args.draftId);
  if (draft.publishedReceiptId) throw new Error("DRAFT_PUBLISHED");
  const recent = await ctx.db.query("eventIntakeModelAttempts").withIndex("by_actor_createdAt", q => q.eq("actorUserId", args.actorUserId).gte("createdAt", Date.now() - DAY)).take(20);
  if (recent.length >= 20) throw new Error("EXTRACTION_QUOTA");
  if (args.posterAssetId) {
    const source = await ownSource(ctx.db, args.actorUserId, args.posterAssetId);
    if (source.draftId !== draft._id || source.state !== "ready") throw new Error("POSTER_NOT_READY");
  }
  await ctx.db.insert("eventIntakeModelAttempts", { actorUserId: args.actorUserId, draftId: draft._id, createdAt: Date.now() });
  return { actorUserId: args.actorUserId, version: draft.version };
} });
export const setEvidenceHold = mutation({ args: { ...sourceArg, reportId: v.union(v.id("eventReports"), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  if (!(await getAccountFeatureAccess(ctx.db, (await requireUser(ctx)).userId)).superAdmin) throw new Error("REVIEWER_REQUIRED");
  const source = await ctx.db.get(args.posterAssetId);
  if (!source || source.state !== "ready") throw new Error("POSTER_NOT_FOUND");
  const report = args.reportId ? await ctx.db.get(args.reportId) : null;
  if (args.reportId && (!report || report.eventId !== source.eventId)) throw new Error("REPORT_MISMATCH");
  await ctx.db.patch(source._id, { holdReportId: args.reportId ?? undefined, expiresAt: args.reportId ? Number.MAX_SAFE_INTEGER : Date.now() });
  return null;
} });
// Ready records are rechecked at least daily so event rescheduling cannot retain stale evidence indefinitely.
export const claimExpiredSources = internalMutation({ args: {}, returns: v.any(), handler: async ctx => {
  const now = Date.now();
  const rows = (await Promise.all((["pending", "ready", "deleting"] as const).map(state => ctx.db.query("eventPosterSources").withIndex("by_state_expiresAt", q => q.eq("state", state).lte("expiresAt", now)).take(50)))).flat();
  const work = [];
  for (const source of rows) {
    if (source.holdReportId || (source.cleanupLeaseUntil ?? 0) > now) continue;
    const expiry = await sourceExpiry(ctx.db, source);
    if (source.state !== "deleting" && expiry > now) { await ctx.db.patch(source._id, { expiresAt: Math.min(expiry, now + DAY) }); continue; }
    const token = crypto.randomUUID();
    await ctx.db.patch(source._id, { state: "deleting", cleanupToken: token, cleanupLeaseUntil: now + 60_000 });
    work.push({ posterAssetId: source._id, token, storageKeys: [source.storageKey, source.uploadStorageKey].filter((key): key is string => !!key) });
  }
  return work;
} });
export const confirmSourceDeletion = internalMutation({ args: { ...sourceArg, token: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.posterAssetId);
  if (row?.state === "deleting" && row.cleanupToken === args.token) await ctx.db.patch(row._id, { state: "expired", reservedBytes: 0, storageKey: undefined, uploadStorageKey: undefined, cleanupToken: undefined, cleanupLeaseUntil: undefined, expiredAt: Date.now() });
  return null;
} });
export const claimAbandonedArtwork = internalMutation({ args: {}, returns: v.any(), handler: async ctx => {
  const now = Date.now();
  const rows = (await Promise.all((["pending", "ready", "deleting"] as const).map(state => ctx.db.query("eventPosterArtwork").withIndex("by_state_expiresAt", q => q.eq("state", state).lte("expiresAt", now)).take(50)))).flat();
  const work = [];
  for (const row of rows) {
    if ((row.cleanupLeaseUntil ?? 0) > now) continue;
    const draft = await ctx.db.get(row.draftId);
    if (row.state === "ready" && draft?.artworkAssetId === row._id && draft.expiresAt > now) { await ctx.db.patch(row._id, { expiresAt: draft.expiresAt }); continue; }
    const token = crypto.randomUUID();
    await ctx.db.patch(row._id, { state: "deleting", cleanupToken: token, cleanupLeaseUntil: now + 60_000 });
    work.push({ artworkAssetId: row._id, token, storageKeys: row.storageKey ? [row.storageKey] : [] });
  }
  return work;
} });
export const confirmArtworkDeletion = internalMutation({ args: { artworkAssetId: v.id("eventPosterArtwork"), token: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.artworkAssetId);
  if (row?.state === "deleting" && row.cleanupToken === args.token) await ctx.db.patch(row._id, { state: "expired", cleanupToken: undefined, cleanupLeaseUntil: undefined });
  return null;
} });

// A late immutable write may finish after deletion. Keep the exact key on the tombstone
// so a failed finalization can durably requeue it without trusting a caller-supplied key.
export const recoverFailedArtworkWrite = internalMutation({
  args: { ...actor, artworkAssetId: v.id("eventPosterArtwork") }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.artworkAssetId);
    if (!row || row.actorUserId !== args.actorUserId) throw new Error("ARTWORK_NOT_FOUND");
    if (row.state === "expired" || row.state === "deleting") {
      await ctx.db.patch(row._id, { state: "deleting", expiresAt: Date.now(), cleanupToken: undefined, cleanupLeaseUntil: undefined });
    }
    return null;
  },
});