import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalMutation, internalQuery, query, type ActionCtx, type DatabaseReader, type DatabaseWriter, type MutationCtx } from "../_generated/server";
import { requireActiveBrowserSessionSubject } from "../_browserSessionAuthority";
import { discordRequest } from "../_discordRest";
import { DISCORD_IMAGE_MAX_BYTES, parseScheduledEvent, patchKeepingDescription, RECONCILE_HORIZON_MS, scheduledEventCandidateFields, scheduledEventOccurrences, scheduledEventToFields, toScheduledEventBody, type DiscordScheduledEvent, type DiscordScheduledEventBody, type ScheduledEventSource } from "../_discordScheduledEventMap";
import { applyEventCandidate, candidateFromConnectorFields } from "../_eventCandidateApply";
import { carriedFieldsHash, DISCORD_ID, discordScheduledEventsEnabled, pendingLinkDraft, requireConnectorAuthority, sha256Hex } from "../_eventConnectors";
import { eventDateForInstant, readEventSchedule } from "../_eventSchedule";
import { occurrenceTimes, seriesEnded } from "../_eventSeries";
import { connectorSeriesEnabled, type SeriesRule } from "../_eventSeriesModel";
import { seriesHash, seriesSyncFields, upcomingSeriesNights, type ExternalSeries } from "../_eventSeriesSync";
import { enqueueSyncJob, eventIsSyncable } from "../_eventSync";
import { listActiveControlProofsForUser, meetsControlLevel, MINIMUM_COMMUNITY_CONTROL_LEVEL } from "../_externalControl";
import { formatDiscordRecurrence, parseDiscordRecurrence } from "../_recurrenceRules";
import { applyExternalSeriesFor, seriesExportContextFor } from "../eventSeriesSync";
import { correctionFields } from "../eventCorrections";
import { EventIntakeLocalTimeSchema } from "../../packages/api-contracts/src/event-intake";
import { liveMessageId as liveExternalId, pause, publicEventProjection, readObject } from "./discordBoard";
import type { ExportResult, SyncKindHandler } from "./types";

type Connector = Doc<"eventConnectors">;
// `externalIds` limits a reconcile's job to the nights it could not place. A relayed job has none and walks every night.
export type ScheduledEventJobPayload = { action: "create" | "update" | "delete"; event: DiscordScheduledEvent; receivedAt: number; externalIds?: string[] };

const ARTWORK_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);
const BASE64_CHUNK = 0x8000; // String.fromCharCode's spread overflows the stack on a whole image.
const KIND = "discord_scheduled_events";
const MATCH_WINDOW_MS = 36 * 3_600_000; // Wide enough for any zone's local date around an instant.

const importing = (connector: Connector) => connector.state === "active" && (connector.direction === "import" || connector.direction === "bidirectional");

export const isEnabled = query({ args: {}, handler: async (): Promise<boolean> => discordScheduledEventsEnabled() });

/** Guilds the signed-in staffer has a usable proof over, once they pass the community's connector authority. `create` re-checks the chosen one. */
export const provedGuildIds = internalQuery({
  args: { communityProfileId: v.id("profiles") },
  handler: async (ctx, { communityProfileId }): Promise<string[]> => {
    const { userId } = await requireActiveBrowserSessionSubject(ctx);
    await requireConnectorAuthority(ctx, communityProfileId, userId);
    const now = Date.now();
    return (await listActiveControlProofsForUser(ctx.db, userId))
      .filter(proof => proof.assetType === "discord_guild" && (proof.revalidateAfter === undefined || proof.revalidateAfter > now) && meetsControlLevel(proof.controlLevel, MINIMUM_COMMUNITY_CONTROL_LEVEL))
      .map(proof => proof.assetExternalId);
  },
});

/** Servers the bot is in that the staffer has proved they manage, by name, for the connect picker. */
export const listConnectableGuilds = action({
  args: { communityProfileId: v.id("profiles") },
  handler: async (ctx, args): Promise<Array<{ id: string; name: string }>> => {
    if (!discordScheduledEventsEnabled()) throw new ConvexError({ code: "CONNECTOR_KIND_DISABLED" });
    const proved = new Set(await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.provedGuildIds, args));
    // ponytail: one page of 200 bot guilds; paginate with `after` when the bot passes 200 servers.
    const response = await discordRequest({ method: "GET", path: "/users/@me/guilds?limit=200" });
    if (!response.ok) throw new ConvexError({ code: `discord_${response.status}` });
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new ConvexError({ code: "discord_bad_response" });
    return rows
      .filter((row): row is { id: string; name: string } => proved.has(row?.id) && typeof row.name === "string")
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One `import_item` job per active importing connector on the guild; returns how many were enqueued. */
export const relayScheduledEvent = internalMutation({
  args: { action: v.union(v.literal("create"), v.literal("update"), v.literal("delete")), guildId: v.string(), payload: v.any(), receivedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, { action, guildId, payload, receivedAt }) => {
    const event = parseScheduledEvent(payload);
    if (!discordScheduledEventsEnabled() || !DISCORD_ID.test(guildId) || event?.guild_id !== guildId) return 0;
    const connectors = await ctx.db.query("eventConnectors").withIndex("by_kind_target_guildId", q => q.eq("kind", "discord_scheduled_events").eq("target.guildId", guildId)).collect();
    const targets = connectors.filter(importing);
    const job: ScheduledEventJobPayload = { action, event, receivedAt };
    for (const connector of targets) await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "import_item", payload: job });
    return targets.length;
  },
});

