import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { eventDateForInstant } from "../_eventSchedule";
import {
  deleteEvent, ensureWatch, getEvent, GoogleApiError, googleTarget, insertEvent, listEvents, patchEvent, requireGoogleCalendarEnabled, withGoogleToken,
  type GoogleCalendarEvent, type GoogleEventBody, type GoogleEventDateTime,
} from "../_googleCalendar";
import { EventIntakeLocalTimeSchema, resolveEventLocalTime, type EventIntakeFields, type EventIntakeLocalTime } from "../../packages/api-contracts/src/event-intake";
import type { SyncKindHandler } from "./types";

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

// Google PATCH merges nested objects, so switching timed and date-only must null the other member.
const patchTime = (time: GoogleEventDateTime) => time.date ? { ...time, dateTime: null, timeZone: null } : { ...time, date: null };

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };
const clip = (value: string | undefined, max: number) => value?.trim().slice(0, max).trim() || null;

const lastLine = (lines: string[]) => lines[lines.length - 1];

// Google's UI saves descriptions as HTML; read them back as the plain text we export, split into lines with no trailing blanks.
function descriptionLines(description: string): string[] {
  // Only Google's editor writes HTML; a plain-text summary with < or &amp; must round-trip unchanged.
  const text = !/<br|<p|<\//i.test(description) ? description : description.replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity]!);
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
function patchKeepingGoogle(full: Record<keyof GoogleEventBody, unknown>, item: GoogleCalendarEvent, event: Doc<"events">, eventUrl: string, siteUrl: string) {
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

// Mirrors correctionFields, occurrence included, so a fall-back-hour echo hashes the same as the export.
function localTime(instant: number, eventDate: string, timezone: string): EventIntakeLocalTime {
  const dayOffset = (Date.parse(eventDateForInstant(instant, timezone)) - Date.parse(eventDate)) / DAY_MS;
  const value: EventIntakeLocalTime = {
    time: new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant),
    ...(dayOffset ? { dayOffset } : {}),
  };
  let choices: number[] = [];
  try {
    choices = resolveEventLocalTime(eventDate, value, timezone);
  } catch {
    // An offset zone or an out-of-range dayOffset; Task 4's validation decides what to do with it.
  }
  if (choices.length > 1) value.occurrence = choices[0] === instant ? "earlier" : "later";
  return value;
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
  const end = !Number.isNaN(endAt) && endAt !== startAt ? localTime(endAt, eventDate, timezone) : null;
  return { ...fields, eventDate, timeTba: false, timezone, start: localTime(startAt, eventDate, timezone), end };
}

// Private and confidential items, past items, recurring instances more than 60 days out, and spans past the intake's day range never import; "today" is in the item's zone.
// Callers handle a cancelled item first, so the flag on a linked copy still lands.
export function outsideImportWindow(item: GoogleCalendarEvent, fields: EventIntakeFields, calendarTimeZone: string): boolean {
  if (item.visibility === "private" || item.visibility === "confidential") return true;
  if (!fields.eventDate) return true;
  const today = eventDateForInstant(Date.now(), fields.timezone ?? calendarTimeZone);
  if (fields.eventDate < today || (item.recurringEventId && fields.eventDate > addDays(today, 60))) return true;
  return [fields.start, fields.end].some(time => time && !EventIntakeLocalTimeSchema.safeParse(time).success);
}

const MAX_PAGES = 200;

// Every page of one list; the last page carries the sync token.
async function listAll(token: string, calendarId: string, params: { syncToken?: string; timeMin?: string; timeMax?: string }) {
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

export const googleCalendarHandler: SyncKindHandler = {
  async importItem(ctx, connector, payload) {
    requireGoogleCalendarEnabled();
    const { item, calendarTimeZone } = payload as { item: GoogleCalendarEvent; calendarTimeZone: string };
    await ctx.runMutation(internal.googleCalendarConnector.applyImport, { connectorId: connector._id, item, calendarTimeZone });
  },

  async importPoll(ctx, connector) {
    requireGoogleCalendarEnabled();
    const { credentialId, calendarId } = googleTarget(connector);
    const { syncToken } = connector.target;
    const list = await withGoogleToken(ctx, credentialId, async token => {
      try {
        return await listAll(token, calendarId, { syncToken });
      } catch (error) {
        if (!(syncToken && error instanceof GoogleApiError && error.status === 410)) throw error;
      }
      // Google forbids timeMin and timeMax alongside a sync token, so the list that seeds the next one has no bounds either.
      // ponytail: full resync pages the whole calendar in one action; split by page into jobs if a calendar outgrows the action time limit.
      return await listAll(token, calendarId, {});
    });
    for (const item of list.items) {
      const args = { connectorId: connector._id, item, calendarTimeZone: list.timeZone };
      try {
        // A full list holds the calendar's whole past; skip it here instead of one mutation per old item.
        if (item.status !== "cancelled" && outsideImportWindow(item, fieldsFromGoogleEvent(item, list.timeZone, ""), list.timeZone)) continue;
        await ctx.runMutation(internal.googleCalendarConnector.applyImport, args);
      } catch {
        // One bad item retries and alarms on its own job; the calendar's sync token still moves.
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

  async exportUpsert(ctx, connector, event, link) {
    requireGoogleCalendarEnabled();
    // The organiser deleted the copy in Google; never bring it back.
    if (link?.state === "external_deleted") return { externalId: link.externalId };
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
          .filter(item => itemDate(item, timezone) === eventDate && clip(item.summary, 120)?.toLowerCase() === title)
          .map(item => item.id);
        const linked = candidates.length ? await ctx.runQuery(internal.googleCalendarConnector.linkedExternalIds, { connectorId: connector._id, externalIds: candidates }) : [];
        const match = candidates.find(id => !linked.includes(id));
        if (match) return { externalId: (await patchEvent(token, calendarId, match, patch)).id };
      }
      return { externalId: (await insertEvent(token, calendarId, body)).id };
    });
  },

  async exportDelete(ctx, connector, link) {
    requireGoogleCalendarEnabled();
    const { credentialId, calendarId } = googleTarget(connector);
    await withGoogleToken(ctx, credentialId, token => deleteEvent(token, calendarId, link.externalId));
  },
};
