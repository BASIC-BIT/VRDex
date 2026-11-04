import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, type DatabaseReader, type MutationCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { requireActiveBrowserSessionSubject } from "./_browserSessionAuthority";
import type { ConnectorKind } from "./_eventConnectors";
import { sanitizeEventDraftInput, type EventOwnerDraftInput } from "./_eventInputs";
import { eventDateForInstant } from "./_eventSchedule";
import { fanOutSeriesEdit, materializeSeries, retireOccurrences, seriesOverridesFor, seriesUpdatePatch, validateSeriesRule } from "./_eventSeries";
import { connectorSeriesEnabled, SERIES_HORIZON_DAYS, type SeriesRule } from "./_eventSeriesModel";
import {
  enqueueSeriesSync, flagSeriesNights, nightLinkFor, restoreSeriesNights, seriesHash, seriesJobQueued, seriesLinkFor, seriesSyncFields, seriesSyncFieldsValidator, upcomingSeriesNights,
  type SeriesSyncFields,
} from "./_eventSeriesSync";
import { enqueueEventSync } from "./_eventSync";

type Outcome = "skipped" | "created" | "linked" | "updated" | "unchanged" | "echo" | "flagged";
export type ExternalSeriesResult = { outcome: Outcome; seriesId?: Id<"eventSeries"> };
export type ExternalSeriesArgs = { connectorId: Id<"eventConnectors">; externalSeriesId: string; externalUpdatedAt: number; deleted: boolean; fields?: SeriesSyncFields };

const linkByExternalId = (db: DatabaseReader, connectorId: Id<"eventConnectors">, externalId: string) =>
  db.query("eventSyncLinks").withIndex("by_connectorId_externalId", q => q.eq("connectorId", connectorId).eq("externalId", externalId)).unique();

// The ID each kind gives one night of the series: Google names an instance by its master and UTC start, plan 07 by event ID and UTC date.
function nightExternalId(kind: ConnectorKind, externalSeriesId: string, event: Doc<"events"> | null): string {
  // A held draft's link: no night on either side yet.
  if (!event) return "none:" + externalSeriesId;
  const utc = event.startAt === undefined ? null : new Date(event.startAt).toISOString();
  if (kind === "google_calendar") return externalSeriesId + "_" + (utc ? utc.slice(0, 19).replace(/[-:]/g, "") + "Z" : event.eventDate!.replace(/-/g, ""));
  return externalSeriesId + ":" + (utc?.slice(0, 10) ?? event.eventDate);
}

// No source carries doors, so an import keeps the series' own.
const withSeriesDoors = (rule: SeriesRule, doorsTime: string | undefined): SeriesRule => {
  const { doorsTime: _doorsTime, ...rest } = rule;
  return doorsTime === undefined ? rest : { ...rest, doorsTime };
};

// An active community series of this title with no link here. A series already linked here belongs to another external series (a split, or two of one name).
// `claimable` also takes one whose export is queued or running here: an import is then that export's echo, which can land before
// completeJob records the new ID. A `none:` link alone is not enough, since an organiser's same-title event would then be exported over.
// The returned link is that series' own, for the caller to patch.
async function unlinkedSeriesByTitle(db: DatabaseReader, connector: Doc<"eventConnectors">, title: string, claimable = false): Promise<{ series: Doc<"eventSeries">; link: Doc<"eventSyncLinks"> | null } | null> {
  const wanted = title.trim().toLowerCase();
  const candidates = await db.query("eventSeries").withIndex("by_communityProfileId_state", q => q.eq("communityProfileId", connector.communityProfileId).eq("state", "active")).collect();
  for (const candidate of candidates) {
    if (candidate.title.trim().toLowerCase() !== wanted) continue;
    const link = await seriesLinkFor(db, connector._id, candidate._id);
    if (!link || (claimable && await seriesJobQueued(db, connector._id, candidate._id))) return { series: candidate, link };
  }
  return null;
}

/**
 * Creates, updates, links, or flags a series from one external series. The kind decides whether an item is a series;
 * `fields` that are missing or fail series validation are outside the fixed set: a linked series is flagged for staff,
 * an unlinked one is skipped so the caller's phase-one path runs. Never throws on source data.
 */