/** The event as the export reads it, or null when it is not public. */
export async function loadScheduledEventSource(db: DatabaseReader, event: Doc<"events">): Promise<ScheduledEventSource | null> {
  const projection = await publicEventProjection(db, event);
  if (!projection) return null;
  const { title, summary, venueLabel, worlds, startAt, endAt, timezone, status, url, artworkImageUrl, scheduleKind } = projection;
  return { title, summary, venueLabel, worldNames: worlds.map(world => world.displayName), startAt: scheduleKind === "date_only" ? undefined : startAt, endAt, timezone, status, url, artworkImageUrl };
}

export const getExportState = internalQuery({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<ScheduledEventSource | null> => {
    const event = await ctx.db.get(eventId);
    return event && await loadScheduledEventSource(ctx.db, event);
  },
});

const linkByExternalId = (db: DatabaseReader, connectorId: Id<"eventConnectors">, externalId: string) =>
  db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).unique();
const linkForEvent = async (db: DatabaseReader, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  (await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).take(100)).find(link => link.connectorId === connectorId) ?? null;
const seriesLinkByExternalId = async (db: DatabaseReader, connectorId: Id<"eventConnectors">, externalId: string) => {
  const link = await linkByExternalId(db, connectorId, externalId);
  return link?.seriesId !== undefined && link.eventId === undefined ? link : null;
};

// What the rows say after the guild list: a reconcile can link this event after the claim, and completeJob writes the export's answer over that row.
// ponytail: a link written between this read and completeJob is still overwritten; completeJob comparing the row with its claim would close that.
export const getExportLinks = internalQuery({
  args: { connectorId: v.id("eventConnectors"), eventId: v.id("events"), externalIds: v.array(v.string()) },
  handler: async (ctx, { connectorId, eventId, externalIds }): Promise<{ current: Doc<"eventSyncLinks"> | null; taken: string[] }> => {
    const current = await linkForEvent(ctx.db, connectorId, eventId);
    const taken: string[] = [];
    for (const externalId of externalIds) {
      const row = await linkByExternalId(ctx.db, connectorId, externalId);
      // completeJob adopts a held draft's row only for an event with no row of its own; otherwise two rows share the ID and linkByExternalId throws on it from then on.
      if (row && (row.eventId ? row.eventId !== eventId : current)) taken.push(externalId);
    }
    return { current, taken };
  },
});

// A syncable community event on the item's local night, in the event's own zone, with the same title.
// Any link but a `none:` one means the event is taken: by another Discord event, a night of a series, or a copy staff were flagged about.
export async function findTitleDateMatch(db: DatabaseReader, connector: Connector, title: string, startAt: number): Promise<Doc<"events"> | null> {
  const name = title.trim().toLowerCase();
  const events = await db.query("events").withIndex("by_communityProfileId_sortAt", q => q.eq("communityProfileId", connector.communityProfileId).gte("sortAt", startAt - MATCH_WINDOW_MS).lte("sortAt", startAt + MATCH_WINDOW_MS)).take(150);
  for (const event of events) {
    if (!event.slug || !eventIsSyncable(event) || event.title.trim().toLowerCase() !== name) continue;
    if (readEventSchedule(event).eventDate !== eventDateForInstant(startAt, event.timezone ?? "UTC")) continue;
    const link = await linkForEvent(db, connector._id, event._id);
    if (!link || link.externalId.startsWith("none:")) return event;
  }
  return null;
}

// One event, one link per connector: a `none:` row takes the ID and drops its export fields, since nothing was sent to this item.
// The series ID goes on here, not after the import: a matched night that imports nothing must still read as a night to exports.
export async function linkTitleDateMatch(db: DatabaseWriter, connector: Connector, title: string, occurrence: { externalId: string; externalSeriesId?: string; startAt: number }): Promise<Doc<"eventSyncLinks"> | null> {
  const match = await findTitleDateMatch(db, connector, title, occurrence.startAt);
  if (!match) return null;
  const { externalId, externalSeriesId } = occurrence;
  const now = Date.now();
  const placeholder = await linkForEvent(db, connector._id, match._id);
  if (!placeholder) return await db.get(await db.insert("eventSyncLinks", { connectorId: connector._id, eventId: match._id, externalId, externalSeriesId, state: "linked", createdAt: now, updatedAt: now }));
  await db.patch(placeholder._id, { externalId, externalSeriesId, state: "linked", flagReviewedAt: undefined, lastExportedAt: undefined, lastExportedHash: undefined, updatedAt: now });
  return await db.get(placeholder._id);
}

const iso = (at: number) => new Date(at).toISOString();

/**
 * The series as its scheduled event carries it: the first night ahead lends its worlds and artwork, the series its own fields, times,
 * and URL. With no night ahead there is nothing to export, but an import still reads Discord's copy against it, in the series' zone.
 */
