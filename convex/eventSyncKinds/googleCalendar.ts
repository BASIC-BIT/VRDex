import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { eventDateForInstant } from "../_eventSchedule";
import {
  deleteEvent, GoogleApiError, googleTarget, insertEvent, listEvents, patchEvent, requireGoogleCalendarEnabled, withGoogleToken,
  type GoogleCalendarEvent, type GoogleEventBody, type GoogleEventDateTime,
} from "../_googleCalendar";
import type { EventIntakeFields } from "../../packages/api-contracts/src/event-intake";
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

// Google's UI saves descriptions as HTML; read them back as the plain text we export, minus our URL line.
function plainDescription(description: string | undefined, siteUrl: string): string | null {
  if (!description) return null;
  const text = description.replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity]!);
  const lines = text.split("\n");
  const last = () => lines[lines.length - 1]?.trim();
  while (last() === "") lines.pop();
  if (last()?.startsWith(siteUrl.replace(/\/$/, "") + "/")) lines.pop();
  while (last() === "") lines.pop();
  return clip(lines.join("\n"), 240);
}

const clock = (instant: number, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);

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
  let end: EventIntakeFields["end"] = null;
  if (!Number.isNaN(endAt) && endAt !== startAt) {
    const dayOffset = (Date.parse(eventDateForInstant(endAt, timezone)) - Date.parse(eventDate)) / DAY_MS;
    end = { time: clock(endAt, timezone), ...(dayOffset ? { dayOffset } : {}) };
  }
  return { ...fields, eventDate, timeTba: false, timezone, start: { time: clock(startAt, timezone) }, end };
}

export const googleCalendarHandler: SyncKindHandler = {
  async importPoll(ctx, connector) {
    requireGoogleCalendarEnabled();
    const { credentialId, calendarId } = googleTarget(connector);
    await withGoogleToken(ctx, credentialId, token => listEvents(token, calendarId, {}));
  },

  async exportUpsert(ctx, connector, event, link) {
    requireGoogleCalendarEnabled();
    // The organiser deleted the copy in Google; never bring it back.
    if (link?.state === "external_deleted") return { externalId: link.externalId };
    const { eventUrl, credentialId, calendarId } = await ctx.runQuery(internal.googleCalendarConnector.exportContext, { connectorId: connector._id, eventId: event._id });
    const body = googleBodyFromEvent(event, eventUrl);
    const patch = { ...body, start: patchTime(body.start), end: patchTime(body.end) };
    return await withGoogleToken(ctx, credentialId, async token => {
      if (link) {
        try {
          return { externalId: (await patchEvent(token, calendarId, link.externalId, patch)).id };
        } catch (error) {
          if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
        }
      } else {
        // Link a copy the organiser already made by hand instead of adding a second one.
        const eventDate = event.eventDate ?? eventDateForInstant(event.startAt!, event.timezone);
        // ponytail: first page only (250 items over three days); page through if a calendar ever fills it.
        const page = await listEvents(token, calendarId, { timeMin: `${addDays(eventDate, -1)}T00:00:00Z`, timeMax: `${addDays(eventDate, 2)}T00:00:00Z` });
        const title = event.title.trim().toLowerCase();
        const candidates = page.items.filter(item => {
          const fields = fieldsFromGoogleEvent(item, page.timeZone, "");
          return fields.eventDate === eventDate && fields.title?.toLowerCase() === title;
        }).map(item => item.id);
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
