import { resolveEventLocalTime } from "../packages/api-contracts/src/event-intake";
import type { AuthSubject } from "./_communityAuthority";
import { sanitizeEventDraftInput, type EventOwnerDraftInput } from "./_eventInputs";
import { eventOutputIsAuthorized } from "./_eventOutputSetup";
import { eventDateForInstant } from "./_eventSchedule";
import {
  SERIES_HORIZON_DAYS,
  SERIES_OWNED_EVENT_FIELDS,
  type SeriesOwnedEventField,
  type SeriesRepeat,
  type SeriesRule,
} from "./_eventSeriesModel";
import { enqueueEventSync } from "./_eventSync";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter, MutationCtx } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";
import { insertCommunityEventRecord, linkedPublishedEventWorld } from "./events";

const DAY_MS = 86_400_000;
const MAX_COUNT = 520;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Calendar dates as whole UTC days since the epoch; never a local Date.
function toDay(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) return Number.NaN;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / DAY_MS : Number.NaN;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

/** The nth (1..4) or last (-1) `weekday` of the month containing `year`/`month` (0-based). */
function monthlyWeekday(year: number, month: number, weekday: number, ordinal: number): number {
  if (ordinal === -1) {
    const last = Date.UTC(year, month + 1, 0) / DAY_MS;
    return last - ((weekdayOf(last) - weekday + 7) % 7);
  }
  const first = Date.UTC(year, month, 1) / DAY_MS;
  return first + ((weekday - weekdayOf(first) + 7) % 7) + (ordinal - 1) * 7;
}

/**
 * Occurrence dates inside the inclusive window `from..to`. Generation runs from `startsOn`
 * so the biweekly anchor and `count` do not depend on the window; `endsOn` is inclusive.
 */
export function occurrenceDates(
  series: Pick<Doc<"eventSeries">, "rule" | "startsOn" | "endsOn" | "count">,
  from: string,
  to: string,
): string[] {
  const { rule, startsOn, endsOn, count } = series;
  const start = toDay(startsOn);
  const fromDayValue = toDay(from);
  const stop = Math.min(toDay(to), endsOn === undefined ? Infinity : toDay(endsOn));
  if (![start, fromDayValue, stop].every(Number.isFinite)) return [];

  const dates: string[] = [];
  let generated = 0;
  const emit = (day: number) => {
    generated += 1;
    if (day >= fromDayValue) dates.push(fromDay(day));
  };
  const more = () => count === undefined || generated < count;

  if (rule.frequency === "monthly_weekday") {
    const anchor = new Date(start * DAY_MS);
    for (let year = anchor.getUTCFullYear(), month = anchor.getUTCMonth(); more(); month += 1) {
      const day = monthlyWeekday(year, month, rule.weekday, rule.ordinal ?? 1);
      if (day > stop) break;
      if (day >= start) emit(day);
    }
  } else {
    const step = rule.frequency === "biweekly" ? 14 : 7;
    for (let day = start + ((rule.weekday - weekdayOf(start) + 7) % 7); day <= stop && more(); day += step) {
      emit(day);
    }
  }
  return dates;
}

/** Throws on a rule, or series bounds, outside the fixed recurrence set. */
export function validateSeriesRule(
  rule: SeriesRule,
  bounds?: { startsOn: string; endsOn?: string; count?: number },
): void {
  if (!["weekly", "biweekly", "monthly_weekday"].includes(rule.frequency)) {
    throw new Error("Repeat frequency must be weekly, biweekly, or monthly_weekday.");
  }
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
    throw new Error("Repeat weekday must be 0 to 6.");
  }
  if (rule.frequency === "monthly_weekday") {
    if (rule.ordinal === undefined || ![1, 2, 3, 4, -1].includes(rule.ordinal)) {
      throw new Error("Monthly repeat ordinal must be 1, 2, 3, 4, or -1.");
    }
  } else if (rule.ordinal !== undefined) {
    throw new Error("Repeat ordinal applies only to monthly repeats.");
  }
  for (const time of [rule.startTime, rule.endTime, rule.doorsTime]) {
    if (time !== undefined && !TIME_PATTERN.test(time)) throw new Error("Repeat times must be HH:MM.");
  }
  if (!bounds) return;
  const start = toDay(bounds.startsOn);
  if (!Number.isFinite(start)) throw new Error("Series start date must be YYYY-MM-DD.");
  if (bounds.endsOn !== undefined && !(toDay(bounds.endsOn) >= start)) {
    throw new Error("Series end date must be a YYYY-MM-DD date on or after the start date.");
  }
  if (bounds.count !== undefined && (!Number.isInteger(bounds.count) || bounds.count < 1 || bounds.count > MAX_COUNT)) {
    throw new Error(`Repeat count must be 1 to ${MAX_COUNT}.`);
  }
}