async function loadSeriesExportState(db: DatabaseReader, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">) {
  const context = await seriesExportContextFor(db, connectorId, seriesId);
  const { series, firstNight, seriesUrl } = context;
  const night = firstNight && await loadScheduledEventSource(db, firstNight);
  const times = occurrenceTimes(series, firstNight?.occurrenceDate ?? series.startsOn) ?? firstNight;
  const source: ScheduledEventSource = {
    title: series.title, summary: series.summary, venueLabel: series.venueLabel, worldNames: night?.worldNames ?? [], startAt: times?.startAt, endAt: times?.endAt,
    timezone: series.timezone, status: "scheduled", url: seriesUrl, artworkImageUrl: night?.artworkImageUrl,
  };
  return { ...context, source };
}

export const getSeriesExportState = internalQuery({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.id("eventSeries") },
  handler: (ctx, { connectorId, seriesId }) => loadSeriesExportState(ctx.db, connectorId, seriesId),
});

// Discord cannot repeat on a last weekday: such a series goes out night by night, as plan 07 sends one-offs.
const carriedOnDiscord = (rule: SeriesRule) => formatDiscordRecurrence(rule, "") !== null;

/**
 * A recurring scheduled event as one series, or null without a rule. `linked` is the series' own source when one is linked here, so
 * the export's echo reads back as the series (its URL line, venue fallback, and fallback end included); unlinked items read in UTC,
 * as phase one did. Discord sets `end` and `count` itself, and phase one honours them, so a rule with either is outside the set.
 */
export function seriesFromScheduledEvent(event: DiscordScheduledEvent, linked: ScheduledEventSource | null): ExternalSeries | null {
  const rule = event.recurrence_rule;
  if (!rule) return null;
  // Discord sends no update time; an import replaces this with the packet's receipt time.
  const external = { externalSeriesId: event.id, externalUpdatedAt: Date.now(), deleted: event.status === 4, fields: null };
  if (rule.end || rule.count !== null) return external;
  const fields = scheduledEventToFields(event, linked);
  const timezone = fields.timezone ?? "UTC";
  if (!fields.title || !fields.start) return external;
  const parsed = parseDiscordRecurrence(rule, {
    date: eventDateForInstant(Date.parse(rule.start), timezone), timezone, startTime: fields.start.time, ...(fields.end ? { endTime: fields.end.time } : {}),
  });
  if (!parsed) return external;
  // endsOn and count stay undefined: Discord does not carry VRDex's, so the series keeps its own.
  return { ...external, fields: { title: fields.title, summary: fields.summary ?? null, venueLabel: fields.venueLabel ?? null, timezone, rule: parsed.rule, startsOn: parsed.startsOn } };
}

/** The scheduled event as a series, read once by ID. A missing one is a deletion. */
export async function fetchExternalSeries(ctx: ActionCtx, connector: Connector, externalSeriesId: string): Promise<ExternalSeries> {
  const event = parseScheduledEvent(await liveEvent(ctx, connector, `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events/${externalSeriesId}`));
  // A missing event has no clock; 0 leaves the link's own, as Google's master read does.
  if (!event) return { externalSeriesId, externalUpdatedAt: 0, deleted: true, fields: null };
  return seriesFromScheduledEvent(event, null) ?? { externalSeriesId, externalUpdatedAt: Date.now(), deleted: false, fields: null };
}

/**
 * With the series gate on, a recurring item or one whose series is linked here is a series. Returns whether it took the item;
 * when it does not, phase one runs: an unlinked item outside the fixed set, or on a held connector.
 */
async function importScheduledEventSeries(ctx: MutationCtx, connector: Connector, { action, receivedAt, externalIds }: ScheduledEventJobPayload, item: DiscordScheduledEvent): Promise<boolean> {
  const { db } = ctx;
  const link = await seriesLinkByExternalId(db, connector._id, item.id);
  if (!link && !item.recurrence_rule) return false;
  // A held connector keeps phase one until a series is linked, then leaves that series alone, cancellations included (R3).
  // A reconcile's receipt time is always newer than a VRDex edit, so its job never replays over a linked series.
  if (link) {
    if (connector.mode === "hold" || externalIds) return true;
  } else if (connector.mode === "hold") return false;
  // A rule removed on Discord leaves no series: staff decide, as for a deletion.
  const deleted = action === "delete" || item.status === 4 || !item.recurrence_rule;
  if (!deleted && item.status === 3) return true;
  let linked: ScheduledEventSource | null = null;
  if (link?.seriesId) {
    // The export context throws without these, and a retry cannot bring them back: leave the packet, as an export would fail it.
    const series = await db.get(link.seriesId);
    const community = series && await db.get(series.communityProfileId);
    if (!series || !community?.slug || !process.env.SITE_URL) {
      console.warn("DISCORD_SERIES_CONTEXT_MISSING", connector._id, link.seriesId);
      return true;
    }
    const { today, source } = await loadSeriesExportState(db, connector._id, link.seriesId);
    // VRDex's own cancel coming back, possibly before completeJob has recorded the export that sent it.
    if (deleted && action !== "delete" && (seriesEnded(series, today) || !carriedOnDiscord(series.rule))) {
      const now = Date.now();
      await db.patch(link._id, { lastImportedAt: now, externalUpdatedAt: Math.max(link.externalUpdatedAt ?? 0, receivedAt), updatedAt: now });
      return true;
    }
    linked = source;
  }
  const external = deleted ? null : seriesFromScheduledEvent(item, linked);
  const { outcome } = await applyExternalSeriesFor(ctx, {
    connectorId: connector._id, externalSeriesId: item.id, externalUpdatedAt: receivedAt, deleted: deleted || external!.deleted, fields: external?.fields ?? undefined,
  });
  return outcome !== "skipped";
}

