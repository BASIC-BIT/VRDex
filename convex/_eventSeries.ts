import { resolveEventLocalTime } from "../packages/api-contracts/src/event-intake";
import { syncClubEventOperations } from "./_clubOperationEvents";
import type { AuthSubject } from "./_communityAuthority";
import { eventContributionFingerprint } from "./_eventContributionPreflight";
import { createEventSortTitle, sanitizeEventDraftInput, type EventOwnerDraftInput } from "./_eventInputs";
import { eventOutputIsAuthorized } from "./_eventOutputSetup";
import { eventDateForInstant, normalizeEventSchedule } from "./_eventSchedule";
import {
  SERIES_HORIZON_DAYS,
  SERIES_OWNED_EVENT_FIELDS,
  requireRecurringEventsEnabled,
  type SeriesOwnedEventField,
  type SeriesRepeat,
  monthlyOrdinalOf,
  type SeriesRule,
} from "./_eventSeriesModel";
import { enqueueEventSync } from "./_eventSync";
import type { Doc, Id } from "./_generated/dataModel";
import type { DatabaseReader, DatabaseWriter, MutationCtx } from "./_generated/server";
import { canReadProfile } from "./_profilePermissions";
import { reindexEventSearchDocument } from "./_searchDocuments";
import { getWorldBySlug, validateWorldSlug } from "./_worldSlugs";
// Cycle with events.ts (it imports recordOccurrenceOverrides): used only inside function bodies.
import {
  applyEventPublicationState,
  eventSearchAssociations,
  insertCommunityEventRecord,
  linkedPublishedEventWorld,
  reconcileEventMediaScheduleChange,
  replaceEventWorldLink,
  syncPreservedEventAssociations,
} from "./events";

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

/** Brings back a night an edit retired, now the rule holds it again. Started and moderation-removed nights stay down. */
async function republishRetiredNight(ctx: MutationCtx, series: Doc<"eventSeries">, night: Doc<"events">, now: number): Promise<void> {
  const times = occurrenceTimes(series, night.occurrenceDate!);
  if (times === null || times.startAt <= now || (night.startAt ?? Infinity) <= now || night.moderationRemovedAt !== undefined) return;
  const overrides = new Set(night.overrides ?? []);
  await applySeriesFields(ctx, series, night, SERIES_OWNED_EVENT_FIELDS.filter((field) => !overrides.has(field)), now);
  // The helper enqueues the sync itself.
  await applyEventPublicationState(ctx, (await ctx.db.get(night._id))!, "published", seriesAuthSubject(series), "system", now);
}

/** Creates the series' missing nights up to its horizon, keyed by seriesId plus occurrenceDate, and returns retired nights the rule holds again. */
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
    if (existing !== null) {
      if (existing.seriesRetiredAt !== undefined) await republishRetiredNight(ctx, series, existing, now);
      continue;
    }

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
      sourceLabel: series.sourceLabel,
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

type RepeatSource = { startAt: number; endAt?: number; doorsOpenAt?: number; timezone: string; eventDate?: string };

/**
 * The rule and start date `repeat` gives an event. Throws on a bad rule, or on a supplied weekday or
 * ordinal that would not make the event itself the first occurrence. Pure, so create paths can run it
 * before the event exists.
 */
export function seriesRuleFor(source: RepeatSource, repeat: SeriesRepeat): { rule: SeriesRule; startsOn: string } {
  const { startAt, timezone } = source;
  const startsOn = source.eventDate ?? eventDateForInstant(startAt, timezone);
  const ordinal = repeat.frequency === "monthly_weekday" ? repeat.ordinal ?? monthlyOrdinalOf(startsOn) : repeat.ordinal;
  const rule: SeriesRule = {
    frequency: repeat.frequency,
    weekday: repeat.weekday ?? weekdayOf(toDay(startsOn)),
    ordinal,
    startTime: localTime(startAt, timezone),
    endTime: source.endAt === undefined ? undefined : localTime(source.endAt, timezone),
    doorsTime: source.doorsOpenAt === undefined ? undefined : localTime(source.doorsOpenAt, timezone),
  };
  const bounds = { startsOn, endsOn: repeat.endsOn, count: repeat.count };
  validateSeriesRule(rule, bounds);
  if (occurrenceDates({ rule, ...bounds }, startsOn, startsOn)[0] !== startsOn) {
    throw new Error("Repeat weekday must match the event's start day.");
  }
  return { rule, startsOn };
}

