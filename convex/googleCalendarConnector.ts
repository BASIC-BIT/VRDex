import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type DatabaseReader } from "./_generated/server";
import type { EventIntakeDecision, EventIntakeFields } from "../packages/api-contracts/src/event-intake";
import { applyEventCandidate, candidateFromConnectorFields, type ApplyEventCandidateOutcome } from "./_eventCandidateApply";
import { eventPathForRecord } from "./_eventPaths";
import { enqueueSyncJob } from "./_eventSync";
import { googleTarget, type GoogleCalendarEvent } from "./_googleCalendar";
import { fieldsFromGoogleEvent, outsideImportWindow } from "./eventSyncKinds/googleCalendar";

export const readCredential = internalQuery({
  args: { credentialId: v.id("connectorCredentials") },
  handler: (ctx, { credentialId }) => ctx.db.get(credentialId),
});

// The caller encrypts in its action: Convex seeds a mutation's RNG, so the IV must not come from here.
export const saveAccessToken = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), encryptedAccessToken: v.string(), accessTokenExpiresAt: v.number() },
  handler: async (ctx, { credentialId, encryptedAccessToken, accessTokenExpiresAt }) => {
    if ((await ctx.db.get(credentialId))?.state !== "active") return;
    await ctx.db.patch(credentialId, { encryptedAccessToken, accessTokenExpiresAt, updatedAt: Date.now() });
  },
});

// `error` is a code; it reaches the settings page and the ops alert email.
export const markNeedsReauth = internalMutation({
  args: { credentialId: v.id("connectorCredentials"), error: v.string() },
  handler: async (ctx, { credentialId, error }) => {
    const now = Date.now();
    // ponytail: reads every google_calendar connector; add a by_credentialId index when they pass a few hundred.
    const connectors = await ctx.db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "google_calendar")).collect();
    for (const connector of connectors) {
      if (connector.credentialId !== credentialId || connector.state === "removed") continue;
      await ctx.db.patch(connector._id, { state: "needs_reauth", lastError: error, updatedAt: now });
    }
  },
});

export const exportContext = internalQuery({
  args: { connectorId: v.id("eventConnectors"), eventId: v.id("events") },
  handler: async (ctx, { connectorId, eventId }) => {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) throw new Error("SITE_URL_MISSING");
    const [connector, event] = await Promise.all([ctx.db.get(connectorId), ctx.db.get(eventId)]);
    if (!connector || !event) throw new Error("CONNECTOR_EXPORT_CONTEXT");
    return { eventUrl: siteUrl.replace(/\/$/, "") + await eventPathForRecord(ctx.db, event), ...googleTarget(connector) };
  },
});

// Export dedupe must not claim a Google item another VRDex event holds; a held draft's link stays matchable so completeJob adopts it.
export const linkedExternalIds = internalQuery({
  args: { connectorId: v.id("eventConnectors"), externalIds: v.array(v.string()) },
  handler: async (ctx, { connectorId, externalIds }) => {
    const linked: string[] = [];
    for (const externalId of externalIds) {
      const links = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).take(10);
      if (links.some(link => link.eventId !== undefined)) linked.push(externalId);
    }
    return linked;
  },
});

const siteUrl = () => {
  const url = process.env.SITE_URL;
  if (!url) throw new Error("SITE_URL_MISSING");
  return url;
};

const linkByExternalId = (db: DatabaseReader, connectorId: Doc<"eventConnectors">["_id"], externalId: string) =>
  db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).unique();

// Same community, local date, and trimmed title ignoring case; an event already linked on this connector belongs to another item.
async function matchEvent(db: DatabaseReader, connector: Doc<"eventConnectors">, fields: EventIntakeFields) {
  const title = fields.title?.toLowerCase();
  const eventDate = fields.eventDate;
  if (!title || !eventDate) return null;
  const events = await db.query("events").withIndex("by_communityProfileId_eventDate", q => q.eq("communityProfileId", connector.communityProfileId).eq("eventDate", eventDate)).take(50);
  for (const event of events) {
    if (!event.slug || event.title.trim().slice(0, 120).trim().toLowerCase() !== title) continue;
    const links = await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", event._id)).take(100);
    if (!links.some(link => link.connectorId === connector._id)) return event;
  }
  return null;
}