export const applyScheduledEventImport = internalMutation({
  args: { connectorId: v.id("eventConnectors"), payload: v.any() },
  handler: async (ctx, { connectorId, payload }): Promise<void> => {
    const { db } = ctx;
    const { action, event: raw, receivedAt, externalIds } = payload as ScheduledEventJobPayload;
    const connector = await db.get(connectorId);
    const item = parseScheduledEvent(raw);
    if (!connector || !importing(connector) || !item || item.guild_id !== connector.target.guildId) return;
    if (connectorSeriesEnabled() && await importScheduledEventSeries(ctx, connector, payload as ScheduledEventJobPayload, item)) return;
    const now = Date.now();
    const seen = { lastImportedAt: now, externalUpdatedAt: receivedAt, updatedAt: now };

    // Discord's cancel and delete never touch a VRDex event; staff see the flag instead.
    if (action === "delete" || item.status === 4) {
      // `;` sorts just after `:`, but a longer ID sorts inside the range too, so it still needs the filter.
      const links = await db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connector._id).gte("externalId", item.id).lt("externalId", `${item.id};`)).collect();
      for (const link of links) {
        if (link.externalId !== item.id && !link.externalId.startsWith(`${item.id}:`)) continue;
        // VRDex's own write coming back. A held draft's link has no event: staff see the flag and the draft stays theirs.
        const own = action === "delete" ? link.state === "vrdex_retracted" : link.eventId && (await db.get(link.eventId))?.eventStatus === "cancelled";
        await db.patch(link._id, own ? seen : { ...seen, state: "external_deleted" });
      }
      return;
    }
    if (item.status === 3) return;

    // Discord's cancel and delete are terminal, so nothing restores those links. Relay jobs are not serialised, so an older one can run last.
    const settled = (link: Doc<"eventSyncLinks">) => link.state !== "linked" || (link.externalUpdatedAt !== undefined && link.externalUpdatedAt >= receivedAt);
    const occurrences = scheduledEventOccurrences(item, now);
    // ponytail: every night runs in this one mutation and each match reads up to 150 events; split the walk into a job per night if a daily series outgrows a mutation.
    for (const occurrence of occurrences) {
      const { externalId, externalSeriesId, startAt, endAt } = occurrence;
      // A reconcile's receipt time is always newer than a VRDex edit, so a linked night it reached would lose that edit with no Discord change behind it.
      if (externalIds && !externalIds.includes(externalId)) continue;
      let link = await linkByExternalId(db, connector._id, externalId);
      if (link && settled(link)) continue;
      if (!link?.eventId && startAt <= now) continue;
      link ??= await linkTitleDateMatch(db, connector, item.name, occurrence);
      const event = link?.eventId ? await db.get(link.eventId) : null;
      const source = event && await loadScheduledEventSource(db, event);
      if (link?.eventId && !source) continue;

      const night = { ...item, scheduled_start_time: iso(startAt), scheduled_end_time: endAt === null ? null : iso(endAt) };
      // Any packet for a series walks every night, a status change included. A night Discord states as it did last time has no edit to carry, and a VRDex edit would read as one.
      const nightHash = externalSeriesId ? carriedFieldsHash(KIND, scheduledEventToFields(night, null)) : undefined;
      if (link && nightHash && link.lastImportedHash === nightHash) {
        await db.patch(link._id, seen);
        continue;
      }
      const fields = scheduledEventToFields(night, source);
      // A span past the intake's day range can never import, and would only burn the job's attempts.
      if ([fields.start, fields.end].some(time => time && !EventIntakeLocalTimeSchema.safeParse(time).success)) continue;
      const hash = carriedFieldsHash(KIND, fields);
      // The gateway pushes our PATCH back, possibly before completeJob has written lastExportedHash, so compare with the event itself. Google polls and never hit this.
      // ponytail: correctionFields throws on an 81-row lineup or a time past the day range, and that fails the whole walk through its attempts; skip the night in a try/catch if it ever fires.
      // Exports wait on a pending draft, so nothing can echo there: this is an edit back to the event, and the draft must take it.
      if (link && event && !await pendingLinkDraft(db, link, now) && hash === carriedFieldsHash(KIND, await correctionFields(db, event))) {
        await db.patch(link._id, { ...seen, lastImportedHash: nightHash });
        continue;
      }

      await applyEventCandidate(ctx, {
        connector, candidate: candidateFromConnectorFields(KIND, scheduledEventCandidateFields(fields), event?.slug ? { kind: "update", slug: event.slug } : { kind: "new" }),
        actorUserId: connector.authorityUserId, link: link ?? undefined, externalId, externalUpdatedAt: receivedAt, expectedUpdatedAt: event?.updatedAt,
        // Hashed: publishing caps a key at 128 characters, and this one spells out a 64-character hash.
        idempotencyKey: sha256Hex(`${KIND}:${connector._id}:${externalId}:${hash}`),
      });
      const after = await linkByExternalId(db, connector._id, externalId);
      if (after) await db.patch(after._id, { ...(externalSeriesId ? { externalSeriesId } : {}), lastImportedHash: nightHash, lastImportedAt: now, updatedAt: now });
    }

    // A moved or shortened series leaves its old nights public, so staff get the same flag as a delete. Only a relayed job has walked the whole rule.
    if (externalIds || !item.recurrence_rule) return;
    const nights = new Set(occurrences.map(occurrence => occurrence.externalId));
    const today = iso(now).slice(0, 10);
    const links = await db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connector._id).gte("externalId", `${item.id}:`).lt("externalId", `${item.id};`)).collect();
    for (const link of links) {
      if (!settled(link) && link.externalId.slice(item.id.length + 1) > today && !nights.has(link.externalId)) await db.patch(link._id, { ...seen, state: "external_deleted" });
    }
  },
});