/** Rule wall-clock times on `date` in the series timezone; null when the start does not exist that night. */
export function occurrenceTimes(
  series: Pick<Doc<"eventSeries">, "rule" | "timezone">,
  date: string,
): { startAt: number; doorsOpenAt?: number; endAt?: number } | null {
  const { rule, timezone } = series;
  // A repeated hour resolves to both instants ascending; index 0 is the earlier one.
  const at = (time: string, dayOffset: number) => resolveEventLocalTime(date, { time, dayOffset }, timezone)[0];
  const startAt = at(rule.startTime, 0);
  if (startAt === undefined) return null;
  const doorsOpenAt = rule.doorsTime === undefined ? undefined : at(rule.doorsTime, rule.doorsTime > rule.startTime ? -1 : 0);
  const endAt = rule.endTime === undefined ? undefined : at(rule.endTime, rule.endTime <= rule.startTime ? 1 : 0);
  return { startAt, doorsOpenAt, endAt };
}

export function seriesAuthSubject(series: Doc<"eventSeries">): AuthSubject {
  return { tokenIdentifier: "series:" + series._id, issuer: "vrdex-series", subject: series.authorityUserId, displayName: "VRDex" };
}

type SeriesFieldValues = Partial<Record<SeriesOwnedEventField, unknown>>;

const FIELD_DEFAULTS: SeriesFieldValues = { mediaLinks: [], watchMode: "event_stream", watchSurfaceEnabled: false };
const NUMBER_FIELDS = new Set<SeriesOwnedEventField>(["startAt", "doorsOpenAt", "endAt"]);

function comparable(field: SeriesOwnedEventField, value: unknown): unknown {
  const filled = value ?? FIELD_DEFAULTS[field] ?? (NUMBER_FIELDS.has(field) ? undefined : "");
  // Key-order-insensitive so stored links and series links compare by content.
  return field === "mediaLinks"
    ? JSON.stringify((filled as object[]).map((link) => Object.entries(link).sort(([a], [b]) => (a < b ? -1 : 1))))
    : filled;
}

/** Whether two values of a series-owned field are the same once missing values take their defaults. */
export function sameSeriesFieldValue(field: SeriesOwnedEventField, a: unknown, b: unknown): boolean {
  return comparable(field, a) === comparable(field, b);
}

/** Sorted series-owned fields where `event` differs from what the series would give it on `date`. */
export async function seriesOverridesFor(
  db: DatabaseReader,
  series: Doc<"eventSeries">,
  event: Doc<"events">,
  date: string,
): Promise<SeriesOwnedEventField[]> {
  // A start that does not exist on `date` leaves the series times undefined, so any event time is an override.
  const fromSeries: SeriesFieldValues = { ...series, ...occurrenceTimes(series, date) };
  const fromEvent: SeriesFieldValues = { ...event, worldSlug: (await linkedPublishedEventWorld(db, event._id))?.slug };
  return SERIES_OWNED_EVENT_FIELDS.filter((field) => !sameSeriesFieldValue(field, fromEvent[field], fromSeries[field])).sort();
}

/**
 * Links the first upcoming, published, scheduled, unowned event of the series' community on
 * `date` whose title matches, recording the fields it differs on as overrides. Started nights are never changed; a date-only event on an upcoming date is not started.
 */
async function adoptStandaloneEvent(
  db: DatabaseWriter,
  series: Doc<"eventSeries">,
  date: string,
): Promise<Id<"events"> | null> {
  const title = series.title.trim().toLowerCase();
  const now = Date.now();
  const candidates = db
    .query("events")
    .withIndex("by_communityProfileId_eventDate", (q) => q.eq("communityProfileId", series.communityProfileId).eq("eventDate", date));
  for await (const event of candidates) {
    if (
      event.seriesId !== undefined ||
      event.moderationRemovedAt !== undefined ||
      event.publicationState !== "published" ||
      event.eventStatus !== "scheduled" ||
      (event.startAt !== undefined && event.startAt <= now) ||
      event.title.trim().toLowerCase() !== title
    ) continue;
    await db.patch(event._id, {
      seriesId: series._id,
      occurrenceDate: date,
      overrides: await seriesOverridesFor(db, series, event, date),
      updatedAt: now,
    });
    return event._id;
  }
  return null;
}

