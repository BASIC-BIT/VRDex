import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter, MutationCtx } from "./_generated/server";
import { EventIntakePatchSchema, PublishEventIntakeSchema, type EventIntakePatch } from "../packages/api-contracts/src/event-intake";
import { preflightEventContribution } from "./_eventContributionPreflight";
import { requireDateOnlyEventsEnabled } from "./_eventSchedule";
import { replaceEventLineup } from "./_eventLineup";
import { reindexEventSearchDocument } from "./_searchDocuments";
import { ensureShortLinkForTarget } from "./_shortLinks";
import { eventPathForRecord, eventPathForSlugs } from "./_eventPaths";
import { eventParticipantRoleLabels, linkedPublishedEventWorld, recordEventAuditEvent, replaceEventWorldLink } from "./events";
import { enqueueEventSync } from "./_eventSync";
import { userAuthSubject, userHasCommunityPermission } from "./_eventConnectors";

const submitterFor = async (db: DatabaseReader, userId: Id<"users">) => {
  const submitter = await userAuthSubject(db, userId);
  return submitter ? { submitter } : {};
};

export const EVENT_INTAKE_DRAFT_LIMIT = 20;
export const EVENT_INTAKE_DRAFT_TTL_MS = 30 * 86_400_000;
// The connector's source post: staff provenance on the draft, never public metadata.
const DISCORD_MESSAGE_URL = /^https:\/\/discord\.com\/channels\//;
const omitEmpty = (value: unknown): unknown => {
  if (value === null || value === "") return undefined;
  if (Array.isArray(value)) return value.map(omitEmpty);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === "posterSourceId" && item === null) return [[key, item]];
    if (key === "evidence" && Array.isArray(item)) return [[key, item]];
    const cleaned = omitEmpty(item); return cleaned === undefined ? [] : [[key, cleaned]];
  }));
  return value;
};
function hasMeaningfulInput(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulInput);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, item]) => !["clientKey", "position", "dayOffset", "occurrence", "timeTba", "questions", "evidence", "duplicateAcknowledgements"].includes(key) && hasMeaningfulInput(item));
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
// A held connector draft is the community's, whoever the connector's authority is. The connector's state does not matter: drafts outlive a paused or removed connector.
export async function getConnectorDraftForManager(db: DatabaseReader, userId: Id<"users">, draftId: Id<"eventIntakeDrafts">, now = Date.now()) {
  const draft = await db.get(draftId);
  const connector = draft?.connectorId ? await db.get(draft.connectorId) : null;
  const community = connector ? await db.get(connector.communityProfileId) : null;
  if (!draft || !connector || !community || draft.expiresAt <= now || draft.resolvedAt !== undefined || draft.publishedReceiptId || !await userHasCommunityPermission(db, community._id, userId, ["manage_events"])) throw new Error("Draft not found.");
  return { draft, connector, community };
}
export async function getActorIntakeDraft(db: DatabaseReader, actorUserId: Id<"users">, draftId: Id<"eventIntakeDrafts">, now = Date.now()) {
  if (!await db.get(actorUserId)) throw new Error("A signed-in user is required.");
  const owned = await db.get(draftId);
  const draft = owned && owned.actorUserId !== actorUserId ? (await getConnectorDraftForManager(db, actorUserId, draftId, now)).draft : owned;
  if (!draft || draft.expiresAt <= now) throw new Error("Draft not found.");
  const artwork = draft.artworkAssetId ? await db.get(draft.artworkAssetId) : null;
  // Posters bind to the draft, not the actor: a manager works with what the connector's authority attached.
  const artworkSourceId = artwork?.draftId === draft._id && ["ready", "published"].includes(artwork.state) ? artwork.sourceId : undefined;
  return { ...draft, artworkSourceId, fields: sanitizeEventIntakePatch(draft.fields) };
}
export async function saveIntakeDraft(db: DatabaseWriter, actorUserId: Id<"users">, args: { draftId?: Id<"eventIntakeDrafts">; expectedVersion?: number; patch: unknown }, now = Date.now(), options: { connectorDriven?: boolean; connectorId?: Id<"eventConnectors"> } = {}) {
  if (!await db.get(actorUserId)) throw new Error("A signed-in user is required.");
  const patch = sanitizeEventIntakePatch(args.patch);
  const draft = args.draftId ? await getActorIntakeDraft(db, actorUserId, args.draftId, now) : undefined;
  if (draft ? draft.version !== args.expectedVersion : args.expectedVersion !== undefined) throw new ConvexError({ code: "VERSION_CONFLICT" });
  if (draft?.publishedReceiptId) throw new Error("Published drafts cannot be edited. Use the event correction flow.");
  for (const group of [patch, patch.tentative]) {
    const rawId = group?.posterSourceId;
    if (!rawId) continue;
    const id = db.normalizeId("eventPosterSources", rawId);
    const source = id ? await db.get(id) : null;
    if (!draft || !source || source.draftId !== draft._id) throw new Error("POSTER_DRAFT_MISMATCH");
    if (source.state !== "pending" && source.state !== "ready") throw new Error("POSTER_NOT_READY");
    if ((source.state === "pending" ? source.uploadExpiresAt : Math.min(source.uploadedAt + 180 * 86_400_000, draft.updatedAt + 30 * 86_400_000)) <= now) throw new Error("POSTER_NOT_FOUND");
  }
  const posterChanged = Boolean(draft && patch.posterSourceId !== undefined && patch.posterSourceId !== draft.fields.posterSourceId);
  const sourceChanged = posterChanged || Boolean(draft && patch.sourceText !== undefined && (patch.sourceText ?? "") !== (draft.fields.sourceText ?? ""));
  const fields = omitEmpty({ ...draft?.fields, ...patch,
    ...(sourceChanged ? { tentative: null, questions: null, evidence: null } : {}) }) as EventIntakePatch;
  if (!draft && !hasMeaningfulInput(fields)) throw new Error("A draft needs at least one meaningful field.");
  if (JSON.stringify(fields).length > 48_000) throw new Error("Draft exceeds storage limit.");
  if (!draft && !options.connectorDriven && !options.connectorId) {
    const active = await db.query("eventIntakeDrafts").withIndex("by_actor_connector_expiresAt", q => q.eq("actorUserId", actorUserId).eq("connectorId", undefined).gt("expiresAt", now)).take(EVENT_INTAKE_DRAFT_LIMIT);
    if (active.length >= EVENT_INTAKE_DRAFT_LIMIT) throw new ConvexError({ code: "DRAFT_QUOTA" });
  }
  const version = (draft?.version ?? 0) + 1;
  const provenance = [ ...(draft?.provenance ?? []).filter(item => !Object.prototype.hasOwnProperty.call(patch, item.field)),
    ...Object.keys(patch).filter(field => Object.prototype.hasOwnProperty.call(fields, field)).map(field => ({ field, kind: field === "tentative" ? "tentative" as const : "contributor" as const, version })) ];
  const values = { fields, provenance, version, updatedAt: now, expiresAt: now + EVENT_INTAKE_DRAFT_TTL_MS,
    ...(options.connectorId ? { connectorId: options.connectorId } : {}),
    ...((posterChanged && patch.posterSourceId !== draft?.artworkSourceId) || patch.posterSourceId === null ? { artworkAssetId: undefined } : {}),
    ...(posterChanged || patch.posterSourceId === null ? { artworkIntentSourceId: undefined } : {}) };
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

export async function publishIntakeDraft(ctx: Pick<MutationCtx, "db" | "scheduler">, actorUserId: Id<"users">, args: PublishIntakeArgs, now = Date.now(), actorSurface: "browser" | "api" | "mcp" | "system" = "api", options: { connectorId?: Id<"eventConnectors"> } = {}): Promise<PublishIntakeResult & { createdEvent: boolean }> {
  const { db } = ctx;
  const { connectorId } = options;
  const prior = await replayIntakePublication(db, actorUserId, args);
  if (prior) return { ...prior, createdEvent: false };
  if (!connectorId) {
    const recentRequests = await db.query("eventIntakePublishRequests").withIndex("by_actor_connector_createdAt", q => q.eq("actorUserId", actorUserId).eq("connectorId", undefined).gte("createdAt", now - 86_400_000)).take(100);
    if (recentRequests.length >= 100) throw new ConvexError({ code: "REQUEST_QUOTA" });
  }
  const draft = await getActorIntakeDraft(db, actorUserId, args.draftId, now);
  // Connector drafts publish as the community's listing, only through the held path.
  if (!connectorId && draft.connectorId) throw new Error("DRAFT_ACCESS");
  const connector = connectorId ? await db.get(connectorId) : null;
  if (connectorId && (draft.connectorId !== connectorId || connector?.state !== "active")) throw new Error("CONNECTOR_DRAFT_MISMATCH");
  if (draft.version !== args.expectedVersion) throw new ConvexError({ code: "VERSION_CONFLICT" });
  if (draft.artworkIntentSourceId) throw new Error("ARTWORK_NOT_READY");
  if (draft.fields.posterSourceId && !draft.artworkAssetId) throw new Error("ARTWORK_NOT_READY");
  let receipt = draft.publishedReceiptId ? await db.get(draft.publishedReceiptId) : null;
  let createdEvent = false;
  if (!receipt) {
    const checked = await preflightEventContribution(db, actorUserId, sanitizeEventIntakePatch(draft.fields), now, undefined, { skipAccountQuota: Boolean(connectorId) });
    const { fields, schedule, community, fingerprint } = checked;
    // A connector publishes only into its own community, whatever the held draft's community field was edited to.
    if (connector && community._id !== connector.communityProfileId) throw new Error("CONNECTOR_DRAFT_MISMATCH");
    let event = checked.existing;
    if (!event) {
      createdEvent = true;
      if (schedule.scheduleKind === "date_only") requireDateOnlyEventsEnabled();
      const eventId = await db.insert("events", {
        title: fields.title!, sortTitle: fields.title!.toLowerCase(), ...schedule,
        ...(schedule.scheduleKind === "timed" ? { timezone: fields.timezone!, endAt: checked.endAt, doorsOpenAt: checked.doorsOpenAt } : {}),
        communityProfileId: community._id, communityName: community.displayName,
        ...(fields.summary ? { summary: fields.summary } : {}), ...(fields.venueLabel ? { venueLabel: fields.venueLabel } : {}),
        ...(fields.sourceUrl && !(draft.connectorId && DISCORD_MESSAGE_URL.test(fields.sourceUrl)) ? { sourceUrl: fields.sourceUrl } : {}),
        // A connector publishes the community's own listing, not a contribution by its authority user.
        ...(connectorId
          ? { sourceType: "community" as const, sourceLabel: "Community-submitted event", ...await submitterFor(db, actorUserId) }
          : { sourceType: "contributor" as const, sourceLabel: "Community-submitted", contributorUserId: actorUserId }),
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
        eventPath: eventPathForSlugs(community.slug, event.slug), communityProfileId: community._id, fingerprint, createdAt: now, ...(connectorId ? { connectorId } : {}) });
      receipt = (await db.get(receiptId))!;
    }
    if (createdEvent) {
      const sources = await db.query("eventPosterSources").withIndex("by_draft_state", q => q.eq("draftId", draft._id).eq("state", "ready")).take(21);
      const eventDate = event.eventDate ? Date.parse(`${event.eventDate}T23:59:59.999Z`) : event.startAt!;
      for (const source of sources) if (source.state === "ready") await db.patch(source._id, { eventId: event._id, expiresAt: source.holdReportId ? Number.MAX_SAFE_INTEGER : Math.min(source.uploadedAt + 180 * 86_400_000, eventDate + 30 * 86_400_000, now + 86_400_000) });
    }
    // An explicit selection belongs to this contributor's (or connector's) newly created event only.
    if (draft.artworkAssetId && receipt.draftId === draft._id && (connectorId ? createdEvent : event.contributorUserId === actorUserId)) {
      const artwork = await db.get(draft.artworkAssetId);
      if (!artwork || artwork.draftId !== draft._id || artwork.state !== "ready" || (draft.fields.posterSourceId !== undefined && draft.fields.posterSourceId !== artwork.sourceId)) throw new Error("ARTWORK_NOT_READY");
      await db.patch(artwork._id, { state: "published", eventId: event._id, expiresAt: now + 86_400_000 });
      const posterImageUrl = `/api/v0/events/${event._id}/artwork/${artwork._id}`;
      await db.patch(event._id, { posterImageUrl });
      await reindexEventSearchDocument(db, { ...event, posterImageUrl }, { community, world: checked.world, roleLabels: checked.lineup.flatMap(entry => entry.roleLabel ? [entry.roleLabel] : []) }, now);
    }
    await db.patch(draft._id, { publishedReceiptId: receipt._id });
  }
  await db.insert("eventIntakePublishRequests", { actorUserId, draftId: draft._id, draftVersion: draft.version, idempotencyKey: args.idempotencyKey, receiptId: receipt._id, createdAt: now, ...(connectorId ? { connectorId } : {}) });
  await enqueueEventSync(db, ctx.scheduler, receipt.eventId, "upsert");
  return { ...await receiptResult(db, receipt), createdEvent };
}