export async function applyExternalSeriesFor(ctx: MutationCtx, args: ExternalSeriesArgs): Promise<ExternalSeriesResult> {
  const { db } = ctx;
  const now = Date.now();
  const connector = await db.get(args.connectorId);
  if (!connectorSeriesEnabled() || connector?.state !== "active" || connector.direction === "export" || connector.direction === "off") return { outcome: "skipped" };
  // Any row for the ID: an item that turned recurring keeps its ID, so its one-off link (to an event or a held draft) must make way for the series link.
  const row = await linkByExternalId(db, connector._id, args.externalSeriesId);
  const link = row?.seriesId !== undefined && row.eventId === undefined ? row : null;
  const oneOff = link ? null : row;
  const series = link?.seriesId ? await db.get(link.seriesId) : null;
  const seen = { lastImportedAt: now, externalUpdatedAt: Math.max(link?.externalUpdatedAt ?? 0, args.externalUpdatedAt), updatedAt: now };

  const flag = async (): Promise<ExternalSeriesResult> => {
    if (!link || !series) return { outcome: "skipped" };
    // VRDex's own end coming back: the series has already retired its nights.
    if (series.state !== "active") {
      await db.patch(link._id, seen);
      return { outcome: "echo", seriesId: series._id };
    }
    await db.patch(link._id, { ...seen, state: "external_deleted" });
    await flagSeriesNights(db, connector._id, series, args.externalSeriesId, now);
    return { outcome: "flagged", seriesId: series._id };
  };
  if (args.deleted) return await flag();

  const newer = (link?.externalUpdatedAt ?? 0) < args.externalUpdatedAt;
  // The source brought a deleted series back. An edit it carries that fails below flags it again in this same mutation.
  if (link?.state === "external_deleted" && series && newer && args.fields) {
    await db.patch(link._id, { state: "linked", flagReviewedAt: undefined, updatedAt: now });
    await restoreSeriesNights(db, connector._id, series, now);
  }
  // A bidirectional connector keeps VRDex's edit unless the source's is newer.
  if (link && (!newer || (connector.direction === "bidirectional" && series && series.updatedAt >= args.externalUpdatedAt))) {
    await db.patch(link._id, seen);
    return { outcome: "unchanged", seriesId: series?._id };
  }
  if (!args.fields) return await flag();
  const fields: SeriesSyncFields = {
    ...args.fields,
    endsOn: args.fields.endsOn === undefined ? series?.endsOn ?? null : args.fields.endsOn,
    count: args.fields.count === undefined ? series?.count ?? null : args.fields.count,
  };
  const hash = seriesHash(fields);

  if (link && series) {
    // The second check catches the echo of an export whose completeJob has not landed yet.
    if (hash === link.lastExportedHash || hash === seriesHash(seriesSyncFields(series))) {
      await db.patch(link._id, seen);
      return { outcome: "echo", seriesId: series._id };
    }
    let edit: Awaited<ReturnType<typeof seriesUpdatePatch>>;
    try {
      edit = await seriesUpdatePatch(db, series, {
        title: fields.title, summary: fields.summary, venueLabel: fields.venueLabel, timezone: fields.timezone,
        rule: withSeriesDoors(fields.rule, series.rule.doorsTime), endsOn: fields.endsOn, count: fields.count,
      }, now);
    } catch {
      return await flag();
    }
    // As eventSeries.update.
    await db.patch(series._id, { ...edit.patch, updatedAt: now });
    const updated = (await db.get(series._id))!;
    if (updated.state === "active") {
      if (edit.datesChanged) await retireOccurrences(ctx, updated, now);
      for (const eventId of await fanOutSeriesEdit(ctx, updated, edit.changed)) await enqueueEventSync(db, ctx.scheduler, eventId, "upsert");
      await materializeSeries(ctx, series._id, now);
    }
    await enqueueSeriesSync(db, ctx.scheduler, series._id);
    // The export back to this connector then carries nothing new.
    await db.patch(link._id, { ...seen, lastExportedHash: hash });
    return { outcome: "updated", seriesId: series._id };
  }

  let clean: { title: string; summary?: string; venueLabel?: string };
  try {
    validateSeriesRule(fields.rule, { startsOn: fields.startsOn, endsOn: fields.endsOn ?? undefined, count: fields.count ?? undefined });
    // As seriesUpdatePatch does, so adopted nights record no spurious overrides.
    clean = sanitizeEventDraftInput({
      title: fields.title, summary: fields.summary ?? undefined, venueLabel: fields.venueLabel ?? undefined, timezone: fields.timezone, startAt: now,
    } as EventOwnerDraftInput);
  } catch {
    return { outcome: "skipped" };
  }
  if (oneOff) {
    let externalId = nightExternalId(connector.kind, args.externalSeriesId, oneOff.eventId ? await db.get(oneOff.eventId) : null);
    // A phase-one window (hold, or the gate off) may have linked that instance to its own row already; external IDs stay unique.
    if (await linkByExternalId(db, connector._id, externalId)) externalId = "none:" + (oneOff.eventId ?? oneOff._id);
    await db.patch(oneOff._id, { externalId, externalSeriesId: args.externalSeriesId, updatedAt: now });
  }
  // The baseline hash: linking applies nothing, so the next delivery of these same fields is an echo.
  const writeLink = async (seriesId: Id<"eventSeries">, existing = link) => {
    const linkFields = { seriesId, externalId: args.externalSeriesId, externalSeriesId: args.externalSeriesId, state: "linked" as const, lastExportedHash: hash, ...seen };
    if (existing) await db.patch(existing._id, linkFields);
    else await db.insert("eventSyncLinks", { connectorId: connector._id, ...linkFields, createdAt: now });
  };
  const candidate = await unlinkedSeriesByTitle(db, connector, clean.title, true);
  if (candidate) {
    // Connecting links and never overwrites.
    await writeLink(candidate.series._id, candidate.link);
    return { outcome: "linked", seriesId: candidate.series._id };
  }

  const seriesId = await db.insert("eventSeries", {
    communityProfileId: connector.communityProfileId, title: clean.title, summary: clean.summary, venueLabel: clean.venueLabel, timezone: fields.timezone,
    rule: fields.rule, startsOn: fields.startsOn, endsOn: fields.endsOn ?? undefined, count: fields.count ?? undefined,
    horizonDays: SERIES_HORIZON_DAYS, authorityUserId: connector.authorityUserId, state: "active", createdAt: now, updatedAt: now,
  });
  await writeLink(seriesId);
  // Adoption takes phase-one nights, and the converted one-off, by title and date.
  await materializeSeries(ctx, seriesId, now);
  if (oneOff?.eventId && (await db.get(oneOff.eventId))?.seriesId === seriesId) await db.patch(oneOff._id, { seriesId });
  await enqueueSeriesSync(db, ctx.scheduler, seriesId);
  return { outcome: "created", seriesId };
}