// Never throws: an unpublished world must not fail the series every day, so the night goes unlinked.
async function publishedWorldOrUndefined(db: DatabaseReader, series: Doc<"eventSeries">) {
  if (series.worldSlug === undefined) return undefined;
  const validation = validateWorldSlug(series.worldSlug);
  const world = validation.ok ? await getWorldBySlug(db, validation.slug) : null;
  if (world?.publicationState === "published") return world;
  console.warn("series world not published", { seriesId: series._id, worldSlug: series.worldSlug });
  return undefined;
}

/** The programme of the latest occurrence that has one. */
async function templateProgram(db: DatabaseReader, seriesId: Id<"eventSeries">) {
  const nights = db.query("events").withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", seriesId)).order("desc");
  for await (const night of nights) {
    const program = await db
      .query("eventMediaPrograms")
      .withIndex("by_eventId_updatedAt", (q) => q.eq("eventId", night._id))
      .order("desc")
      .first();
    if (program !== null) return program;
  }
  return null;
}

// Programme settings and authorized outputs only; sources, scenes, sessions and commands are night-owned.
// Copied once at creation; later template edits are not fanned out (spec ceiling).
async function copyProgram(db: DatabaseWriter, template: Doc<"eventMediaPrograms">, event: Doc<"events">, now: number) {
  const programId = await db.insert("eventMediaPrograms", {
    mediaSettings: template.mediaSettings,
    broadcastPolicy: template.broadcastPolicy,
    eventId: event._id,
    communityProfileId: template.communityProfileId,
    state: "draft",
    publicLinks: template.publicLinks,
    directFallbackLinks: template.directFallbackLinks,
    createdAt: now,
    updatedAt: now,
  });
  const outputs = await db.query("eventMediaOutputs").withIndex("by_programId_key", (q) => q.eq("programId", template._id)).collect();
  for (const output of outputs) {
    if (!eventOutputIsAuthorized(event, output)) continue;
    const state = output.state === "active" ? "ready" : output.state;
    const outputId = await db.insert("eventMediaOutputs", {
      programId,
      eventId: event._id,
      key: output.key,
      type: output.type,
      accountModel: output.accountModel,
      state,
      label: output.label,
      region: output.region,
      credential: output.credential,
      vrcdnSetup: output.vrcdnSetup,
      twitchSetup: output.twitchSetup,
      simulcastEnabled: output.simulcastEnabled,
      compliance: output.compliance,
      playbackLinks: output.playbackLinks,
      createdAt: now,
      updatedAt: now,
    });
    if (output._id === template.currentOutputId) {
      await db.patch(programId, { currentOutputId: outputId, state: state === "ready" ? "ready" : "draft" });
    }
  }
}

/** Creates the series' missing nights up to its horizon, keyed by seriesId plus occurrenceDate. */
export async function materializeSeries(
  ctx: MutationCtx,
  seriesId: Id<"eventSeries">,
  now: number,
): Promise<{ created: Id<"events">[]; adopted: Id<"events">[]; skipped: string[] }> {
  const result = { created: [] as Id<"events">[], adopted: [] as Id<"events">[], skipped: [] as string[] };
  const { db } = ctx;
  const series = await db.get(seriesId);
  if (series === null || series.state !== "active") return result;

  const today = eventDateForInstant(now, series.timezone);
  const from = series.startsOn > today ? series.startsOn : today;
  const to = eventDateForInstant(now + series.horizonDays * DAY_MS, series.timezone);
  const dates = occurrenceDates(series, from, to);
  if (dates.length === 0) return result;

  const community = await db.get(series.communityProfileId);
  if (community === null || community.profileType !== "community" || !canReadProfile("public", community)) {
    console.warn("series community not published", { seriesId });
    return result;
  }
  const world = await publishedWorldOrUndefined(db, series);
  const template = await templateProgram(db, seriesId);

  for (const date of dates) {
    const existing = await db
      .query("events")
      .withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", seriesId).eq("occurrenceDate", date))
      .first();
    if (existing !== null) continue;

    const adopted = await adoptStandaloneEvent(db, series, date);
    if (adopted !== null) {
      // Patched directly, so no record helper enqueued it.
      await enqueueEventSync(db, ctx.scheduler, adopted, "upsert");
      result.adopted.push(adopted);
      continue;
    }

    const times = occurrenceTimes(series, date);
    if (times === null) {
      console.warn("series occurrence skipped", { seriesId, date });
      result.skipped.push(date);
      continue;
    }
    if (times.startAt <= now) continue;

    const ownerInput: EventOwnerDraftInput = {
      title: series.title,
      ...times,
      timezone: series.timezone,
      communitySlug: community.slug,
      summary: series.summary,
      venueLabel: series.venueLabel,
      mediaLinks: series.mediaLinks,
      watchMode: series.watchMode,
      watchSurfaceEnabled: series.watchSurfaceEnabled,
      bannerImageUrl: series.bannerImageUrl,
      thumbnailImageUrl: series.thumbnailImageUrl,
      sourceUrl: series.sourceUrl,
    };
    const { eventId } = await insertCommunityEventRecord(ctx, {
      input: { ...sanitizeEventDraftInput(ownerInput), startAt: times.startAt },
      community,
      world,
      submitter: seriesAuthSubject(series),
      publicationState: "published",
      actorSurface: "system",
      occurrence: { seriesId, occurrenceDate: date },
    });
    result.created.push(eventId);

    const event = template && (await db.get(eventId));
    if (template && event) await copyProgram(db, template, event, now);
  }
  return result;
}

