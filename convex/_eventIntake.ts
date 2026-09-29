import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { EventIntakePatchSchema, PublishEventIntakeSchema, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";
import { preflightEventContribution } from "./_eventContributionPreflight";
import { requireDateOnlyEventsEnabled } from "./_eventSchedule";
import { replaceEventLineup } from "./_eventLineup";
import { reindexEventSearchDocument } from "./_searchDocuments";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { eventPathForRecord, eventPathForSlugs } from "./_eventPaths";
import { eventParticipantRoleLabels, linkedPublishedEventWorld, recordEventAuditEvent, replaceEventWorldLink } from "./events";

export const EVENT_INTAKE_DRAFT_LIMIT = 20;
export const EVENT_INTAKE_DRAFT_TTL_MS = 30 * 86_400_000;
const omitEmpty = (value: unknown): unknown => {
  if (value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.map(omitEmpty);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const cleaned = omitEmpty(item); return cleaned === undefined ? [] : [[key, cleaned]];
  }));
  return value;
};
function hasMeaningfulInput(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulInput);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, item]) => !["clientKey", "position", "dayOffset", "occurrence", "timeTba", "questions", "duplicateAcknowledgements"].includes(key) && hasMeaningfulInput(item));
}
export function sanitizeEventIntakePatch(raw: unknown): EventIntakePatch {
  const patch = EventIntakePatchSchema.parse(raw);
  for (const group of [patch, patch.tentative]) {
    if (!group?.sourceUrl) continue;
    let url: URL;
    try { url = new URL(group.sourceUrl); } catch { throw new Error("Source URL must be a safe HTTPS URL."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Source URL must be a safe HTTPS URL.");
  }
  return patch;
}
export async function getActorIntakeDraft(db: DatabaseReader, actorUserId: Id<"users">, draftId: Id<"eventIntakeDrafts">, now = Date.now()) {
  if (!await db.get(actorUserId)) throw new Error("A signed-in user is required.");
  const draft = await db.get(draftId);
  if (!draft || draft.actorUserId !== actorUserId || draft.expiresAt <= now) throw new Error("Draft not found.");
  const artwork = draft.artworkAssetId ? await db.get(draft.artworkAssetId) : null;
  const artworkSourceId = artwork?.draftId === draft._id && artwork.actorUserId === actorUserId && ["ready", "published"].includes(artwork.state) ? artwork.sourceId : undefined;
  return { ...draft, artworkSourceId, fields: sanitizeEventIntakePatch(draft.fields) };
}
export async function saveIntakeDraft(db: DatabaseWriter, actorUserId: Id<"users">, args: { draftId?: Id<"eventIntakeDrafts">; expectedVersion?: number; patch: unknown }, now = Date.now()) {
  if (!await db.get(actorUserId)) throw new Error("A signed-in user is required.");
  const patch = sanitizeEventIntakePatch(args.patch);
  const draft = args.draftId ? await getActorIntakeDraft(db, actorUserId, args.draftId, now) : undefined;
  if (draft ? draft.version !== args.expectedVersion : args.expectedVersion !== undefined) throw new ConvexError({ code: "VERSION_CONFLICT" });
  if (draft?.publishedReceiptId) throw new Error("Published drafts cannot be edited. Use the event correction flow.");
  const fields = omitEmpty({ ...draft?.fields, ...patch }) as EventIntakePatch;
  if (!hasMeaningfulInput(fields)) throw new Error("A draft needs at least one meaningful field.");
  if (JSON.stringify(fields).length > 48_000) throw new Error("Draft exceeds storage limit.");
  if (!draft) {
    const active = await db.query("eventIntakeDrafts").withIndex("by_actor_expiresAt", q => q.eq("actorUserId", actorUserId).gt("expiresAt", now)).take(EVENT_INTAKE_DRAFT_LIMIT);
    if (active.length >= EVENT_INTAKE_DRAFT_LIMIT) throw new ConvexError({ code: "DRAFT_QUOTA" });
  }
  const version = (draft?.version ?? 0) + 1;
  const provenance = [ ...(draft?.provenance ?? []).filter(item => !Object.prototype.hasOwnProperty.call(patch, item.field)),
    ...Object.keys(patch).filter(field => Object.prototype.hasOwnProperty.call(fields, field)).map(field => ({ field, kind: field === "tentative" ? "tentative" as const : "contributor" as const, version })) ];
  const values = { fields, provenance, version, updatedAt: now, expiresAt: now + EVENT_INTAKE_DRAFT_TTL_MS };
  if (draft) {
    const sources = await db.query("eventPosterSources").withIndex("by_draft_state", q => q.eq("draftId", draft._id).eq("state", "ready")).take(21);
    for (const source of sources) if (source.state === "ready") await db.patch(source._id, { lastActivityAt: now, expiresAt: source.holdReportId ? Number.MAX_SAFE_INTEGER : Math.min(source.uploadedAt + 180 * 86_400_000, now + 86_400_000) });
  }
  if (draft) { await db.patch(draft._id, values); return { draftId: draft._id, version }; }
  return { draftId: await db.insert("eventIntakeDrafts", { ...values, actorUserId, createdAt: now }), version };
}

export type PublishIntakeArgs = { draftId: Id<"eventIntakeDrafts">; expectedVersion: number; idempotencyKey: string };
export type PublishIntakeResult = { eventId: Id<"events">; receiptId: Id<"eventContributionReceipts">; eventPath: string };
const receiptResult = async (db: DatabaseReader, receipt: Doc<"eventContributionReceipts">): Promise<PublishIntakeResult> => {
  const event = await db.get(receipt.eventId);
  return { eventId: receipt.eventId, receiptId: receipt._id,
    eventPath: event?.slug ? await eventPathForRecord(db, event) : receipt.eventPath };
};

export async function replayIntakePublication(db: DatabaseReader, actorUserId: Id<"users">, args: PublishIntakeArgs): Promise<PublishIntakeResult | null> {
  PublishEventIntakeSchema.parse(args);
  if (!await db.get(actorUserId)) throw new Error("A signed-in user is required.");
  const prior = await db.query("eventIntakePublishRequests").withIndex("by_actor_key", q => q.eq("actorUserId", actorUserId).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (!prior) return null;
  if (prior.draftId !== args.draftId || prior.draftVersion !== args.expectedVersion) throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
  return receiptResult(db, (await db.get(prior.receiptId))!);
}

export { classifyEventIntakeForPublication } from "../apps/web/src/lib/server/event-intake-spam";

export async function publishIntakeDraft(db: DatabaseWriter, actorUserId: Id<"users">, args: PublishIntakeArgs, now = Date.now(), actorSurface: "browser" | "api" | "mcp" = "api"): Promise<PublishIntakeResult & { createdEvent: boolean }> {
  const prior = await replayIntakePublication(db, actorUserId, args);
  if (prior) return { ...prior, createdEvent: false };
  const recentRequests = await db.query("eventIntakePublishRequests").withIndex("by_actor_createdAt", q => q.eq("actorUserId", actorUserId).gte("createdAt", now - 86_400_000)).take(100);
  if (recentRequests.length >= 100) throw new ConvexError({ code: "REQUEST_QUOTA" });
  const draft = await getActorIntakeDraft(db, actorUserId, args.draftId, now);
  if (draft.version !== args.expectedVersion) throw new ConvexError({ code: "VERSION_CONFLICT" });
  let receipt = draft.publishedReceiptId ? await db.get(draft.publishedReceiptId) : null;
  let createdEvent = false;
  if (!receipt) {
    const checked = await preflightEventContribution(db, actorUserId, sanitizeEventIntakePatch(draft.fields), now);
    const { fields, schedule, community, fingerprint } = checked;
    let event = checked.existing;
    if (!event) {
      createdEvent = true;
      if (schedule.scheduleKind === "date_only") requireDateOnlyEventsEnabled();
      const eventId = await db.insert("events", {
        title: fields.title!, sortTitle: fields.title!.toLowerCase(), ...schedule,
        ...(schedule.scheduleKind === "timed" ? { timezone: fields.timezone!, endAt: checked.endAt, doorsOpenAt: checked.doorsOpenAt } : {}),
        communityProfileId: community._id, communityName: community.displayName,
        ...(fields.summary ? { summary: fields.summary } : {}), ...(fields.venueLabel ? { venueLabel: fields.venueLabel } : {}),
        ...(fields.sourceUrl ? { sourceUrl: fields.sourceUrl } : {}),
        sourceType: "contributor", sourceLabel: "Community-submitted", contributorUserId: actorUserId,
        contributionVersion: 1, contributionFingerprint: fingerprint, eventStatus: "scheduled", publicationState: "published",
        publishedAt: now, createdAt: now, updatedAt: now,
      });
      const link = await ensureShortLinkForTarget(db, { targetType: "event", targetId: eventId }, now);
      await db.patch(eventId, { slug: link.code });
      event = (await db.get(eventId))!;
      await replaceEventLineup(db, event, checked.lineup, now, { confirmPersonLinks: false });
      await replaceEventWorldLink(db, event, checked.world, now, { confirmationState: "unconfirmed" });
      await reindexEventSearchDocument(db, event, { community, world: checked.world, roleLabels: checked.lineup.flatMap(entry => entry.roleLabel ? [entry.roleLabel] : []) }, now);
      await recordEventAuditEvent(db, { eventId, actorUserId, actorSurface, action: "created",
        changedFields: ["event", "lineup", "world"], now });
    } else if (event.slug === undefined) {
      // Legacy matches may predate canonical routes. Repair the existing row,
      // retaining its content and associations rather than applying the draft.
      const link = await ensureShortLinkForTarget(db, { targetType: "event", targetId: event._id }, now);
      await db.patch(event._id, { slug: link.code });
      event = { ...event, slug: link.code };
      const [world, roleLabels] = await Promise.all([
        linkedPublishedEventWorld(db, event._id), eventParticipantRoleLabels(db, event._id),
      ]);
      await reindexEventSearchDocument(db, event, { community, world, roleLabels }, now);
    }
    if (event.slug === undefined) throw new Error("Published event requires a canonical route.");
    receipt = await db.query("eventContributionReceipts").withIndex("by_eventId", q => q.eq("eventId", event!._id)).unique();
    if (!receipt) {
      const receiptId = await db.insert("eventContributionReceipts", { actorUserId, draftId: draft._id, draftVersion: draft.version, eventId: event._id,
        eventPath: eventPathForSlugs(community.slug, event.slug), communityProfileId: community._id, fingerprint, createdAt: now });
      receipt = (await db.get(receiptId))!;
    }
    if (createdEvent) {
      const sources = await db.query("eventPosterSources").withIndex("by_draft_state", q => q.eq("draftId", draft._id).eq("state", "ready")).take(21);
      const eventDate = event.eventDate ? Date.parse(`${event.eventDate}T23:59:59.999Z`) : event.startAt!;
      for (const source of sources) if (source.state === "ready") await db.patch(source._id, { eventId: event._id, expiresAt: source.holdReportId ? Number.MAX_SAFE_INTEGER : Math.min(source.uploadedAt + 180 * 86_400_000, eventDate + 30 * 86_400_000, now + 86_400_000) });
    }
    // An explicit selection belongs to this contributor's newly created event only.
    if (draft.artworkAssetId && event.contributorUserId === actorUserId && receipt.draftId === draft._id) {
      const artwork = await db.get(draft.artworkAssetId);
      if (!artwork || artwork.actorUserId !== actorUserId || artwork.draftId !== draft._id || artwork.state !== "ready") throw new Error("ARTWORK_NOT_READY");
      await db.patch(artwork._id, { state: "published", eventId: event._id, expiresAt: now + 86_400_000 });
      const posterImageUrl = `/api/v0/events/${event._id}/artwork/${artwork._id}`;
      await db.patch(event._id, { posterImageUrl });
      await reindexEventSearchDocument(db, { ...event, posterImageUrl }, { community, world: checked.world, roleLabels: checked.lineup.flatMap(entry => entry.roleLabel ? [entry.roleLabel] : []) }, now);
    }
    await db.patch(draft._id, { publishedReceiptId: receipt._id });
  }
  await db.insert("eventIntakePublishRequests", { actorUserId, draftId: draft._id, draftVersion: draft.version, idempotencyKey: args.idempotencyKey, receiptId: receipt._id, createdAt: now });
  return { ...await receiptResult(db, receipt), createdEvent };
}
