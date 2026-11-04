import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { eventDateForInstant, eventLocalTimeLenient } from "../_eventSchedule";
import { occurrenceDates, occurrenceTimes, seriesEnded } from "../_eventSeries";
import { connectorSeriesEnabled } from "../_eventSeriesModel";
import { seriesHash, seriesSyncFields, type ExternalSeries, type SeriesSyncFields } from "../_eventSeriesSync";
import { formatGoogleRecurrence, parseGoogleRecurrence } from "../_recurrenceRules";
import {
  deleteEvent, ensureWatch, getEvent, GoogleApiError, googleTarget, insertEvent, listEvents, listInstances, patchEvent, requireGoogleCalendarEnabled, withGoogleToken,
  type GoogleCalendarEvent, type GoogleEventBody, type GoogleEventDateTime,
} from "../_googleCalendar";
import { EventIntakeLocalTimeSchema, type EventIntakeFields } from "../../packages/api-contracts/src/event-intake";
import type { ExportResult, SyncKindHandler } from "./types";

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

export function googleBodyFromEvent(event: Doc<"events">, eventUrl: string): GoogleEventBody {
  let start: GoogleEventDateTime;
  let end: GoogleEventDateTime;
  if (event.scheduleKind === "date_only") {
    if (!event.eventDate) throw new Error("EVENT_SCHEDULE");
    start = { date: event.eventDate };
    end = { date: addDays(event.eventDate, 1) };
  } else {
    if (event.startAt === undefined) throw new Error("EVENT_SCHEDULE");
    const timeZone = event.timezone ?? "UTC";
    start = { dateTime: new Date(event.startAt).toISOString(), timeZone };
    end = { dateTime: new Date(event.endAt ?? event.startAt).toISOString(), timeZone };
  }
  return {
    summary: event.title, description: event.summary ? `${event.summary}\n\n${eventUrl}` : eventUrl, location: event.venueLabel ?? "",
    start, end, status: event.eventStatus === "cancelled" ? "cancelled" : "confirmed",
  };
}

/** A series as one recurring master: Google requires the zone on its start, and UNTIL is the series' last local minute. */
export function googleSeriesBody(series: Doc<"eventSeries">, seriesUrl: string): GoogleEventBody & { recurrence: string[] } {
  // Unbounded, so a series ended before its first night still has a start; a night lost to a DST gap gives way to the next.
  const first = occurrenceDates({ rule: series.rule, startsOn: series.startsOn }, series.startsOn, addDays(series.startsOn, 62))
    .map(date => occurrenceTimes(series, date)).find(times => times !== null);
  if (!first) throw new Error("EVENT_SCHEDULE");
  const timeZone = series.timezone;
  return {
    summary: series.title, description: series.summary ? `${series.summary}\n\n${seriesUrl}` : seriesUrl, location: series.venueLabel ?? "",
    start: { dateTime: new Date(first.startAt).toISOString(), timeZone }, end: { dateTime: new Date(first.endAt ?? first.startAt).toISOString(), timeZone },
    status: "confirmed", recurrence: formatGoogleRecurrence(series.rule, series.endsOn, series.count, series.timezone),
  };
}

// Google PATCH merges nested objects, so switching timed and date-only must null the other member.
const patchTime = (time: GoogleEventDateTime) => time.date ? { ...time, dateTime: null, timeZone: null } : { ...time, date: null };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };
const clip = (value: string | undefined, max: number) => value?.trim().slice(0, max).trim() || null;

const lastLine = (lines: string[]) => lines[lines.length - 1];

// One pass already reaches a fixed point with this regex; repeating states that guarantee for CodeQL's multi-character sanitization rule.
function stripTags(html: string): string {
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text;
}

// Google's UI saves descriptions as HTML; read them back as the plain text we export, split into lines with no trailing blanks.
function descriptionLines(description: string): string[] {
  // Only Google's editor writes HTML; a plain-text summary with < or &amp; must round-trip unchanged.
  const text = !/<br|<p|<\//i.test(description) ? description : stripTags(description.replace(/<br\s*\/?>|<\/p>/gi, "\n")).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity]!);
  const lines = text.split("\n");
  while (lastLine(lines)?.trim() === "") lines.pop();
  return lines;
}