export const applyExternalSeries = internalMutation({
  args: { connectorId: v.id("eventConnectors"), externalSeriesId: v.string(), externalUpdatedAt: v.number(), deleted: v.boolean(), fields: v.optional(seriesSyncFieldsValidator) },
  handler: (ctx, args): Promise<ExternalSeriesResult> => applyExternalSeriesFor(ctx, args),
});

export const readSeriesLink = internalQuery({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.optional(v.id("eventSeries")), externalSeriesId: v.optional(v.string()) },
  handler: async (ctx, { connectorId, seriesId, externalSeriesId }): Promise<Doc<"eventSyncLinks"> | null> => {
    if (seriesId) return await seriesLinkFor(ctx.db, connectorId, seriesId);
    if (externalSeriesId === undefined) return null;
    const link = await linkByExternalId(ctx.db, connectorId, externalSeriesId);
    return link?.seriesId !== undefined && link.eventId === undefined ? link : null;
  },
});

/** What a kind's series export reads. Discord's import reads it too, so its echo compares with what the export wrote. */
export async function seriesExportContextFor(db: DatabaseReader, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">) {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) throw new Error("SITE_URL_MISSING");
  const series = await db.get(seriesId);
  const community = series && await db.get(series.communityProfileId);
  if (!series || !community?.slug) throw new Error("CONNECTOR_EXPORT_CONTEXT");
  const now = Date.now();
  const nights = await upcomingSeriesNights(db, series, now);
  // A phase-one expansion already on the source: the kind adopts it as the master rather than posting a second one.
  let phaseOneExternalSeriesId: string | null = null;
  for (const night of nights) {
    phaseOneExternalSeriesId = (await nightLinkFor(db, connectorId, night._id))?.externalSeriesId ?? null;
    if (phaseOneExternalSeriesId !== null) break;
  }
  return {
    series, seriesUrl: siteUrl.replace(/\/$/, "") + "/" + community.slug + "/series/" + seriesId,
    firstNight: nights[0] ?? null, today: eventDateForInstant(now, series.timezone), phaseOneExternalSeriesId,
  };
}

export const seriesExportContext = internalQuery({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.id("eventSeries") },
  handler: (ctx, { connectorId, seriesId }) => seriesExportContextFor(ctx.db, connectorId, seriesId),
});

