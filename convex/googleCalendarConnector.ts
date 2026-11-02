import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, query, type DatabaseReader, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import { encryptSecret } from "./_connectorCrypto";
import type { EventIntakeDecision, EventIntakeFields } from "../packages/api-contracts/src/event-intake";
import { applyEventCandidate, candidateFromConnectorFields, type ApplyEventCandidateOutcome } from "./_eventCandidateApply";
import { eventPathForRecord } from "./_eventPaths";
import { connectorsEnabled, requireConnectorAuthority } from "./_eventConnectors";
import { enqueueSyncJob, eventIsPublic } from "./_eventSync";
import { credentialConnectors, ensureWatch, googleCalendarEnabled, googleReauthKey, googleTarget, listCalendars as fetchCalendars, reportStaleWatches, revokeCredentialIfUnused, withGoogleToken, type GoogleCalendarEvent } from "./_googleCalendar";
import { notifyOps, resolveOps } from "./_opsAlerts";
import { fieldsFromGoogleEvent, isPrivateItem, outsideImportWindow } from "./eventSyncKinds/googleCalendar";

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
    const connectors = await credentialConnectors(ctx.db, credentialId);
    for (const connector of connectors) await ctx.db.patch(connector._id, { state: "needs_reauth", lastError: error, updatedAt: now });
    if (connectors.length) await notifyOps(ctx, {
      key: googleReauthKey(credentialId), subject: "Google Calendar connector needs reconnecting",
      body: connectors.map(connector => `Connector ${connector._id} for community profile ${connector.communityProfileId}`).join("\n"),
    });
  },
});

export const exportContext = internalQuery({
  args: { connectorId: v.id("eventConnectors"), eventId: v.id("events") },
  handler: async (ctx, { connectorId, eventId }) => {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) throw new Error("SITE_URL_MISSING");
    const [connector, event] = await Promise.all([ctx.db.get(connectorId), ctx.db.get(eventId)]);
    if (!connector || !event) throw new Error("CONNECTOR_EXPORT_CONTEXT");
    return { eventUrl: siteUrl.replace(/\/$/, "") + await eventPathForRecord(ctx.db, event), siteUrl, ...googleTarget(connector) };
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
    if (!event.slug || !eventIsPublic(event) || event.title.trim().slice(0, 120).trim().toLowerCase() !== title) continue;
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
      if (!link) return "skipped";
      const seen = { lastImportedAt: now, externalUpdatedAt: updatedMs, updatedAt: now };
      // VRDex's own cancellation or retraction coming back. A held draft's link has no event: staff see the flag and the draft stays theirs.
      if ((link.eventId && (await db.get(link.eventId))?.eventStatus === "cancelled") || link.state === "vrdex_retracted") {
        await db.patch(link._id, seen);
        return "cancel_echo";
      }
      await db.patch(link._id, { ...seen, state: "external_deleted" });
      return "flagged";
    }

    // The organiser restored it, so exports may touch it again.
    if (link?.state === "external_deleted") {
      await db.patch(link._id, { state: "linked", flagReviewedAt: undefined, updatedAt: now });
      link = { ...link, state: "linked" };
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
    // applyEventCandidate records the import times itself.
    if (item.recurringEventId) {
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
    // Outside the loop's catch: a missing SITE_URL fails the job, it does not make every item unreadable.
    const site = siteUrl();
    for (const item of args.items as GoogleCalendarEvent[]) {
      // A private item stays out of matching too: a link would let a bidirectional export patch it.
      if (item.status === "cancelled" || isPrivateItem(item) || await linkByExternalId(db, connector._id, item.id)) continue;
      let fields: EventIntakeFields;
      try {
        fields = fieldsFromGoogleEvent(item, args.calendarTimeZone, site);
      } catch {
        // It can never import, so a job from every daily sweep would only burn attempts. The poll that lists it queues it once;
        // there it retries on its own job, and its final failure shows in lastError until the next successful job.
        continue;
      }
      const match = await matchEvent(db, connector, fields);
      if (match) await db.insert("eventSyncLinks", { connectorId: connector._id, eventId: match._id, externalId: item.id, state: "linked", createdAt: now, updatedAt: now });
      else if (importing && !outsideImportWindow(item, fields, args.calendarTimeZone)) {
        await enqueueSyncJob(db, ctx.scheduler, { connectorId: connector._id, kind: "import_item", payload: { item, calendarTimeZone: args.calendarTimeZone } });
      }
    }
  },
});