// Links matches without applying them and queues the rest for import, one job per item. The runner already queued exports for unlinked events.
// ponytail: a link missing from the list stays as it is, so a delete made while the gateway was down goes unflagged; compare the list with the window's links if that matters.
export const applyReconcile = internalMutation({
  args: { connectorId: v.id("eventConnectors"), items: v.array(v.any()), receivedAt: v.number() },
  returns: v.object({ linked: v.number(), imports: v.number() }),
  handler: async (ctx, { connectorId, items, receivedAt }) => {
    const { db } = ctx;
    const counts = { linked: 0, imports: 0 };
    const connector = await db.get(connectorId);
    if (connector?.state !== "active" || connector.direction === "off") return counts;
    const now = Date.now();
    for (const raw of items) {
      const item = parseScheduledEvent(raw);
      if (!item || item.guild_id !== connector.target.guildId || item.status > 2) continue;
      // A series linked here owns its nights: the series export carries them, so a phase-one match would only rewrite their links.
      if (connectorSeriesEnabled() && await seriesLinkByExternalId(db, connectorId, item.id)) continue;
      const unmatched: string[] = [];
      for (const occurrence of scheduledEventOccurrences(item, now)) {
        if (occurrence.startAt < now || occurrence.startAt > now + RECONCILE_HORIZON_MS || await linkByExternalId(db, connectorId, occurrence.externalId)) continue;
        if (await linkTitleDateMatch(db, connector, item.name, occurrence)) counts.linked++;
        else unmatched.push(occurrence.externalId);
      }
      if (unmatched.length === 0 || !importing(connector)) continue;
      const job: ScheduledEventJobPayload = { action: "create", event: item, receivedAt, externalIds: unmatched };
      await enqueueSyncJob(db, ctx.scheduler, { connectorId, kind: "import_item", payload: job });
      counts.imports++;
    }
    return counts;
  },
});

/** The daily cron: one reconcile per active connector, which the runner retries and alarms on. */
export const enqueueReconciles = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (!discordScheduledEventsEnabled()) return 0;
    let enqueued = 0;
    // ponytail: one mutation walks every connector of this kind; paginate if they reach the thousands.
    for await (const connector of ctx.db.query("eventConnectors").withIndex("by_kind_target_guildId", q => q.eq("kind", KIND))) {
      if (connector.state !== "active" || connector.direction === "off") continue;
      // Collected, not taken: import jobs share this range and arrive in bursts, so a capped read could miss the reconcile.
      const pending = await ctx.db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connector._id).eq("eventId", undefined).eq("state", "pending")).collect();
      if (pending.some(job => job.kind === "reconcile")) continue;
      await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId: connector._id, kind: "reconcile" });
      enqueued++;
    }
    return enqueued;
  },
});

/** The artwork as a data URI; on any failure the export goes out without a cover. */
export async function artworkDataUri(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!response.ok || !type || !ARTWORK_TYPES.has(type) || Number(response.headers.get("content-length")) > DISCORD_IMAGE_MAX_BYTES) return undefined;
    // ponytail: a body with no content-length is read whole before the size check; stream it with a running cap if artwork hosts ever turn hostile.
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > DISCORD_IMAGE_MAX_BYTES) return undefined;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