const isEventUrlLine = (line: string | undefined, siteUrl: string) => line?.trim().startsWith(siteUrl.replace(/\/$/, "") + "/") ?? false;

// The description as VRDex's summary, minus our URL line.
function plainDescription(description: string | undefined, siteUrl: string): string | null {
  if (!description) return null;
  const lines = descriptionLines(description);
  if (isEventUrlLine(lastLine(lines), siteUrl)) lines.pop();
  while (lastLine(lines)?.trim() === "") lines.pop();
  return clip(lines.join("\n"), 240);
}

// VRDex's field caps must not cost an organiser their entry: where the clipped read-back already equals VRDex's value, Google's richer one stays.
// Reads the item's title, description, location, and date directly, so a zone Google sent that Intl refuses cannot fail the export.
// A series master passes its series: no schedule kind, so its times always go.
type KeptFields = Pick<Doc<"events">, "title" | "summary" | "venueLabel"> & Partial<Pick<Doc<"events">, "scheduleKind" | "eventDate">>;
function patchKeepingGoogle(full: Record<keyof GoogleEventBody, unknown>, item: GoogleCalendarEvent, event: KeptFields, eventUrl: string, siteUrl: string) {
  const patch: Partial<typeof full> = { ...full };
  if (clip(item.summary, 120) === clip(event.title, 120)) delete patch.summary;
  if (plainDescription(item.description, siteUrl) === clip(event.summary, 240)) {
    // ponytail: any trailing VRDex URL counts, so a renamed event keeps its old link line until its summary changes; rewriting HTML safely is the upgrade.
    const hasUrl = item.description && isEventUrlLine(lastLine(descriptionLines(item.description)), siteUrl);
    patch.description = hasUrl ? item.description : item.description ? `${item.description}\n\n${eventUrl}` : eventUrl;
  }
  if (clip(item.location, 120) === clip(event.venueLabel, 120)) delete patch.location;
  if (event.scheduleKind === "date_only" && item.start?.date === event.eventDate) {
    delete patch.start;
    delete patch.end;
  }
  return patch;
}

// The item's local date in the given zone; all-day items carry their own date.
const itemDate = (item: GoogleCalendarEvent, timezone: string) =>
  item.start?.date ?? (item.start?.dateTime ? eventDateForInstant(Date.parse(item.start.dateTime), timezone) : null);

export function fieldsFromGoogleEvent(item: GoogleCalendarEvent, calendarTimeZone: string, siteUrl: string): EventIntakeFields {
  const fields: EventIntakeFields = {
    title: clip(item.summary, 120), eventDate: null, timeTba: null, timezone: null, start: null, end: null,
    venueLabel: clip(item.location, 120), summary: plainDescription(item.description, siteUrl),
  };
  if (item.start?.date) return { ...fields, eventDate: item.start.date, timeTba: true };
  const startAt = item.start?.dateTime ? Date.parse(item.start.dateTime) : NaN;
  if (Number.isNaN(startAt)) return fields;
  const timezone = item.start!.timeZone ?? calendarTimeZone;
  const eventDate = eventDateForInstant(startAt, timezone);
  const endAt = item.end?.dateTime ? Date.parse(item.end.dateTime) : NaN;
  const end = !Number.isNaN(endAt) && endAt !== startAt ? eventLocalTimeLenient(endAt, eventDate, timezone) : null;
  return { ...fields, eventDate, timeTba: false, timezone, start: eventLocalTimeLenient(startAt, eventDate, timezone), end };
}

export const isPrivateItem = (item: GoogleCalendarEvent) => item.visibility === "private" || item.visibility === "confidential";

// Private and confidential items, past items, recurring instances more than 60 days out, and spans past the intake's day range never import; "today" is in the item's zone.
// Callers handle a cancelled item first, so the flag on a linked copy still lands.
export function outsideImportWindow(item: GoogleCalendarEvent, fields: EventIntakeFields, calendarTimeZone: string): boolean {
  if (isPrivateItem(item)) return true;
  if (!fields.eventDate) return true;
  const today = eventDateForInstant(Date.now(), fields.timezone ?? calendarTimeZone);
  if (fields.eventDate < today || (item.recurringEventId && fields.eventDate > addDays(today, 60))) return true;
  return [fields.start, fields.end].some(time => time && !EventIntakeLocalTimeSchema.safeParse(time).success);
}

