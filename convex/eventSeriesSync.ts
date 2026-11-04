import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type DatabaseReader, type MutationCtx } from "./_generated/server";
import type { ConnectorKind } from "./_eventConnectors";
import { sanitizeEventDraftInput, type EventOwnerDraftInput } from "./_eventInputs";
import { eventDateForInstant } from "./_eventSchedule";
import { fanOutSeriesEdit, materializeSeries, retireOccurrences, seriesUpdatePatch, validateSeriesRule } from "./_eventSeries";
import { connectorSeriesEnabled, SERIES_HORIZON_DAYS, type SeriesRule } from "./_eventSeriesModel";
import {
  enqueueSeriesSync, flagSeriesNights, nightLinkFor, restoreSeriesNights, seriesHash, seriesLinkFor, seriesSyncFields, seriesSyncFieldsValidator, upcomingSeriesNights,
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
  const writeLink = async (seriesId: Id<"eventSeries">) => {
    const linkFields = { seriesId, externalId: args.externalSeriesId, externalSeriesId: args.externalSeriesId, state: "linked" as const, lastExportedHash: hash, ...seen };
    if (link) await db.patch(link._id, linkFields);
    else await db.insert("eventSyncLinks", { connectorId: connector._id, ...linkFields, createdAt: now });
  };
  // A series already linked here belongs to another external series (a split, or two of one name).
  const title = clean.title.trim().toLowerCase();
  const candidates = await db.query("eventSeries").withIndex("by_communityProfileId_state", q => q.eq("communityProfileId", connector.communityProfileId).eq("state", "active")).collect();
  for (const candidate of candidates) {
    if (candidate.title.trim().toLowerCase() !== title || await seriesLinkFor(db, connector._id, candidate._id)) continue;
    // Connecting links and never overwrites.
    await writeLink(candidate._id);
    return { outcome: "linked", seriesId: candidate._id };
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

export const seriesExportContext = internalQuery({
  args: { connectorId: v.id("eventConnectors"), seriesId: v.id("eventSeries") },
  handler: async (ctx, { connectorId, seriesId }) => {
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) throw new Error("SITE_URL_MISSING");
    const series = await ctx.db.get(seriesId);
    const community = series && await ctx.db.get(series.communityProfileId);
    if (!series || !community?.slug) throw new Error("CONNECTOR_EXPORT_CONTEXT");
    const now = Date.now();
    const nights = await upcomingSeriesNights(ctx.db, series, now);
    // A phase-one expansion already on the source: the kind adopts it as the master rather than posting a second one.
    let phaseOneExternalSeriesId: string | null = null;
    for (const night of nights) {
      phaseOneExternalSeriesId = (await nightLinkFor(ctx.db, connectorId, night._id))?.externalSeriesId ?? null;
      if (phaseOneExternalSeriesId !== null) break;
    }
    return {
      series, seriesUrl: siteUrl.replace(/\/$/, "") + "/" + community.slug + "/series/" + seriesId,
      firstNight: nights[0] ?? null, today: eventDateForInstant(now, series.timezone), phaseOneExternalSeriesId,
    };
  },
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