export const applyImport = internalMutation({
  args: { connectorId: v.id("eventConnectors"), item: v.any(), calendarTimeZone: v.string() },
  handler: async (ctx, args): Promise<"skipped" | "unchanged" | "cancel_echo" | "flagged" | ApplyEventCandidateOutcome> => {
    const { db } = ctx;
    const item = args.item as GoogleCalendarEvent;
    const now = Date.now();
    const connector = await db.get(args.connectorId);
    if (connector?.state !== "active" || connector.direction === "export" || connector.direction === "off") return "skipped";
    let link = await linkByExternalId(db, connector._id, item.id);
    // Incremental sync may send a cancelled item with only its id and status.
    const updatedMs = Date.parse(item.updated) || now;
    if (link?.externalUpdatedAt !== undefined && link.externalUpdatedAt >= updatedMs) return "unchanged";

    // Google's cancelled never cancels a VRDex event; staff see the flag instead.
    if (item.status === "cancelled") {
      if (!link?.eventId) return "skipped";
      const seen = { lastImportedAt: now, externalUpdatedAt: updatedMs, updatedAt: now };
      // VRDex's own cancellation or retraction coming back.
      if ((await db.get(link.eventId))?.eventStatus === "cancelled" || link.state === "vrdex_retracted") {
        await db.patch(link._id, seen);
        return "cancel_echo";
      }
      await db.patch(link._id, { ...seen, state: "external_deleted" });
      return "flagged";
    }

    const fields = fieldsFromGoogleEvent(item, args.calendarTimeZone, siteUrl());
    if (outsideImportWindow(item, fields, args.calendarTimeZone)) return "skipped";
    const community = await db.get(connector.communityProfileId);
    if (!community?.slug) throw new Error("CONNECTOR_COMMUNITY");

    let decision: EventIntakeDecision = { kind: "new" };
    const linked = link?.eventId ? await db.get(link.eventId) : null;
    if (linked?.slug) decision = { kind: "update", slug: linked.slug };
    else if (!link) {
      const match = await matchEvent(db, connector, fields);
      if (match) {
        link = (await db.get(await db.insert("eventSyncLinks", { connectorId: connector._id, eventId: match._id, externalId: item.id, state: "linked", createdAt: now, updatedAt: now })))!;
        decision = { kind: "update", slug: match.slug! };
      }
    }

    // ponytail: a candidate time is "HH:MM" and cannot carry occurrence, so the echo of an event in the fall-back hour (one local
    // hour a year) misses the echo hash and files a held draft instead of skipped_echo; carry occurrence in the candidate contract if that hour matters.
    const { outcome } = await applyEventCandidate(ctx, {
      connector, candidate: candidateFromConnectorFields("google_calendar", { ...fields, communitySlug: community.slug }, decision),
      actorUserId: connector.authorityUserId, link: link ?? undefined, externalId: item.id, externalUpdatedAt: updatedMs,
      idempotencyKey: `google_calendar:${connector._id}:${item.id}:${updatedMs}`,
    });
    // applyEventCandidate records the import times itself; a pending draft leaves the link alone so this edit is not lost.
    if (item.recurringEventId && outcome !== "skipped_pending_draft") {
      const after = await linkByExternalId(db, connector._id, item.id);
      if (after) await db.patch(after._id, { externalSeriesId: item.recurringEventId });
    }
    return outcome;
  },
});

// Links matches without applying them and queues the rest for import. The runner already queued exports for unlinked events.
export const reconcileItems = internalMutation({
  args: { connectorId: v.id("eventConnectors"), items: v.any(), calendarTimeZone: v.string() },
  handler: async (ctx, args) => {
    const { db } = ctx;
    const now = Date.now();
    const connector = await db.get(args.connectorId);
    if (connector?.state !== "active") return;
    const importing = connector.direction === "import" || connector.direction === "bidirectional";
    for (const item of args.items as GoogleCalendarEvent[]) {
      if (item.status === "cancelled" || await linkByExternalId(db, connector._id, item.id)) continue;
      const fields = fieldsFromGoogleEvent(item, args.calendarTimeZone, siteUrl());
      const match = await matchEvent(db, connector, fields);
      if (match) await db.insert("eventSyncLinks", { connectorId: connector._id, eventId: match._id, externalId: item.id, state: "linked", createdAt: now, updatedAt: now });
      else if (importing && !outsideImportWindow(item, fields, args.calendarTimeZone)) {
        await enqueueSyncJob(db, ctx.scheduler, { connectorId: connector._id, kind: "import_item", payload: { item, calendarTimeZone: args.calendarTimeZone } });
      }
    }
  },
});

export const patchGoogleTarget = internalMutation({
  args: {
    connectorId: v.id("eventConnectors"),
    target: v.object({
      watchChannelId: v.optional(v.string()), watchResourceId: v.optional(v.string()), watchExpiresAt: v.optional(v.number()),
      watchRenewedAt: v.optional(v.number()), syncToken: v.optional(v.string()),
    }),
    syncedAt: v.optional(v.number()),
  },
  handler: async (ctx, { connectorId, target, syncedAt }) => {
    const connector = await ctx.db.get(connectorId);
    if (!connector) return;
    await ctx.db.patch(connectorId, { target: { ...connector.target, ...target }, ...(syncedAt === undefined ? {} : { lastSyncedAt: syncedAt }), updatedAt: Date.now() });
  },
});