/** Checks a create-time `repeat` before the event is inserted, so callers see the real error. */
export function requireRepeatableDraft(draft: Omit<RepeatSource, "timezone" | "eventDate"> & { timezone?: string }, repeat: SeriesRepeat): void {
  requireRecurringEventsEnabled();
  const timezone = draft.timezone?.trim();
  if (!timezone) throw new Error("Repeat requires a timezone.");
  seriesRuleFor({ ...draft, timezone }, repeat);
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

  const { rule, startsOn } = seriesRuleFor({ ...event, startAt, timezone }, repeat);

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
    sourceLabel: event.sourceLabel,
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
  // The link is a direct patch, so it needs its own enqueue. On create with `repeat`, the record helper already queued
  // this event and this replaces that pending job. Materialised nights enqueue inside insertCommunityEventRecord.
  await enqueueEventSync(ctx.db, ctx.scheduler, event._id, "upsert");
  const { created } = await materializeSeries(ctx, seriesId, now);
  return { seriesId, created: created.length };
}

/**
 * Retires the series' upcoming published nights it no longer schedules, or all of them once it is not active.
 * A bare night is unpublished and keeps its key, so materialisation never creates that date again; on an active
 * series it is also marked, so it returns if the rule comes to hold it. A night with overrides, a lineup, or slots
 * is detached and stays published. Started nights are never touched.
 */
export async function retireOccurrences(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  now: number,
): Promise<{ unpublished: Id<"events">[]; detached: Id<"events">[] }> {
  const result = { unpublished: [] as Id<"events">[], detached: [] as Id<"events">[] };
  const { db } = ctx;
  for (const night of await upcomingPublishedNights(db, series, now)) {
    const date = night.occurrenceDate!;
    if (series.state === "active" && occurrenceDates(series, date, date).length > 0) continue;
    const customised =
      (night.overrides ?? []).length > 0 ||
      (await db.query("eventLineupEntries").withIndex("by_eventId_position", (q) => q.eq("eventId", night._id)).first()) !== null ||
      (await db.query("eventSlots").withIndex("by_eventId", (q) => q.eq("eventId", night._id)).first()) !== null;
    if (customised) {
      await db.patch(night._id, { seriesId: undefined, occurrenceDate: undefined, overrides: undefined, updatedAt: now });
      await enqueueEventSync(db, ctx.scheduler, night._id, "upsert");
      result.detached.push(night._id);
    } else {
      // The helper enqueues the sync itself, which exports the unpublish as a delete.
      await applyEventPublicationState(ctx, night, "draft_private", seriesAuthSubject(series), "system", now);
      if (series.state === "active") await db.patch(night._id, { seriesRetiredAt: now });
      result.unpublished.push(night._id);
    }
  }
  return result;
}

/** Whether a night has not started; a date-only night counts as upcoming through its own date. */
export function isUpcomingNight(series: Pick<Doc<"eventSeries">, "timezone">, night: Doc<"events">, now: number): boolean {
  return night.startAt === undefined ? night.occurrenceDate! >= eventDateForInstant(now, series.timezone) : night.startAt > now;
}

async function upcomingPublishedNights(db: DatabaseReader, series: Doc<"eventSeries">, now: number): Promise<Doc<"events">[]> {
  const today = eventDateForInstant(now, series.timezone);
  // A day early, so a night whose own timezone differs from the series' is still seen; startAt decides.
  const nights = await db
    .query("events")
    .withIndex("by_seriesId_occurrenceDate", (q) => q.eq("seriesId", series._id).gte("occurrenceDate", fromDay(toDay(today) - 1)))
    .collect();
  return nights.filter((night) => night.publicationState === "published" && isUpcomingNight(series, night, now));
}

type TimeField = "startAt" | "doorsOpenAt" | "endAt";
const TIME_FIELDS = ["startAt", "doorsOpenAt", "endAt"] as const;

