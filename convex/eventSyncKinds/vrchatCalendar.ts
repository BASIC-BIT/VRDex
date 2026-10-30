import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { VrchatCalendarItem } from "../_clubOperations";
import { eventDateForInstant, eventLocalTime } from "../_eventSchedule";
import type { EventIntakeFields } from "../../packages/api-contracts/src/event-intake";
import { AwaitingClubOperation, type SyncKindHandler } from "./types";

export const VRCHAT_TITLE_MAX = 64;
export const DEFAULT_DURATION_MS = 4 * 3_600_000;
const SUMMARY_MAX = 240;
const MAX_END_DAY_OFFSET = 7; // EventIntakeLocalTimeSchema's dayOffset ceiling

export type CalendarWrite = { title: string; description: string; startsAt: string; endsAt: string; imageUrl?: string; accessType: "group" };

// Counts UTF-16 units as VRChat and validatePayload do; never splits a surrogate pair.
function cutUnits(text: string, max: number): string {
  const cut = text.slice(0, max);
  return cut.length < text.length && /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

export function truncateTitle(title: string): string {
  return title.length <= VRCHAT_TITLE_MAX ? title : cutUnits(title, VRCHAT_TITLE_MAX - 1) + "…";
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
  // correctionFields reads a timezone-less event in UTC; matching it keeps the echo hash stable.
  const timezone = linked ? (linked.timezone ?? "UTC") : zone;
  const startAt = Date.parse(item.startsAt);
  const endAt = Date.parse(item.endsAt);
  const eventDate = eventDateForInstant(startAt, timezone);
  const local = (instant: number) => {
    const { dayOffset, ...value } = eventLocalTime(instant, eventDate, timezone);
    return dayOffset ? { ...value, dayOffset } : value;
  };
  const paragraphs = item.description.split("\n\n");
  const lastLine = paragraphs[paragraphs.length - 1].split("\n");
  if (lastLine[lastLine.length - 1].startsWith(siteUrl.replace(/\/$/, "") + "/")) paragraphs.pop();
  const noEnd = linked !== null && linked.endAt === undefined && endAt - startAt === DEFAULT_DURATION_MS;
  // External input must not fail the job: an end not after the start, or past the schema's 7-day offset, reads as no end.
  const endDays = (Date.parse(eventDateForInstant(endAt > startAt ? endAt : startAt, timezone)) - Date.parse(eventDate)) / 86_400_000;
  const validEnd = endAt > startAt && endDays <= MAX_END_DAY_OFFSET;
  return {
    title: linked && item.title === truncateTitle(linked.title) ? linked.title : item.title,
    eventDate, timeTba: false, timezone,
    start: local(startAt),
    end: noEnd || !validEnd ? null : local(endAt),
    summary: cutUnits(paragraphs.join("\n\n").trim(), SUMMARY_MAX).trimEnd() || null,
  };
}

export const vrchatCalendarEnabled = (): boolean => process.env.VRDEX_CONNECTOR_VRCHAT_CALENDAR_ENABLED === "true";

export function requireVrchatCalendarEnabled(): void {
  if (!vrchatCalendarEnabled()) throw new Error("CONNECTOR_KIND_DISABLED");
}

// Each method runs one step of vrchatCalendarConnector's state machine; VRChat writes go only through club operations.
export const vrchatCalendarHandler: SyncKindHandler = {
  async exportUpsert(ctx, _connector, _event, _link, job) {
    requireVrchatCalendarEnabled();
    const result = await ctx.runMutation(internal.vrchatCalendarConnector.advanceExport, { jobId: job._id });
    if (result.kind === "await") return AwaitingClubOperation;
    if (result.kind === "failed") throw new Error(result.code);
    return { externalId: result.externalId };
  },
  async exportDelete(ctx, _connector, _link, job) {
    requireVrchatCalendarEnabled();
    const result = await ctx.runMutation(internal.vrchatCalendarConnector.advanceDelete, { jobId: job._id });
    if (result.kind === "await") return AwaitingClubOperation;
    if (result.kind === "failed") throw new Error(result.code);
  },
};