const MAX_PAGES = 200;

// Every page of one list; the last page carries the sync token.
async function listAll(token: string, calendarId: string, params: { syncToken?: string; timeMin?: string; timeMax?: string; showDeleted?: boolean }) {
  const items: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let page: Awaited<ReturnType<typeof listEvents>>;
  let pages = 0;
  do {
    // 50,000 items; fail with a code well before the action time limit does it without one.
    if (++pages > MAX_PAGES) throw new Error("GOOGLE_PAGE_LIMIT");
    page = await listEvents(token, calendarId, { ...params, pageToken });
    items.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { items, nextSyncToken: page.nextSyncToken, timeZone: page.timeZone };
}

// A master's series fields, or null when it cannot be one: private, no title, all-day, a rule outside the fixed set, or a zone Intl refuses.
// A private master's instances fall back to phase one, which skips them; a cancelled instance carries no visibility of its own.
function seriesFieldsFromMaster(master: GoogleCalendarEvent, siteUrl: string): SeriesSyncFields | null {
  if (isPrivateItem(master)) return null;
  try {
    // A recurring master always carries start.timeZone, so the fallback zone never applies.
    const fields = fieldsFromGoogleEvent(master, "UTC", siteUrl);
    if (!fields.title || !fields.eventDate || !fields.timezone || !fields.start || !master.recurrence) return null;
    const parsed = parseGoogleRecurrence(master.recurrence, {
      date: fields.eventDate, timezone: fields.timezone, startTime: fields.start.time, ...(fields.end ? { endTime: fields.end.time } : {}),
    });
    // A BYDAY that is not the master's own weekday would lose the master's night; phase one keeps it.
    if (!parsed || parsed.rule.weekday !== new Date(`${fields.eventDate}T00:00:00Z`).getUTCDay()) return null;
    return {
      title: fields.title, summary: fields.summary ?? null, venueLabel: fields.venueLabel ?? null, timezone: fields.timezone,
      rule: parsed.rule, startsOn: parsed.startsOn, endsOn: parsed.endsOn ?? null, count: parsed.count ?? null,
    };
  } catch (error) {
    // Only bad source data reads as outside the set; anything else is a bug that must fail the job, not flag every night.
    if (error instanceof RangeError && /time zone/i.test(error.message)) return null;
    throw error;
  }
}

/** The master an instance names, read once per poll through `masters`. A missing or cancelled master is a deletion. */
export async function fetchExternalSeries(ctx: ActionCtx, connector: Doc<"eventConnectors">, externalSeriesId: string, masters = new Map<string, GoogleCalendarEvent | null>()): Promise<ExternalSeries> {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) throw new Error("SITE_URL_MISSING");
  let master = masters.get(externalSeriesId);
  if (master === undefined) {
    const { credentialId, calendarId } = googleTarget(connector);
    master = await withGoogleToken(ctx, credentialId, async token => {
      try {
        return await getEvent(token, calendarId, externalSeriesId);
      } catch (error) {
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        return null;
      }
    });
    masters.set(externalSeriesId, master);
  }
  // A missing master has no clock; 0 leaves the link's own, so a later restore still reads as newer.
  if (!master) return { externalSeriesId, externalUpdatedAt: 0, deleted: true, fields: null };
  const externalUpdatedAt = Date.parse(master.updated) || Date.now();
  if (master.status === "cancelled") return { externalSeriesId, externalUpdatedAt, deleted: true, fields: null };
  return { externalSeriesId, externalUpdatedAt, deleted: false, fields: seriesFieldsFromMaster(master, siteUrl) };
}

type ImportArgs = { connectorId: Id<"eventConnectors">; item: GoogleCalendarEvent; calendarTimeZone: string };

