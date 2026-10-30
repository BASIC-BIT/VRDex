import type { Doc } from "../_generated/dataModel";
import type { VrchatCalendarItem } from "../_clubOperations";
import { eventDateForInstant, eventLocalTime } from "../_eventSchedule";
import type { EventIntakeFields } from "../../packages/api-contracts/src/event-intake";

export const VRCHAT_TITLE_MAX = 64;
export const DEFAULT_DURATION_MS = 4 * 3_600_000;
const SUMMARY_MAX = 240;

export type CalendarWrite = { title: string; description: string; startsAt: string; endsAt: string; imageUrl?: string; accessType: "group" };

// Counts UTF-16 units as VRChat and validatePayload do; never splits a surrogate pair.
export function truncateTitle(title: string): string {
  if (title.length <= VRCHAT_TITLE_MAX) return title;
  const cut = title.slice(0, VRCHAT_TITLE_MAX - 1);
  return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut) + "…";
}

export function exportPayloadFromEvent(event: Doc<"events">, extras: { eventUrl: string; worldNames: string[]; artworkUrl?: string }): CalendarWrite {
  if (event.startAt === undefined) throw new Error("A date-only event has no VRChat calendar entry.");
  const tail = [extras.worldNames.join(", "), extras.eventUrl].filter(Boolean).join("\n");
  return {
    title: truncateTitle(event.title),
    description: [event.summary, tail].filter(Boolean).join("\n\n"),
    startsAt: new Date(event.startAt).toISOString(),
    endsAt: new Date(event.endAt ?? event.startAt + DEFAULT_DURATION_MS).toISOString(),
    ...(extras.artworkUrl ? { imageUrl: extras.artworkUrl } : {}),
    accessType: "group",
  };
}

// The same fields correctionFields(db, event) yields, so the runner's carried hash matches on a round trip.
export function fieldsFromVrchatEvent(item: VrchatCalendarItem, zone: string, siteUrl: string, linked: Doc<"events"> | null): EventIntakeFields {
  const timezone = linked?.timezone ?? zone;
  const startAt = Date.parse(item.startsAt);
  const endAt = Date.parse(item.endsAt);
  const eventDate = eventDateForInstant(startAt, timezone);
  const local = (instant: number) => {
    const { dayOffset, ...value } = eventLocalTime(instant, eventDate, timezone);
    return dayOffset ? { ...value, dayOffset } : value;
  };
  const paragraphs = item.description.split("\n\n");
  const lastLine = paragraphs[paragraphs.length - 1].split("\n");
  if (lastLine[lastLine.length - 1].startsWith(siteUrl + "/")) paragraphs.pop();
  const noEnd = linked !== null && linked.endAt === undefined && endAt - startAt === DEFAULT_DURATION_MS;
  return {
    title: linked && item.title === truncateTitle(linked.title) ? linked.title : item.title,
    eventDate, timeTba: false, timezone,
    start: local(startAt),
    end: noEnd ? null : local(endAt),
    summary: paragraphs.join("\n\n").trim().slice(0, SUMMARY_MAX) || null,
  };
}