// Every method checks the flag and the guild first, so no Discord path is built from a bad target.
function scheduledEventsGuildId(connector: Connector): string {
  if (!discordScheduledEventsEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
  const { guildId } = connector.target;
  if (!guildId || !DISCORD_ID.test(guildId)) throw new Error("SCHEDULED_EVENTS_TARGET_INVALID");
  return guildId;
}

// With `missingOk` a 404 returns null: the event is gone, which the caller handles. Any other 404 is a failure.
async function send(ctx: ActionCtx, connector: Connector, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, missingOk = false): Promise<Response | null> {
  const response = await discordRequest({ method, path, body });
  if (response.ok) return response;
  if (response.status === 403) return pause(ctx, connector, "discord_forbidden");
  if (response.status === 404 && missingOk) return null;
  throw new Error(`discord_${response.status}`);
}

// The Discord event, or null when it is gone.
async function liveEvent(ctx: ActionCtx, connector: Connector, path: string): Promise<Record<string, unknown> | null> {
  const response = await send(ctx, connector, "GET", path, undefined, true);
  return response && await readObject(response);
}

const removeLive = (ctx: ActionCtx, connector: Connector, path: string) => send(ctx, connector, "DELETE", path, undefined, true);

async function listGuildEvents(ctx: ActionCtx, connector: Connector, path: string): Promise<unknown[]> {
  const rows: unknown = await (await send(ctx, connector, "GET", path))!.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error("discord_bad_response");
  return rows;
}

// The event's link as it stands, a copy made by hand on the same local night, and whether a same-titled series already has that night.
// Nights read in the event's own zone, as an import does. Series and finished events are never adopted: a one-off must not rewrite them.
async function matchOnGuild(ctx: ActionCtx, connector: Connector, path: string, eventId: Id<"events">, body: DiscordScheduledEventBody, timezone: string) {
  const rows = await listGuildEvents(ctx, connector, path);
  const night = (at: number) => eventDateForInstant(at, timezone);
  const date = night(Date.parse(body.scheduled_start_time));
  const name = body.name.toLowerCase();
  const now = Date.now();
  const named = rows.flatMap(row => parseScheduledEvent(row) ?? []).filter(item => item.status <= 2 && item.name.trim().toLowerCase() === name);
  const copies = named.filter(item => !item.recurrence_rule && night(Date.parse(item.scheduled_start_time)) === date);
  const { current, taken } = await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getExportLinks, { connectorId: connector._id, eventId, externalIds: copies.map(item => item.id) });
  // ponytail: an event past the 90-day horizon sees no series night, so it still POSTs and the night imports beside it; extend the horizon to the event's start if such events appear.
  // With the connector series gate on, a VRDex series night reaches this only as an overridden night's one-off, which ignores onSeries, or as a night of a series Discord cannot carry.
  const onSeries = named.some(item => item.recurrence_rule && scheduledEventOccurrences(item, now, RECONCILE_HORIZON_MS).some(occurrence => night(occurrence.startAt) === date));
  return { current, copy: copies.find(item => !taken.includes(item.id)), onSeries };
}

// A phase-one occurrence's ID is not a Discord event, and what Discord deleted is staff's call in My events.
const untouchable = (link: Doc<"eventSyncLinks"> | null): link is Doc<"eventSyncLinks"> => link !== null && (link.externalSeriesId !== undefined || link.state === "external_deleted");

// Discord cannot cancel a started event, and a missing or cancelled one needs nothing, so only status 1 is patched.
async function cancelScheduled(ctx: ActionCtx, connector: Connector, path: string): Promise<void> {
  if ((await liveEvent(ctx, connector, path))?.status === 1) await send(ctx, connector, "PATCH", path, { status: 4 });
}

/** The nights of a series Discord cannot carry that have no copy yet; plan 07's export posts each one. */
export const enqueueOneOffNights = internalMutation({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.id("eventSeries") },
  handler: async (ctx, { connectorId, seriesId }): Promise<void> => {
    const series = await ctx.db.get(seriesId);
    if (!series) return;
    for (const night of await upcomingSeriesNights(ctx.db, series, Date.now())) {
      const link = await linkForEvent(ctx.db, connectorId, night._id);
      if (!link || link.externalId.startsWith("none:")) await enqueueSyncJob(ctx.db, ctx.scheduler, { connectorId, eventId: night._id, kind: "export_upsert" });
    }
  },
});

export const getSeriesNightState = internalQuery({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.id("eventSeries") },
  handler: async (ctx, { connectorId, seriesId }): Promise<{ rule: SeriesRule | null; seriesLink: Doc<"eventSyncLinks"> | null }> => {
    const series = await ctx.db.get(seriesId);
    const seriesLink = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_seriesId_eventId", q => q.eq("connectorId", connectorId).eq("seriesId", seriesId).eq("eventId", undefined)).unique();
    return { rule: series?.rule ?? null, seriesLink };
  },
});

// A night's own one-off: what it states for itself is what the scheduled event cannot.
const ONE_OFF_FIELDS = new Set(["title", "summary", "venueLabel", "startAt", "endAt"]);

/**
 * A night of a series, with the series gate on: the scheduled event carries every night, so a night writes only its own one-off.
 * Null for a series Discord cannot carry, whose nights export as plan 07's one-offs.
 */