function localTime(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

/**
 * Turns a published timed event into the first occurrence of a new series, then materialises the rest.
 * The event is linked even when it is already past (the one exception to "past nights are never changed");
 * materialisation still starts from today, so nothing earlier is backfilled.
 */
export async function createSeriesFromEvent(
  ctx: MutationCtx,
  event: Doc<"events">,
  repeat: SeriesRepeat,
  authorityUserId: Id<"users">,
  now: number,
): Promise<{ seriesId: Id<"eventSeries">; created: number }> {
  const { startAt, timezone, communityProfileId } = event;
  if (
    event.publicationState !== "published" ||
    event.scheduleKind === "date_only" ||
    startAt === undefined ||
    !timezone ||
    communityProfileId === undefined ||
    event.seriesId !== undefined
  ) {
    throw new Error("Only a published timed event can repeat.");
  }

  const startsOn = event.eventDate ?? eventDateForInstant(startAt, timezone);
  const day = Number(startsOn.slice(8, 10));
  const ordinal = repeat.frequency === "monthly_weekday" ? repeat.ordinal ?? (day >= 29 ? -1 : (Math.ceil(day / 7) as 1 | 2 | 3 | 4)) : repeat.ordinal;
  const rule: SeriesRule = {
    frequency: repeat.frequency,
    weekday: repeat.weekday ?? weekdayOf(toDay(startsOn)),
    ordinal,
    startTime: localTime(startAt, timezone),
    endTime: event.endAt === undefined ? undefined : localTime(event.endAt, timezone),
    doorsTime: event.doorsOpenAt === undefined ? undefined : localTime(event.doorsOpenAt, timezone),
  };
  const bounds = { startsOn, endsOn: repeat.endsOn, count: repeat.count };
  validateSeriesRule(rule, bounds);
  // A supplied weekday or ordinal must make the event itself the first occurrence.
  if (occurrenceDates({ rule, ...bounds }, startsOn, startsOn)[0] !== startsOn) {
    throw new Error("Repeat weekday must match the event's start day.");
  }

  // Copied from the stored (already sanitised) event so adoption and override checks see no spurious differences.
  const world = await linkedPublishedEventWorld(ctx.db, event._id);
  const seriesId = await ctx.db.insert("eventSeries", {
    summary: event.summary,
    venueLabel: event.venueLabel,
    worldSlug: world?.slug,
    mediaLinks: event.mediaLinks,
    watchMode: event.watchMode,
    watchSurfaceEnabled: event.watchSurfaceEnabled,
    bannerImageUrl: event.bannerImageUrl,
    thumbnailImageUrl: event.thumbnailImageUrl,
    sourceUrl: event.sourceUrl,
    endsOn: repeat.endsOn,
    count: repeat.count,
    communityProfileId,
    title: event.title,
    timezone,
    rule,
    startsOn,
    horizonDays: SERIES_HORIZON_DAYS,
    authorityUserId,
    state: "active",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(event._id, { seriesId, occurrenceDate: startsOn, overrides: [], updatedAt: now });
  // Patched directly, so no record helper enqueued it; materialised nights enqueue inside insertCommunityEventRecord.
  await enqueueEventSync(ctx.db, ctx.scheduler, event._id, "upsert");
  const { created } = await materializeSeries(ctx, seriesId, now);
  return { seriesId, created: created.length };
}