/** Kinds tag a night's link with its series; the runner writes the export fields. */
export const tagNightLink = internalMutation({
  args: { connectorId: v.id("eventConnectors"), eventId: v.id("events"), externalId: v.string(), seriesId: v.optional(v.id("eventSeries")), externalSeriesId: v.optional(v.string()) },
  handler: async (ctx, { connectorId, eventId, externalId, seriesId, externalSeriesId }) => {
    const now = Date.now();
    const link = await nightLinkFor(ctx.db, connectorId, eventId);
    if (link) await ctx.db.patch(link._id, { seriesId, externalSeriesId, updatedAt: now });
    else await ctx.db.insert("eventSyncLinks", { connectorId, eventId, externalId, seriesId, externalSeriesId, state: "linked", createdAt: now, updatedAt: now });
  },
});

export const requestSeriesExport = internalMutation({
  args: { seriesId: v.id("eventSeries") },
  handler: (ctx, { seriesId }) => enqueueSeriesSync(ctx.db, ctx.scheduler, seriesId),
});

export const readConnector = internalQuery({
  args: { connectorId: v.id("eventConnectors") },
  handler: (ctx, { connectorId }) => ctx.db.get(connectorId),
});

/** Phase-one night links, imported one by one before series existed, grouped by the external series that holds them. */
export const occurrenceLinkGroups = internalQuery({
  args: { connectorId: v.id("eventConnectors") },
  handler: async (ctx, { connectorId }): Promise<Array<{ externalSeriesId: string; eventIds: Id<"events">[] }>> => {
    const groups = new Map<string, Id<"events">[]>();
    // ponytail: one read of every untagged link on the connector; page it if a connector outgrows a query's read limit.
    const links = await ctx.db.query("eventSyncLinks").withIndex("by_connectorId_seriesId_eventId", q => q.eq("connectorId", connectorId).eq("seriesId", undefined)).collect();
    for (const link of links) {
      if (link.state !== "linked" || link.eventId === undefined || link.externalSeriesId === undefined) continue;
      groups.set(link.externalSeriesId, [...groups.get(link.externalSeriesId) ?? [], link.eventId]);
    }
    return [...groups].map(([externalSeriesId, eventIds]) => ({ externalSeriesId, eventIds }));
  },
});

/**
 * The rule date a phase-one night was first scheduled on, in the series' zone, so a night moved or edited since keeps its
 * slot and records the move as an override. Google names an instance by its original UTC start; plan 07 names a Discord
 * night by its UTC date, which is the rule date of a UTC series, and is otherwise read from the night's start.
 */
function originalOccurrenceDate(link: Doc<"eventSyncLinks">, event: Doc<"events">, series: Doc<"eventSeries">): string | undefined {
  const master = link.externalSeriesId!;
  const google = link.externalId.startsWith(master + "_") ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(link.externalId.slice(master.length + 1)) : null;
  if (google) {
    const [y, mo, d, h, mi, se] = google.slice(1).map(Number) as [number, number, number, number, number, number];
    return eventDateForInstant(Date.UTC(y, mo - 1, d, h, mi, se), series.timezone);
  }
  const discord = link.externalId.startsWith(master + ":") ? link.externalId.slice(master.length + 1) : null;
  if (!discord || !/^\d{4}-\d{2}-\d{2}$/.test(discord)) return undefined;
  if (series.timezone === "UTC" || event.startAt === undefined) return discord;
  return eventDateForInstant(event.startAt, series.timezone);
}

/**
 * Groups one external series' phase-one nights into a series: the one linked to it here, else an unlinked one of the same
 * title (rule 7's match), else a new one. Every night in no series whose original date is not past is attached as it is, on that
 * date; a night of another series, a second night on a date the series holds, or a link whose ID names no date
 * keeps its link untagged and comes back in `skipped`. Null when the group cannot be a series.
 */