// An instance of a series linked here applies to its night; everything else is plan 08's import.
async function importGoogleItem(ctx: ActionCtx, connector: Doc<"eventConnectors">, args: ImportArgs, masters: Map<string, GoogleCalendarEvent | null>): Promise<void> {
  const { item } = args;
  const masterId = item.recurringEventId;
  // The window check applyImport would make comes first, as the poll's does; a cancelled item is exempt so its flag lands.
  if (masterId && connectorSeriesEnabled() && (item.status === "cancelled" || !outsideImportWindow(item, fieldsFromGoogleEvent(item, args.calendarTimeZone, ""), args.calendarTimeZone))) {
    const readLink = () => ctx.runQuery(internal.eventSeriesSync.readSeriesLink, { connectorId: connector._id, externalSeriesId: masterId });
    let link = await readLink();
    // A held connector keeps phase one until a series is linked, then leaves that series' items alone, cancellations included.
    if (connector.mode === "hold") {
      if (link) return;
    } else {
      // Every instance is read against its master, so the master is read once per poll, or once per item job.
      const external = await fetchExternalSeries(ctx, connector, masterId, masters);
      if (!link || (Date.parse(item.updated) || Date.now()) > (link.externalUpdatedAt ?? 0)) {
        const series = { connectorId: connector._id, externalSeriesId: masterId, externalUpdatedAt: external.externalUpdatedAt };
        // A master that left the fixed set reads as a deletion of the linked series: staff decide.
        if (external.deleted || !external.fields) {
          if (link) {
            await ctx.runMutation(internal.eventSeriesSync.applyExternalSeries, { ...series, deleted: true });
            return;
          }
        } else {
          await ctx.runMutation(internal.eventSeriesSync.applyExternalSeries, { ...series, deleted: false, fields: external.fields });
          link = await readLink();
        }
      }
      // A flagged series link still takes its instances: applyGoogleOccurrence stores a cancellation and ignores the rest.
      if (link?.seriesId) {
        const master = external.deleted ? null : masters.get(masterId) ?? null;
        await ctx.runMutation(internal.googleCalendarConnector.applyGoogleOccurrence, { connectorId: connector._id, seriesId: link.seriesId, item, master, calendarTimeZone: args.calendarTimeZone });
        return;
      }
    }
  }
  await ctx.runMutation(internal.googleCalendarConnector.applyImport, args);
}

const isGone = (error: unknown) => error instanceof GoogleApiError && (error.status === 404 || error.status === 410);

/**
 * A night of a series, with the series gate on: the master carries every night, so a night writes only its own exception.
 * Returns the export's result, or, for a night that is not a series', the link plan 08 exports with.
 */