export const enqueueImportItem = internalMutation({
  args: { connectorId: v.id("eventConnectors"), item: v.any(), calendarTimeZone: v.string() },
  handler: async (ctx, { connectorId, item, calendarTimeZone }) => {
    await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind: "import_item", payload: { item, calendarTimeZone } });
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

// The notify route's token carries the id as text; a forged one may not be an id at all.
export const notifyTarget = internalQuery({
  args: { connectorId: v.string() },
  handler: async (ctx, { connectorId }) => {
    const id = ctx.db.normalizeId("eventConnectors", connectorId);
    return id ? await ctx.db.get(id) : null;
  },
});

async function enqueueOnce(ctx: MutationCtx, connectorId: Id<"eventConnectors">, kind: "import_poll" | "reconcile", dueAt?: number) {
  const pending = await ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connectorId).eq("eventId", undefined).eq("state", "pending")).collect();
  if (pending.some(job => job.kind === kind)) return;
  await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, kind, dueAt });
}

// Google sends a burst of notifications per change; a job leaves pending in milliseconds, so the delay is what lets one poll cover them all.
const enqueuePollOnce = (ctx: MutationCtx, connectorId: Id<"eventConnectors">) => enqueueOnce(ctx, connectorId, "import_poll", Date.now() + 30_000);

export const enqueuePoll = internalMutation({
  args: { connectorId: v.id("eventConnectors") },
  handler: (ctx, { connectorId }) => enqueuePollOnce(ctx, connectorId),
});

async function googleConnectors(db: DatabaseReader) {
  if (!connectorsEnabled() || !googleCalendarEnabled()) return [];
  // ponytail: reads every google_calendar connector; add a by_kind_state index when they pass a few hundred.
  return await db.query("eventConnectors").withIndex("by_kind_target_channelId", q => q.eq("kind", "google_calendar")).collect();
}

async function importingConnectors(db: DatabaseReader) {
  return (await googleConnectors(db)).filter(c => c.state === "active" && (c.direction === "import" || c.direction === "bidirectional"));
}

// The safety net under push: a lost notification or a dead channel costs at most one interval.
export const enqueuePolls = internalMutation({
  args: {},
  handler: async ctx => {
    for (const connector of await importingConnectors(ctx.db)) await enqueuePollOnce(ctx, connector._id);
  },
});

export const watchedConnectors = internalQuery({
  args: {},
  handler: ctx => importingConnectors(ctx.db),
});

export const allGoogleConnectors = internalQuery({
  args: {},
  handler: ctx => googleConnectors(ctx.db),
});

// `error` is a code; it reaches the settings page and the ops alert email.
export const recordWatchError = internalMutation({
  args: { connectorId: v.id("eventConnectors"), error: v.string() },
  handler: (ctx, { connectorId, error }) => ctx.db.patch(connectorId, { lastError: error, updatedAt: Date.now() }),
});

const DAY_MS = 86_400_000;

// Incremental sync only returns changed items, so a recurring instance past the 60-day window at connect would never import; the daily reconcile rolls the window forward.
// The same pass retires credentials from abandoned connects: Connect stores one before the staffer picks a calendar.
export const dailySweep = internalMutation({
  args: {},
  handler: async ctx => {
    // googleConnectors is empty with a flag off, which would read below as every credential being unused.
    if (!connectorsEnabled() || !googleCalendarEnabled()) return;
    for (const connector of await importingConnectors(ctx.db)) await enqueueOnce(ctx, connector._id, "reconcile");
    const now = Date.now();
    const inUse = new Set((await googleConnectors(ctx.db)).filter(connector => connector.state !== "removed").map(connector => connector.credentialId));
    // ponytail: connectorCredentials has no index, so this scans the table once a day; add by_provider_state if it outgrows that.
    for (const credential of await ctx.db.query("connectorCredentials").collect()) {
      if (credential.provider !== "google" || credential.state !== "active" || credential.createdAt > now - DAY_MS || inUse.has(credential._id)) continue;
      await ctx.db.patch(credential._id, { state: "revoked", updatedAt: now });
    }
  },
});