async function exportSeriesNight(ctx: ActionCtx, connector: Connector, event: Doc<"events">, link: Doc<"eventSyncLinks"> | null, path: string): Promise<ExportResult | null> {
  const seriesId = event.seriesId!;
  const { rule, seriesLink } = await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getSeriesNightState, { connectorId: connector._id, seriesId });
  if (!rule || !carriedOnDiscord(rule)) return null;
  if (link?.state === "external_deleted") return { externalId: link.externalId, unchanged: true };
  const none = { externalId: `none:${event._id}` };
  const own = link && !link.externalId.startsWith("none:") ? link : null;
  // The night's own copy, left as it is: the runner writes nothing to its link.
  const keep = own && { externalId: own.externalId, unchanged: true as const };
  // No scheduled event yet (a night job can run before its series job): the series export queues this night again.
  // The night's own copy keeps its ID, so that follow-up still sees it and retracts it.
  if (!seriesLink || seriesLink.externalId.startsWith("none:")) {
    await ctx.runMutation(internal.eventSeriesSync.requestSeriesExport, { seriesId });
    return keep || none;
  }
  // The organiser deleted the series on Discord: its nights have nothing to write to.
  if (seriesLink.state === "external_deleted") return keep || none;
  if ((event.overrides ?? []).some(field => ONE_OFF_FIELDS.has(field))) return await exportOneOff(ctx, connector, event, link, path, seriesLink.externalId);
  // ponytail: a cancelled night with nothing of its own stays on the scheduled event; Discord has no per-night cancel through this export.
  const liveId = liveExternalId(link);
  // A copy beside the series would show the night twice. Never the scheduled event itself: deleting that ends every night.
  if (!liveId || liveId === seriesLink.externalId) return none;
  const live = await liveEvent(ctx, connector, `${path}/${liveId}`);
  // An organiser who made the copy recurring owns a series now; it stays, and its import converts the link.
  if (live?.recurrence_rule) return { externalId: liveId, unchanged: true };
  if (!live) return none;
  // Only a one-off the bot posted goes: an organiser's own copy keeps its interested list, and the night shows twice.
  const bot = await botUserId();
  if (!bot || live.creator_id !== bot) return { externalId: liveId, unchanged: true };
  await removeLive(ctx, connector, `${path}/${liveId}`);
  return none;
}

// The bot's own Discord user ID, or null when Discord does not answer with one. Rule 4 reads it at most once per night job.
async function botUserId(): Promise<string | null> {
  try {
    const response = await discordRequest({ method: "GET", path: "/users/@me" });
    const id = response.ok ? (await readObject(response)).id : null;
    return typeof id === "string" && DISCORD_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Plan 07's export of one event. For an overridden night, `seriesExternalId` is the series' scheduled event: it and a phase-one
 * link to it are not this night's, so neither stops the one-off.
 */
async function exportOneOff(ctx: ActionCtx, connector: Connector, event: Doc<"events">, claimed: Doc<"eventSyncLinks"> | null, path: string, seriesExternalId?: string): Promise<{ externalId: string }> {
  const ownLink = (row: Doc<"eventSyncLinks"> | null) => !row || seriesExternalId === undefined ? row
    : row.externalId === seriesExternalId ? null : row.externalSeriesId === seriesExternalId ? { ...row, externalSeriesId: undefined } : row;
  const link = ownLink(claimed);
  if (untouchable(link)) return { externalId: link.externalId };
  const source = await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getExportState, { eventId: event._id });
  const liveId = liveExternalId(link);
  const livePath = `${path}/${liveId}`;
  const none = { externalId: `none:${event._id}` };
  // A none: answer overwrites the row, so a job that claimed no live link looks again before giving it.
  const kept = async () => {
    if (liveId) return { externalId: liveId };
    const current = ownLink((await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getExportLinks, { connectorId: connector._id, eventId: event._id, externalIds: [] })).current);
    return current && (untouchable(current) || liveExternalId(current)) ? { externalId: current.externalId } : none;
  };
  if (!source) {
    if (!liveId) return kept();
    await removeLive(ctx, connector, livePath);
    return none;
  }
  if (source.status === "cancelled") {
    const live = liveId ? await liveEvent(ctx, connector, livePath) : null;
    // Discord cannot cancel a started event, and a missing one needs nothing, so only status 1 is patched. Cancelling a series would end every night.
    if (live?.status === 1 && !live.recurrence_rule) await send(ctx, connector, "PATCH", livePath, { status: 4 });
    return kept();
  }
  const { startAt } = source;
  // Discord refuses past starts.
  if (startAt === undefined || startAt <= Date.now()) return kept();
  // ponytail: the cover is re-fetched and re-sent on every PATCH; store the artwork URL on the link if Discord's rate limits ever bite.
  const body = toScheduledEventBody({ ...source, startAt }, source.artworkImageUrl && await artworkDataUri(source.artworkImageUrl));
  const match = liveId ? null : await matchOnGuild(ctx, connector, path, event._id, body, source.timezone ?? "UTC");
  const current = ownLink(match?.current ?? null);
  if (untouchable(current)) return { externalId: current.externalId };
  const linkedId = liveId ?? liveExternalId(current);
  const targetId = linkedId ?? match?.copy?.id;
  const live: Record<string, unknown> | null | undefined = linkedId ? await liveEvent(ctx, connector, `${path}/${linkedId}`) : match?.copy;
  if (targetId && live && live.status !== 3 && live.status !== 4) {
    // ponytail: a one-off turned into a series on Discord stays as it is here; with the connector series gate on, its import converts it to a series.
    if (!live.recurrence_rule) await send(ctx, connector, "PATCH", `${path}/${targetId}`, patchKeepingDescription(body, typeof live.description === "string" ? live.description : null, source));
    return { externalId: targetId };
  }
  // Reconcile's none: adoption claims the night once it enters the window. Patching or posting here would put a one-off over a series.
  if (match?.onSeries && seriesExternalId === undefined) return none;
  const { id } = await readObject((await send(ctx, connector, "POST", path, body))!);
  if (typeof id !== "string" || !DISCORD_ID.test(id)) throw new Error("discord_bad_response");
  return { externalId: id };
}