async function exportSeriesNight(ctx: ActionCtx, connector: Doc<"eventConnectors">, event: Doc<"events">, link: Doc<"eventSyncLinks"> | null, exportedHash: string): Promise<ExportResult | { link: Doc<"eventSyncLinks"> | null }> {
  const connectorId = connector._id;
  // Detached by the series' end: UNTIL removed the instance the link named, so the night exports as a one-off.
  if (!event.seriesId) {
    if (link?.seriesId === undefined) return { link };
    await ctx.runMutation(internal.eventSeriesSync.tagNightLink, { connectorId, eventId: event._id, externalId: link.externalId });
    return { link: null };
  }
  const none = { externalId: "none:" + event._id };
  const seriesLink = await ctx.runQuery(internal.eventSeriesSync.readSeriesLink, { connectorId, seriesId: event.seriesId });
  const own = link && !link.externalId.startsWith("none:") ? link : null;
  // The night's own link, left as it is: the runner writes nothing to it, so R2's test below still reads it as it was.
  const keep = own && { externalId: own.externalId, unchanged: true as const };
  // No master yet (a night job can run before its series job): the series export queues this night again.
  // The night's own copy keeps its ID, so that follow-up still sees it and retracts or leaves it.
  if (!seriesLink || seriesLink.externalId.startsWith("none:")) {
    await ctx.runMutation(internal.eventSeriesSync.requestSeriesExport, { seriesId: event.seriesId });
    return keep || none;
  }
  // The organiser deleted the master: its nights have nothing to write to.
  if (seriesLink.state === "external_deleted") return keep || none;
  const master = seriesLink.externalId;
  // An ID named for the master is its instance whatever the link's tags say: a reconcile match carries none.
  let instanceId = own && (own.externalSeriesId === master || own.externalId.startsWith(master + "_")) ? own.externalId : null;
  if (own && !instanceId) {
    // A copy is retracted only when VRDex evidently made it; an organiser's own entry stays, and takes nothing.
    // ponytail: a hand-made copy plan 08's list match adopted looks VRDex-made and is deleted; an origin field on the link would tell them apart.
    if (own.lastImportedAt !== undefined || own.lastExportedHash === undefined || own.externalSeriesId !== undefined) return keep!;
    const { credentialId, calendarId } = googleTarget(connector);
    await withGoogleToken(ctx, credentialId, token => deleteEvent(token, calendarId, own.externalId));
  }
  // The master already says everything about a night with nothing of its own, unless VRDex wrote its instance (an exception, a cancel,
  // or a retraction): that one goes back to the night's values, which are the master's. An imported instance VRDex never wrote stays as it is.
  const plain = !(event.overrides ?? []).length && event.eventStatus !== "cancelled";
  const written = instanceId !== null && (own!.lastExportedHash !== undefined || own!.state === "vrdex_retracted");
  if (plain && !written) return instanceId ? { externalId: instanceId, unchanged: true } : none;
  const [{ eventUrl, siteUrl, credentialId, calendarId }, { series }] = await Promise.all([
    ctx.runQuery(internal.googleCalendarConnector.exportContext, { connectorId, eventId: event._id }),
    ctx.runQuery(internal.eventSeriesSync.seriesExportContext, { connectorId, seriesId: event.seriesId }),
  ]);
  const body = googleBodyFromEvent(event, eventUrl);
  const patch = { ...body, start: patchTime(body.start), end: patchTime(body.end) };
  let kept = false;
  instanceId = await withGoogleToken(ctx, credentialId, async token => {
    let item: GoogleCalendarEvent | undefined;
    if (instanceId) {
      try {
        item = await getEvent(token, calendarId, instanceId);
      } catch (error) {
        // A series time edit renames every instance; find this night's again.
        if (!isGone(error)) throw error;
      }
    }
    if (!item) {
      const date = event.occurrenceDate ?? event.eventDate!;
      const instances = await listInstances(token, calendarId, master, { timeMin: `${addDays(date, -1)}T00:00:00Z`, timeMax: `${addDays(date, 2)}T00:00:00Z` });
      item = instances.find(instance => itemDate({ ...instance, start: instance.originalStartTime }, series.timezone) === date);
      // Another event's link holds it (a phase-one copy left for staff): external IDs stay unique.
      if (item && (await ctx.runQuery(internal.googleCalendarConnector.linkedExternalIds, { connectorId, externalIds: [item.id] })).length) item = undefined;
    }
    if (!item) return null;
    // Unchanged since VRDex last wrote it, and not cancelled on Google: a cancel is not in the hash, so the instance itself says.
    if (plain && item.id === instanceId && own!.state !== "vrdex_retracted" && own!.lastExportedHash === exportedHash && item.status !== "cancelled") {
      kept = true;
      return item.id;
    }
    // Patching an instance is how Google records one night's exception; a cancelled status cancels that night alone, and a confirmed one restores it.
    await patchEvent(token, calendarId, item.id, patchKeepingGoogle(patch, item, event, eventUrl, siteUrl));
    return item.id;
  });
  if (!instanceId) {
    // Deleted on Google, or held by another event: nothing to write this night to.
    console.warn("GOOGLE_INSTANCE_MISSING", connectorId, event._id);
    return none;
  }
  if (kept) return { externalId: instanceId, unchanged: true };
  await ctx.runMutation(internal.eventSeriesSync.tagNightLink, { connectorId, eventId: event._id, externalId: instanceId, seriesId: event.seriesId, externalSeriesId: master });
  return { externalId: instanceId };
}