/** Whether a night's times and slots pass the editor's own checks: doors at or before start, end after start, slots inside. */
function timesFit(
  title: string,
  times: { startAt: number; doorsOpenAt?: number; endAt?: number },
  timezone: string,
  slots: { startAt: number; endAt?: number }[],
): boolean {
  try {
    sanitizeEventDraftInput({ title, ...times, timezone, slotLinks: slots.map((slot) => ({ displayLabel: "", ...slot })) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies `fields` from the series onto one night and never touches `overrides`. Time fields are skipped on a
 * date-only night and on a date where the rule start does not exist. Slots, and overridden doors and end times,
 * move by the same delta as the start; when the result still fails the editor's checks the night's times stay as they
 * were and the skipped fields become overrides, so the night shows a Reset and later edits stop targeting it.
 */
export async function applySeriesFields(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  event: Doc<"events">,
  fields: readonly SeriesOwnedEventField[],
  now: number,
): Promise<boolean> {
  const { db } = ctx;
  const times = event.startAt === undefined ? null : occurrenceTimes(series, event.occurrenceDate!);
  const wanted = fields.filter((field) => times !== null || !NUMBER_FIELDS.has(field));
  const withWorld = wanted.includes("worldSlug");
  const world = withWorld ? await publishedWorldOrUndefined(db, series) : undefined;
  const fromSeries: SeriesFieldValues = { ...series, ...times, worldSlug: world?.slug };
  const fromEvent: SeriesFieldValues = { ...event, worldSlug: withWorld ? (await linkedPublishedEventWorld(db, event._id))?.slug : undefined };
  let changed = wanted.filter((field) => !sameSeriesFieldValue(field, fromEvent[field], fromSeries[field]));
  const timePatch: Record<string, number | undefined> = {};
  if (changed.some((field) => NUMBER_FIELDS.has(field))) {
    const pick = (field: TimeField) => (changed.includes(field) ? (fromSeries[field] as number | undefined) : event[field]);
    const startAt = pick("startAt")!;
    const delta = startAt - event.startAt!;
    // An overridden doors or end time rides along with the start, like the slots, so the night keeps its shape.
    const ride = (field: "doorsOpenAt" | "endAt") => {
      const value = pick(field);
      return value !== undefined && !changed.includes(field) && (event.overrides ?? []).includes(field) ? value + delta : value;
    };
    const next = { startAt, doorsOpenAt: ride("doorsOpenAt"), endAt: ride("endAt") };
    const slots = await db.query("eventSlots").withIndex("by_eventId", (q) => q.eq("eventId", event._id)).collect();
    const fits = timesFit(
      changed.includes("title") ? series.title : event.title,
      next,
      (changed.includes("timezone") ? series.timezone : event.timezone) ?? "UTC",
      slots.map((slot) => ({ startAt: slot.startAt + delta, endAt: slot.endAt === undefined ? undefined : slot.endAt + delta })),
    );
    if (fits) {
      for (const field of TIME_FIELDS) if (next[field] !== event[field]) timePatch[field] = next[field];
    } else {
      console.warn("series times do not fit this night; its times are left unchanged", { eventId: event._id, seriesId: series._id });
      const skipped = changed.filter((field) => NUMBER_FIELDS.has(field));
      await db.patch(event._id, { overrides: [...new Set([...(event.overrides ?? []), ...skipped])].sort(), updatedAt: now });
    }
    changed = changed.filter((field) => !NUMBER_FIELDS.has(field));
  }
  if (changed.length === 0 && Object.keys(timePatch).length === 0) return false;

  const patch: Record<string, unknown> = { updatedAt: now, ...timePatch };
  for (const field of changed) if (field !== "worldSlug") patch[field] = fromSeries[field];
  if ("title" in patch) patch.sortTitle = createEventSortTitle(series.title);
  if ("startAt" in patch || "timezone" in patch) {
    const startAt = (patch.startAt as number | undefined) ?? event.startAt!;
    const timeZone = (patch.timezone as string | undefined) ?? event.timezone;
    Object.assign(patch, normalizeEventSchedule({ kind: "timed", startAt, date: eventDateForInstant(startAt, timeZone), timeZone }));
  }
  if (event.contributionFingerprint !== undefined && event.communityProfileId !== undefined) {
    patch.contributionFingerprint = eventContributionFingerprint(
      event.communityProfileId,
      (patch.eventDate as string | undefined) ?? event.eventDate!,
      (patch.title as string | undefined) ?? event.title,
    );
  }
  await db.patch(event._id, patch as Partial<Doc<"events">>);
  const updated = (await db.get(event._id))!;

  if (updated.startAt !== event.startAt) {
    const delta = updated.startAt! - event.startAt!;
    const slots = await db.query("eventSlots").withIndex("by_eventId", (q) => q.eq("eventId", event._id)).collect();
    for (const slot of slots) {
      await db.patch(slot._id, { startAt: slot.startAt + delta, ...(slot.endAt === undefined ? {} : { endAt: slot.endAt + delta }), updatedAt: now });
    }
    await syncClubEventOperations(ctx, event._id);
    await reconcileEventMediaScheduleChange(db, event, updated.startAt, seriesAuthSubject(series), now);
    // ponytail: no telemetry rollup recompute; it needs a confirmed instance association, which only a started night has.
  }
  if (changed.includes("worldSlug")) await replaceEventWorldLink(db, updated, world, now, { preserveNonPublic: true });
  await syncPreservedEventAssociations(db, updated, now, { preserveParticipants: true, preserveSlots: true, preserveWorld: true });
  const community = updated.communityProfileId === undefined ? null : await db.get(updated.communityProfileId);
  await reindexEventSearchDocument(
    db,
    updated,
    { community: community?.profileType === "community" ? community : undefined, ...(await eventSearchAssociations(db, updated)) },
    now,
  );
  return true;
}

/** Applies a series edit to every upcoming published night, minus that night's overrides. The caller enqueues each returned ID. */
export async function fanOutSeriesEdit(
  ctx: MutationCtx,
  series: Doc<"eventSeries">,
  changedFields: readonly SeriesOwnedEventField[],
): Promise<Id<"events">[]> {
  if (changedFields.length === 0) return [];
  const now = Date.now();
  const changed: Id<"events">[] = [];
  for (const night of await upcomingPublishedNights(ctx.db, series, now)) {
    if (night.moderationRemovedAt !== undefined) continue;
    const overrides = new Set(night.overrides ?? []);
    const fields = changedFields.filter((field) => !overrides.has(field));
    if (fields.length > 0 && (await applySeriesFields(ctx, series, night, fields, now))) changed.push(night._id);
  }
  return changed;
}

/** Adds to `after.overrides` every series-owned field a night edit changed, plus worldSlug when the linked world changed. */
export async function recordOccurrenceOverrides(
  db: DatabaseWriter,
  before: Doc<"events">,
  after: Doc<"events">,
  worldChanged: boolean,
): Promise<void> {
  const was: SeriesFieldValues = before;
  const is: SeriesFieldValues = after;
  const current = after.overrides ?? [];
  const added = SERIES_OWNED_EVENT_FIELDS.filter((field) =>
    !current.includes(field) && (field === "worldSlug" ? worldChanged : !sameSeriesFieldValue(field, was[field], is[field])));
  if (added.length > 0) await db.patch(after._id, { overrides: [...current, ...added].sort() });
}

export function isSeriesOwnedEventField(field: string): field is SeriesOwnedEventField {
  return (SERIES_OWNED_EVENT_FIELDS as readonly string[]).includes(field);
}

export type SeriesUpdate = {
  title?: string;
  summary?: string | null;
  timezone?: string;
  venueLabel?: string | null;
  worldSlug?: string | null;
  mediaLinks?: EventOwnerDraftInput["mediaLinks"];
  watchMode?: EventOwnerDraftInput["watchMode"];
  watchSurfaceEnabled?: boolean;
  bannerImageUrl?: string | null;
  thumbnailImageUrl?: string | null;
  sourceUrl?: string | null;
  rule?: SeriesRule;
  endsOn?: string | null;
  count?: number | null;
};

type EditableSeriesField = Exclude<SeriesOwnedEventField, "startAt" | "doorsOpenAt" | "endAt">;
const EDITABLE_SERIES_FIELDS = SERIES_OWNED_EVENT_FIELDS.filter((field) => !NUMBER_FIELDS.has(field)) as EditableSeriesField[];
const RULE_KEYS = ["frequency", "weekday", "ordinal", "startTime", "doorsTime", "endTime"] as const;
const RULE_TIME_FIELDS: Partial<Record<(typeof RULE_KEYS)[number], SeriesOwnedEventField>> = {
  startTime: "startAt",
  doorsTime: "doorsOpenAt",
  endTime: "endAt",
};
const DAY_MINUTES = 24 * 60;
const MAX_DOORS_LEAD_MINUTES = 12 * 60;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/**
 * The series patch for an edit and the event fields it changes. String fields go through the event sanitiser so
 * series values match stored event values. Bounds are validated only for the parts being changed, so an ended
 * series (whose endsOn can precede startsOn) stays editable.
 */
export async function seriesUpdatePatch(
  db: DatabaseReader,
  series: Doc<"eventSeries">,
  update: SeriesUpdate,
  now: number,
): Promise<{ patch: Partial<Doc<"eventSeries">>; changed: SeriesOwnedEventField[]; datesChanged: boolean }> {
  const merged = Object.fromEntries(
    EDITABLE_SERIES_FIELDS.map((field) => [field, update[field] === undefined ? series[field] : update[field] ?? undefined]),
  );
  // The start instant is a placeholder: only the string, link and watch fields are read back.
  const clean: SeriesFieldValues = sanitizeEventDraftInput({ ...merged, title: merged.title as string, startAt: now } as EventOwnerDraftInput);
  clean.timezone ??= series.timezone;
  const patch: Record<string, unknown> = {};
  const changed = new Set<SeriesOwnedEventField>();
  for (const field of EDITABLE_SERIES_FIELDS) {
    if (update[field] === undefined || sameSeriesFieldValue(field, series[field], clean[field])) continue;
    patch[field] = clean[field];
    changed.add(field);
  }
  if (typeof patch.worldSlug === "string") {
    const validation = validateWorldSlug(patch.worldSlug);
    const world = validation.ok ? await getWorldBySlug(db, validation.slug) : null;
    if (world?.publicationState !== "published") throw new Error("World profile was not found or is not published.");
    patch.worldSlug = world.slug;
  }
  if (changed.has("timezone")) for (const field of ["startAt", "doorsOpenAt", "endAt"] as const) changed.add(field);

  let datesChanged = false;
  if (update.rule !== undefined) {
    const rule = update.rule;
    const ruleDiff = RULE_KEYS.filter((key) => rule[key] !== series.rule[key]);
    if (ruleDiff.length > 0) {
      patch.rule = rule;
      datesChanged = true;
      for (const key of ruleDiff) {
        const field = RULE_TIME_FIELDS[key];
        if (field) changed.add(field);
      }
      // Only on this edit: a doors time past the start is the previous day, so a stale one reads as hours early.
      const lead = (minutesOf(rule.startTime) - minutesOf(rule.doorsTime ?? rule.startTime) + DAY_MINUTES) % DAY_MINUTES;
      if ((ruleDiff.includes("startTime") || ruleDiff.includes("doorsTime")) && lead > MAX_DOORS_LEAD_MINUTES) {
        throw new Error("Doors-open time must be within 12 hours of the start time.");
      }
    }
  }
  const bounds: { startsOn: string; endsOn?: string; count?: number } = { startsOn: series.startsOn };
  if (update.endsOn !== undefined && (update.endsOn ?? undefined) !== series.endsOn) {
    patch.endsOn = bounds.endsOn = update.endsOn ?? undefined;
    datesChanged = true;
  }
  if (update.count !== undefined && (update.count ?? undefined) !== series.count) {
    patch.count = bounds.count = update.count ?? undefined;
    datesChanged = true;
  }
  if (update.rule !== undefined || datesChanged) validateSeriesRule(update.rule ?? series.rule, bounds);
  return { patch: patch as Partial<Doc<"eventSeries">>, changed: [...changed].sort(), datesChanged };
}
