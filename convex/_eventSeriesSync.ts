import type { Scheduler } from "convex/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import { canonicalIntakeValue, connectorsEnabled, sha256Hex } from "./_eventConnectors";
import { eventDateForInstant } from "./_eventSchedule";
import { connectorSeriesEnabled, eventSeriesRuleValidator } from "./_eventSeriesModel";
import { enqueueSyncJob, eventIsPublic } from "./_eventSync";

// _eventSeries imports this module, so it must not import _eventSeries back.

const DAY_MS = 86_400_000;
const nullableString = v.union(v.string(), v.null());

export const seriesSyncFieldsValidator = v.object({
  title: v.string(), summary: nullableString, venueLabel: nullableString, timezone: v.string(), rule: eventSeriesRuleValidator, startsOn: v.string(),
  // Undefined: the source does not carry them.
  endsOn: v.optional(nullableString), count: v.optional(v.union(v.number(), v.null())),
});
export type SeriesSyncFields = Infer<typeof seriesSyncFieldsValidator>;
/** A kind's read of one external series. `fields: null` is outside the fixed set, or all-day. */
export type ExternalSeries = { externalSeriesId: string; externalUpdatedAt: number; deleted: boolean; fields: SeriesSyncFields | null };

export const SERIES_EXPORT_KINDS = ["google_calendar", "discord_scheduled_events"] as const;

export function seriesSyncFields(series: Doc<"eventSeries">): SeriesSyncFields {
  return {
    title: series.title, summary: series.summary ?? null, venueLabel: series.venueLabel ?? null, timezone: series.timezone,
    rule: series.rule, startsOn: series.startsOn, endsOn: series.endsOn ?? null, count: series.count ?? null,
  };
}

// As Google import clips, so a long owner-entered value still matches its own echo.
const clip = (value: string | null | undefined, max: number) => value?.trim().slice(0, max).trim();

/** What a round trip through either source keeps: no source carries doors, and UNTIL wins over COUNT. startsOn is the anchor, not an edit. */
export function seriesHash(fields: SeriesSyncFields): string {
  const { doorsTime: _doorsTime, ...rule } = fields.rule;
  const endsOn = fields.endsOn ?? null;
  return sha256Hex(JSON.stringify(canonicalIntakeValue({
    title: clip(fields.title, 120), summary: clip(fields.summary, 240), venueLabel: clip(fields.venueLabel, 120),
    timezone: fields.timezone, rule, endsOn, count: endsOn === null ? fields.count : null,
  })));
}

/** The series a connector-level job carries; event jobs carry none. */
export function jobSeriesId(job: Doc<"eventSyncJobs">): Id<"eventSeries"> | null {
  const seriesId = job.eventId === undefined ? (job.payload as { seriesId?: unknown } | null)?.seriesId : undefined;
  return typeof seriesId === "string" ? (seriesId as Id<"eventSeries">) : null;
}

export const seriesLinkFor = (db: DatabaseReader, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">) =>
  db.query("eventSyncLinks").withIndex("by_connectorId_seriesId_eventId", q => q.eq("connectorId", connectorId).eq("seriesId", seriesId).eq("eventId", undefined)).unique();

export const nightLinkFor = async (db: DatabaseReader, connectorId: Id<"eventConnectors">, eventId: Id<"events">) =>
  (await db.query("eventSyncLinks").withIndex("by_eventId", q => q.eq("eventId", eventId)).take(100)).find(link => link.connectorId === connectorId) ?? null;

/** Public nights that start after `now`; read from a day early so a night in another zone is still seen. */
export async function upcomingSeriesNights(db: DatabaseReader, series: Doc<"eventSeries">, now: number): Promise<Doc<"events">[]> {
  const nights = await db.query("events")
    .withIndex("by_seriesId_occurrenceDate", q => q.eq("seriesId", series._id).gte("occurrenceDate", eventDateForInstant(now - DAY_MS, series.timezone)))
    .collect();
  return nights.filter(night => eventIsPublic(night) && night.startAt !== undefined && night.startAt > now);
}

/** Whether a series export for this series is pending or running on the connector. */
export async function seriesJobQueued(db: DatabaseReader, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">): Promise<boolean> {
  for (const state of ["pending", "running"] as const) {
    for await (const job of db.query("eventSyncJobs").withIndex("by_connectorId_eventId_state", q => q.eq("connectorId", connectorId).eq("eventId", undefined).eq("state", state))) {
      if (jobSeriesId(job) === seriesId) return true;
    }
  }
  return false;
}

/** One series export per connector at a time: a job already pending reads the series at claim, and two running would insert two masters. */
export async function enqueueSeriesJob(db: DatabaseWriter, scheduler: Scheduler, connectorId: Id<"eventConnectors">, seriesId: Id<"eventSeries">): Promise<void> {
  if (await seriesJobQueued(db, connectorId, seriesId)) return;
  await enqueueSyncJob(db, scheduler, { connectorId, kind: "export_upsert", payload: { seriesId } });
}

/** The series hook: every series write path calls it, as event writes call enqueueEventSync. */
export async function enqueueSeriesSync(db: DatabaseWriter, scheduler: Scheduler, seriesId: Id<"eventSeries">): Promise<void> {
  if (!connectorsEnabled() || !connectorSeriesEnabled()) return;
  const series = await db.get(seriesId);
  if (!series) return;
  const connectors = (await db.query("eventConnectors").withIndex("by_communityProfileId", q => q.eq("communityProfileId", series.communityProfileId)).take(50))
    .filter(connector => connector.state === "active" && (connector.direction === "export" || connector.direction === "bidirectional")
      && (SERIES_EXPORT_KINDS as readonly string[]).includes(connector.kind));
  for (const connector of connectors) await enqueueSeriesJob(db, scheduler, connector._id, seriesId);
}

/** The external series is gone: every upcoming night shows on the staff-attention list, and the series itself is never ended. */
export async function flagSeriesNights(db: DatabaseWriter, connectorId: Id<"eventConnectors">, series: Doc<"eventSeries">, externalSeriesId: string, now: number): Promise<void> {
  for (const night of await upcomingSeriesNights(db, series, now)) {
    const link = await nightLinkFor(db, connectorId, night._id);
    if (link) await db.patch(link._id, { state: "external_deleted", updatedAt: now });
    // A placeholder names nothing on the source; a provider-shaped ID could already be another event's link.
    else await db.insert("eventSyncLinks", {
      connectorId, eventId: night._id, seriesId: series._id, externalSeriesId, externalId: "none:" + night._id,
      state: "external_deleted", createdAt: now, updatedAt: now,
    });
  }
}

/** The source brought the series back: flagSeriesNights' flags lift, and staff no longer see them as reviewed. */
export async function restoreSeriesNights(db: DatabaseWriter, connectorId: Id<"eventConnectors">, series: Doc<"eventSeries">, now: number): Promise<void> {
  // ponytail: a night whose own instance was cancelled before the series went is restored too; its flag returns only if Google sends that instance again.
  for (const night of await upcomingSeriesNights(db, series, now)) {
    const link = await nightLinkFor(db, connectorId, night._id);
    if (link?.state === "external_deleted") await db.patch(link._id, { state: "linked", flagReviewedAt: undefined, updatedAt: now });
  }
}