export const googleCalendarHandler: SyncKindHandler = {
  async importItem(ctx, connector, payload) {
    requireGoogleCalendarEnabled();
    const { item, calendarTimeZone } = payload as { item: GoogleCalendarEvent; calendarTimeZone: string };
    await importGoogleItem(ctx, connector, { connectorId: connector._id, item, calendarTimeZone }, new Map());
  },

  async importPoll(ctx, connector) {
    requireGoogleCalendarEnabled();
    const { credentialId, calendarId } = googleTarget(connector);
    const { syncToken } = connector.target;
    const list = await withGoogleToken(ctx, credentialId, async token => {
      try {
        return await listAll(token, calendarId, { syncToken, showDeleted: true });
      } catch (error) {
        if (!(syncToken && error instanceof GoogleApiError && error.status === 410)) throw error;
      }
      // Google forbids timeMin and timeMax alongside a sync token, so the list that seeds the next one has no bounds either.
      // ponytail: full resync pages the whole calendar in one action; split by page into jobs if a calendar outgrows the action time limit.
      // showDeleted so a deletion in the gap still flags its link; a full list hides tombstones by default.
      return await listAll(token, calendarId, { showDeleted: true });
    });
    // One read per master for the whole poll: a series edit arrives as every one of its instances.
    const masters = new Map<string, GoogleCalendarEvent | null>();
    for (const item of list.items) {
      const args = { connectorId: connector._id, item, calendarTimeZone: list.timeZone };
      try {
        // A full list holds the calendar's whole past; skip it here instead of one mutation per old item.
        if (item.status !== "cancelled" && outsideImportWindow(item, fieldsFromGoogleEvent(item, list.timeZone, ""), list.timeZone)) continue;
        await importGoogleItem(ctx, connector, args, masters);
      } catch {
        // One bad item retries on its own job, and its final failure shows in lastError until the next successful job; the calendar's sync token still moves.
        await ctx.runMutation(internal.googleCalendarConnector.enqueueImportItem, args);
      }
    }
    await ctx.runMutation(internal.googleCalendarConnector.patchGoogleTarget, { connectorId: connector._id, target: { syncToken: list.nextSyncToken }, syncedAt: Date.now() });
  },

  async reconcile(ctx, connector) {
    requireGoogleCalendarEnabled();
    const { credentialId, calendarId } = googleTarget(connector);
    const today = new Date(Date.now()).toISOString().slice(0, 10);
    const list = await withGoogleToken(ctx, credentialId, token => listAll(token, calendarId, { timeMin: `${today}T00:00:00Z`, timeMax: `${addDays(today, 90)}T00:00:00Z` }));
    await ctx.runMutation(internal.googleCalendarConnector.reconcileItems, { connectorId: connector._id, items: list.items, calendarTimeZone: list.timeZone });
    // ponytail: a rejected watch must not fail a reconcile whose imports committed; the 15-minute poll, daily renewal, and stale alert cover it.
    await ensureWatch(ctx, connector, false).catch(() => undefined);
  },

  async exportUpsert(ctx, connector, event, link, _job, exportedHash) {
    requireGoogleCalendarEnabled();
    // The organiser deleted the copy in Google; never bring it back.
    if (link?.state === "external_deleted") return { externalId: link.externalId };
    if (connectorSeriesEnabled()) {
      const night = await exportSeriesNight(ctx, connector, event, link, exportedHash);
      if ("externalId" in night) return night;
      link = night.link;
    }
    // A none: link names no Google item: a series night the master carried.
    if (link?.externalId.startsWith("none:")) link = null;
    const { eventUrl, siteUrl, credentialId, calendarId } = await ctx.runQuery(internal.googleCalendarConnector.exportContext, { connectorId: connector._id, eventId: event._id });
    const body = googleBodyFromEvent(event, eventUrl);
    const patch = { ...body, start: patchTime(body.start), end: patchTime(body.end) };
    return await withGoogleToken(ctx, credentialId, async token => {
      if (link) {
        try {
          const item = await getEvent(token, calendarId, link.externalId);
          return { externalId: (await patchEvent(token, calendarId, link.externalId, patchKeepingGoogle(patch, item, event, eventUrl, siteUrl))).id };
        } catch (error) {
          if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        }
      } else {
        // Link a copy the organiser already made by hand instead of adding a second one.
        const eventDate = event.eventDate ?? eventDateForInstant(event.startAt!, event.timezone);
        // ponytail: first page only (250 items over three days); page through if a calendar ever fills it.
        const page = await listEvents(token, calendarId, { timeMin: `${addDays(eventDate, -1)}T00:00:00Z`, timeMax: `${addDays(eventDate, 2)}T00:00:00Z` });
        const title = clip(event.title, 120)?.toLowerCase();
        const timezone = event.timezone ?? "UTC";
        const candidates = page.items
          .filter(item => !isPrivateItem(item) && itemDate(item, timezone) === eventDate && clip(item.summary, 120)?.toLowerCase() === title);
        const linked = candidates.length ? await ctx.runQuery(internal.googleCalendarConnector.linkedExternalIds, { connectorId: connector._id, externalIds: candidates.map(item => item.id) }) : [];
        // An instance of a series linked here is that series' night, never a hand-made copy: a detached night must not adopt the one it replaces.
        const seriesMasters = new Set<string>();
        if (connectorSeriesEnabled()) {
          for (const masterId of new Set(candidates.flatMap(item => item.recurringEventId ? [item.recurringEventId] : []))) {
            if (await ctx.runQuery(internal.eventSeriesSync.readSeriesLink, { connectorId: connector._id, externalSeriesId: masterId })) seriesMasters.add(masterId);
          }
        }
        const match = candidates.find(item => !linked.includes(item.id) && !(item.recurringEventId && seriesMasters.has(item.recurringEventId)));
        if (match) return { externalId: (await patchEvent(token, calendarId, match.id, patchKeepingGoogle(patch, match, event, eventUrl, siteUrl))).id };
      }
      return { externalId: (await insertEvent(token, calendarId, body)).id };
    });
  },

  async exportSeries(ctx, connector, series, link) {
    requireGoogleCalendarEnabled();
    // The organiser deleted the master in Google; never bring it back, and write nothing to its link.
    if (link?.state === "external_deleted") return { externalId: link.externalId, unchanged: true };
    const linkedId = link && !link.externalId.startsWith("none:") ? link.externalId : null;
    if (linkedId && link!.lastExportedHash === seriesHash(seriesSyncFields(series))) return { externalId: linkedId, unchanged: true };
    const { seriesUrl, phaseOneExternalSeriesId } = await ctx.runQuery(internal.eventSeriesSync.seriesExportContext, { connectorId: connector._id, seriesId: series._id });
    const body = googleSeriesBody(series, seriesUrl);
    const { credentialId, calendarId } = googleTarget(connector);
    // A master phase one imported nights from becomes the series' master rather than a second one beside it.
    const masterId = linkedId ?? phaseOneExternalSeriesId;
    return await withGoogleToken(ctx, credentialId, async token => {
      if (masterId) {
        try {
          const item = await getEvent(token, calendarId, masterId);
          // seriesExportContext has already checked SITE_URL.
          const patch = patchKeepingGoogle({ ...body, start: patchTime(body.start), end: patchTime(body.end) }, item, series, seriesUrl, process.env.SITE_URL!);
          // An ended or removed series is the same patch: its endsOn is the UNTIL that ends it.
          return { externalId: (await patchEvent(token, calendarId, masterId, { ...patch, recurrence: body.recurrence })).id };
        } catch (error) {
          // Gone on Google: post a new master, as plan 08 does for a one-off.
          if (!isGone(error)) throw error;
        }
      }
      // A new master for a series with nothing ahead would only add past nights to the calendar.
      if (seriesEnded(series, eventDateForInstant(Date.now(), series.timezone))) return { externalId: "none:" + series._id };
      return { externalId: (await insertEvent(token, calendarId, body)).id };
    });
  },

  async exportDelete(ctx, connector, link) {
    requireGoogleCalendarEnabled();
    // A none: link names no Google item.
    if (link.externalId.startsWith("none:")) return;
    const { credentialId, calendarId } = googleTarget(connector);
    await withGoogleToken(ctx, credentialId, token => deleteEvent(token, calendarId, link.externalId));
  },
};