// Channels last seven days; renew any with a day or less left, and open one where none exists.
// The staleness check runs after the renewals, so a renewal that just failed is what gets reported.
export const renewWatches = internalAction({
  args: {},
  handler: async ctx => {
    for (const connector of await ctx.runQuery(internal.googleCalendarConnector.watchedConnectors, {})) {
      const { watchChannelId, watchExpiresAt } = connector.target;
      if (watchChannelId && (watchExpiresAt ?? 0) - Date.now() > DAY_MS) continue;
      try {
        await ensureWatch(ctx, connector, true);
      } catch (error) {
        await ctx.runMutation(internal.googleCalendarConnector.recordWatchError, { connectorId: connector._id, error: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
      }
    }
    const connectors = await ctx.runQuery(internal.googleCalendarConnector.allGoogleConnectors, {});
    await reportStaleWatches(connectors, Date.now(), alert => notifyOps(ctx, alert), key => resolveOps(ctx, key));
  },
});

// Connect and Reconnect. The web callback exchanges the code (it holds the client secret); only Convex holds the token key.
async function authorizeConnectFor(ctx: QueryCtx | MutationCtx, args: { actorUserId: Id<"users">; communitySlug: string; connectorId?: Id<"eventConnectors"> }) {
  if (!connectorsEnabled()) throw new ConvexError({ code: "CONNECTORS_DISABLED" });
  if (!googleCalendarEnabled()) throw new ConvexError({ code: "CONNECTOR_KIND_DISABLED" });
  const community = await ctx.db.query("profiles").withIndex("by_slug", q => q.eq("slug", args.communitySlug)).unique();
  if (community?.profileType !== "community") throw new ConvexError({ code: "CONNECTOR_FORBIDDEN" });
  await requireConnectorAuthority(ctx, community._id, args.actorUserId);
  const connector = args.connectorId ? await ctx.db.get(args.connectorId) : null;
  if (args.connectorId && (connector?.kind !== "google_calendar" || connector.communityProfileId !== community._id || connector.state === "removed")) {
    throw new ConvexError({ code: "CONNECTOR_NOT_FOUND" });
  }
  return { communityProfileId: community._id, connector };
}

const connectArgs = { actorUserId: v.id("users"), communitySlug: v.string(), connectorId: v.optional(v.id("eventConnectors")) };

export const authorizeConnect = internalQuery({
  args: connectArgs,
  handler: async (ctx, args) => ({ communityProfileId: (await authorizeConnectFor(ctx, args)).communityProfileId }),
});

export const insertCredential = internalMutation({
  args: { ...connectArgs, accessTokenExpiresAt: v.number(), scopes: v.array(v.string()), externalAccountId: v.string(), encryptedAccessToken: v.string(), encryptedRefreshToken: v.string() },
  handler: async (ctx, { actorUserId, communitySlug, connectorId, ...grant }) => {
    // Authorised again here, so a connector removed while the tokens were encrypted is not revived.
    const { connector } = await authorizeConnectFor(ctx, { actorUserId, communitySlug, connectorId });
    const now = Date.now();
    const credentialId = await ctx.db.insert("connectorCredentials", { provider: "google", ownerUserId: actorUserId, ...grant, state: "active", createdAt: now, updatedAt: now });
    if (connector) {
      // The old channel belongs to the old grant; reconcile opens a fresh one. The reconnecting staffer becomes the authority, as on Resume.
      const { watchChannelId: _channel, watchResourceId: _resource, watchExpiresAt: _expires, watchRenewedAt: _renewed, ...target } = connector.target;
      const previous = connector.credentialId ? await ctx.db.get(connector.credentialId) : null;
      // A sync token belongs to the account that listed it; a different account starts a full sync.
      if (previous?.externalAccountId !== grant.externalAccountId) delete target.syncToken;
      await ctx.db.patch(connector._id, { credentialId, authorityUserId: actorUserId, state: "active", lastError: undefined, target, updatedAt: now });
      if (connector.direction !== "off") await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "reconcile" });
      if (previous) await revokeCredentialIfUnused(ctx, previous._id);
    }
    return credentialId;
  },
});

export const storeCredential = internalAction({
  args: { ...connectArgs, accessToken: v.string(), refreshToken: v.string(), expiresAt: v.number(), scopes: v.array(v.string()), externalAccountId: v.string() },
  handler: async (ctx, { accessToken, refreshToken, expiresAt, ...rest }): Promise<{ credentialId: Id<"connectorCredentials"> }> => {
    const credentialId: Id<"connectorCredentials"> = await ctx.runMutation(internal.googleCalendarConnector.insertCredential, {
      ...rest, accessTokenExpiresAt: expiresAt, encryptedAccessToken: await encryptSecret(accessToken), encryptedRefreshToken: await encryptSecret(refreshToken),
    });
    return { credentialId };
  },
});

export const ownCredential = internalQuery({
  args: { credentialId: v.id("connectorCredentials") },
  handler: async (ctx, { credentialId }) => {
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    if (!connectorsEnabled() || !googleCalendarEnabled()) throw new ConvexError({ code: "CONNECTOR_KIND_DISABLED" });
    const credential = await ctx.db.get(credentialId);
    if (credential?.provider !== "google" || credential.ownerUserId !== userId || credential.state !== "active") throw new ConvexError({ code: "CONNECTOR_FORBIDDEN" });
  },
});

export const listCalendars = action({
  args: { credentialId: v.id("connectorCredentials") },
  handler: async (ctx, { credentialId }): Promise<Array<{ id: string; summary: string; primary?: boolean }>> => {
    await ctx.runQuery(internal.googleCalendarConnector.ownCredential, { credentialId });
    return await withGoogleToken(ctx, credentialId, fetchCalendars);
  },
});

export const enabled = query({
  args: {},
  returns: v.boolean(),
  handler: () => googleCalendarEnabled() && connectorsEnabled(),
});