export const discordScheduledEventsHandler: SyncKindHandler = {
  async exportUpsert(ctx, connector, event, link): Promise<ExportResult> {
    const path = `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`;
    if (connectorSeriesEnabled() && event.seriesId) {
      const night = await exportSeriesNight(ctx, connector, event, link, path);
      if (night) return night;
    }
    return await exportOneOff(ctx, connector, event, link, path);
  },
  async exportSeries(ctx, connector, series, link): Promise<ExportResult> {
    const path = `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`;
    // The organiser deleted the scheduled event; never bring it back, and write nothing to its link.
    if (link?.state === "external_deleted") return { externalId: link.externalId, unchanged: true };
    const liveId = liveExternalId(link);
    const none = { externalId: `none:${series._id}` };
    const { source, firstNight, today, phaseOneExternalSeriesId } = await ctx.runQuery(internal.eventSyncKinds.discordScheduledEvents.getSeriesExportState, { connectorId: connector._id, seriesId: series._id });
    // Discord carries no end, so an ended series cancels its scheduled event. No night materialised is not an end: the first may be past the horizon.
    if (seriesEnded(series, today)) {
      if (!liveId) return none;
      await cancelScheduled(ctx, connector, `${path}/${liveId}`);
      return { externalId: liveId };
    }
    // No public night ahead yet (the first is past the horizon, or every one is private): nothing to send, and the link stays as it is.
    if (!firstNight || source.startAt === undefined) return link ? { externalId: link.externalId, unchanged: true } : none;
    const { startAt } = source;
    const recurrence_rule = formatDiscordRecurrence(series.rule, new Date(startAt).toISOString());
    if (!recurrence_rule) {
      // A scheduled event left from before the rule changed would hide every one-off: plan 07 never posts over a series.
      if (liveId) await cancelScheduled(ctx, connector, `${path}/${liveId}`);
      // A night the scheduled event carried has no copy and may see no edit to queue one.
      await ctx.runMutation(internal.eventSyncKinds.discordScheduledEvents.enqueueOneOffNights, { connectorId: connector._id, seriesId: series._id });
      return none;
    }
    if (liveId && link!.lastExportedHash === seriesHash(seriesSyncFields(series))) return { externalId: liveId, unchanged: true };
    const body = { ...toScheduledEventBody({ ...source, startAt }, source.artworkImageUrl && await artworkDataUri(source.artworkImageUrl)), recurrence_rule };
    // A recurring event phase one imported nights from becomes the series' scheduled event rather than a second one beside it.
    const targetId = liveId ?? (phaseOneExternalSeriesId && DISCORD_ID.test(phaseOneExternalSeriesId) ? phaseOneExternalSeriesId : null);
    const live = targetId ? await liveEvent(ctx, connector, `${path}/${targetId}`) : null;
    if (targetId && live && live.status !== 3 && live.status !== 4) {
      // ponytail: Discord refuses a PATCH while a night is live; the job retries for 15 minutes and then fails, so an edit made during the show can fail.
      await send(ctx, connector, "PATCH", `${path}/${targetId}`, { ...patchKeepingDescription(body, typeof live.description === "string" ? live.description : null, source), recurrence_rule });
      return { externalId: targetId };
    }
    // Gone, or cancelled on Discord: post a new one, as plan 07 does for a one-off.
    const { id } = await readObject((await send(ctx, connector, "POST", path, body))!);
    if (typeof id !== "string" || !DISCORD_ID.test(id)) throw new Error("discord_bad_response");
    return { externalId: id };
  },
  async exportDelete(ctx, connector, link): Promise<void> {
    const path = `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`;
    const liveId = liveExternalId(link);
    if (liveId) await removeLive(ctx, connector, `${path}/${liveId}`);
  },
  async importItem(ctx, connector, payload): Promise<void> {
    scheduledEventsGuildId(connector);
    await ctx.runMutation(internal.eventSyncKinds.discordScheduledEvents.applyScheduledEventImport, { connectorId: connector._id, payload });
  },
  async reconcile(ctx, connector): Promise<void> {
    const items = await listGuildEvents(ctx, connector, `/guilds/${scheduledEventsGuildId(connector)}/scheduled-events`);
    await ctx.runMutation(internal.eventSyncKinds.discordScheduledEvents.applyReconcile, { connectorId: connector._id, items, receivedAt: Date.now() });
  },
};