export const groupLinks = internalMutation({
  args: { connectorId: v.id("eventConnectors"), externalSeriesId: v.string(), externalUpdatedAt: v.number(), fields: seriesSyncFieldsValidator, eventIds: v.array(v.id("events")) },
  handler: async (ctx, args): Promise<{ wrote: boolean; skipped: Id<"events">[] } | null> => {
    const { db } = ctx;
    const now = Date.now();
    const connector = await db.get(args.connectorId);
    // A held connector never gets a series link from here (R3).
    if (!connectorSeriesEnabled() || connector?.state !== "active" || connector.mode === "hold" || connector.direction === "export" || connector.direction === "off") return null;
    const row = await linkByExternalId(db, connector._id, args.externalSeriesId);
    // A one-off still holds the series' ID; the next import of the series converts it.
    if (row && (row.seriesId === undefined || row.eventId !== undefined)) return null;
    let series = row?.seriesId ? await db.get(row.seriesId) : null;
    // A flagged series is staff's call, and a series that ended takes no nights.
    if (row && (row.state !== "linked" || series?.state !== "active")) return null;
    const fresh = !series;
    let created = false;
    if (!series) {
      const fields: SeriesSyncFields = { ...args.fields, endsOn: args.fields.endsOn ?? null, count: args.fields.count ?? null };
      let clean: { title: string; summary?: string; venueLabel?: string };
      try {
        // As applyExternalSeriesFor's create path.
        validateSeriesRule(fields.rule, { startsOn: fields.startsOn, endsOn: fields.endsOn ?? undefined, count: fields.count ?? undefined });
        clean = sanitizeEventDraftInput({
          title: fields.title, summary: fields.summary ?? undefined, venueLabel: fields.venueLabel ?? undefined, timezone: fields.timezone, startAt: now,
        } as EventOwnerDraftInput);
      } catch {
        return null;
      }
      series = (await unlinkedSeriesByTitle(db, connector, clean.title))?.series ?? null;
      if (!series) {
        created = true;
        series = (await db.get(await db.insert("eventSeries", {
          communityProfileId: connector.communityProfileId, title: clean.title, summary: clean.summary, venueLabel: clean.venueLabel, timezone: fields.timezone,
          rule: fields.rule, startsOn: fields.startsOn, endsOn: fields.endsOn ?? undefined, count: fields.count ?? undefined,
          horizonDays: SERIES_HORIZON_DAYS, authorityUserId: connector.authorityUserId, state: "active", createdAt: now, updatedAt: now,
        })))!;
      }
      await db.insert("eventSyncLinks", {
        connectorId: connector._id, seriesId: series._id, externalId: args.externalSeriesId, externalSeriesId: args.externalSeriesId, state: "linked",
        lastExportedHash: seriesHash(fields), lastImportedAt: now, externalUpdatedAt: args.externalUpdatedAt, createdAt: now, updatedAt: now,
      });
    }
    const seriesId = series._id;
    const skipped: Id<"events">[] = [];
    let wrote = fresh;
    for (const eventId of args.eventIds) {
      const link = await nightLinkFor(db, connector._id, eventId);
      const event = await db.get(eventId);
      if (!link || link.seriesId !== undefined || link.externalSeriesId !== args.externalSeriesId || !event) continue;
      if (event.seriesId === undefined) {
        const date = originalOccurrenceDate(link, event, series);
        // The link names the night as the series member, so it joins as it is (cancelled, unpublished, removed, or started) and
        // holds its date; leaving one out would let materialising create a public twin. Only a past date stays out, quietly.
        if (date !== undefined && date < eventDateForInstant(now, series.timezone)) continue;
        const taken = date && await db.query("events").withIndex("by_seriesId_occurrenceDate", q => q.eq("seriesId", seriesId).eq("occurrenceDate", date)).first();
        if (!date || taken) {
          skipped.push(eventId);
          continue;
        }
        await db.patch(eventId, { seriesId, occurrenceDate: date, overrides: await seriesOverridesFor(db, series, event, date), updatedAt: now });
      } else if (event.seriesId !== seriesId) {
        skipped.push(eventId);
        continue;
      }
      await db.patch(link._id, { seriesId, updatedAt: now });
      wrote = true;
    }
    // Attached first, so materialising skips their dates.
    if (wrote) await materializeSeries(ctx, seriesId, now);
    // As applyExternalSeriesFor: only a new series needs exporting to the community's other connectors.
    if (created) await enqueueSeriesSync(db, ctx.scheduler, seriesId);
    return { wrote, skipped };
  },
});

/** Schedules the grouping migration for one connector; super-admin only, as the statistics admin commands. */
export const groupOccurrenceLinksForConnector = mutation({
  args: { connectorId: v.id("eventConnectors") }, returns: v.null(),
  handler: async (ctx, { connectorId }) => {
    const session = await requireActiveBrowserSessionSubject(ctx);
    if (!(await getAccountFeatureAccess(ctx.db, session.userId)).superAdmin) throw new Error("Super-admin access is required.");
    await ctx.scheduler.runAfter(0, internal.migrations.groupOccurrenceLinks, { connectorId });
    return null;
  },
});
