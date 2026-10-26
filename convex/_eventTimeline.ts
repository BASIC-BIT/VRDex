import type { Doc } from "./_generated/dataModel";
import type { DatabaseReader } from "./_generated/server";
import { eventPathForSlugs } from "./_eventPaths";
import { getPublishedCommunity, getPublicEventCommunityImage, isPublicEventPerformer } from "./_eventPublic";
import { eventDateForInstant } from "./_eventSchedule";
import type { TimelineEventIdentity, TimelineRange, TimelineSchedule, TimelineSlot } from "./_eventTimelineTypes";

export function validateTimelineRange(range: TimelineRange): void {
  if (!Number.isFinite(range.startAt) || !Number.isFinite(range.endAt) || range.endAt <= range.startAt ||
      range.endAt - range.startAt > 7 * 24 * 3_600_000 ||
      !Number.isFinite(new Date(range.startAt).getTime()) || !Number.isFinite(new Date(range.endAt).getTime())) {
    throw new Error("Invalid timeline range");
  }
  if (/^[+-]/.test(range.timeZone)) throw new Error("Invalid timeline timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: range.timeZone }).format(range.startAt); }
  catch { throw new Error("Invalid timeline timezone"); }
}

export function timelineLimit(limit = 8): number {
  if (!Number.isSafeInteger(limit)) throw new Error("Invalid timeline limit");
  return Math.max(1, Math.min(50, limit));
}

export type EventPhase = "starts" | "ongoing" | "dates";
export type RosterPhase = "slots" | "lineup" | "participants";
type Phase = EventPhase | RosterPhase;
type Cursor<P extends Phase> = { phase: P; databaseCursor: string | null };

function rangeScope(range: TimelineRange) { return [range.startAt, range.endAt, range.timeZone]; }
export function encodeTimelineCursor<P extends Phase>(scope: string, range: TimelineRange, cursor: Cursor<P>): string {
  return JSON.stringify({ version: 1, scope, range: rangeScope(range), ...cursor });
}
export function readTimelineCursor<P extends Phase>(raw: string | undefined, scope: string, range: TimelineRange, phases: readonly P[], initial: P): Cursor<P> {
  if (raw === undefined) return { phase: initial, databaseCursor: null };
  try {
    if (raw.length > 16_384) throw new Error();
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
        !("scope" in value) || value.scope !== scope || !("range" in value) ||
        JSON.stringify(value.range) !== JSON.stringify(rangeScope(range)) || !("phase" in value) ||
        !("databaseCursor" in value) || (value.databaseCursor !== null && typeof value.databaseCursor !== "string")) throw new Error();
    const phase = phases.find(candidate => candidate === value.phase);
    if (phase === undefined || value.databaseCursor === "") throw new Error();
    return { phase, databaseCursor: value.databaseCursor };
  } catch { throw new Error("Invalid timeline cursor"); }
}

export function timelineSchedule(event: Doc<"events">): TimelineSchedule | null {
  if (event.scheduleKind === "date_only") return event.eventDate === undefined ? null : { kind: "date_only", eventDate: event.eventDate };
  if (event.startAt === undefined) return null;
  return authoredTimedSchedule(event);
}
function authoredTimedSchedule(record: { startAt?: number; endAt?: number }): TimelineSlot["schedule"] | null {
  if (record.startAt === undefined) return null;
  return record.endAt === undefined
    ? { kind: "open_end", startAt: record.startAt }
    : { kind: "timed", startAt: record.startAt, endAt: record.endAt };
}
export function timelineDateBounds(range: TimelineRange) {
  return { first: eventDateForInstant(range.startAt, range.timeZone), last: eventDateForInstant(Math.ceil(range.endAt) - 1, range.timeZone) };
}
export function overlapsTimeline(schedule: TimelineSchedule, range: TimelineRange): boolean {
  switch (schedule.kind) {
    case "timed": return schedule.startAt < range.endAt && schedule.endAt > range.startAt;
    case "open_end": return schedule.startAt >= range.startAt && schedule.startAt < range.endAt;
    case "date_only": {
      const { first, last } = timelineDateBounds(range);
      return schedule.eventDate >= first && schedule.eventDate <= last;
    }
  }
}
export async function timelineEventIdentity(db: DatabaseReader, event: Doc<"events">, options: { includeCancelled?: boolean; includeHostImage?: boolean } = {}): Promise<TimelineEventIdentity | null> {
  if (event.publicationState !== "published" || event.slug === undefined ||
      (event.eventStatus !== "scheduled" && !(options.includeCancelled && event.eventStatus === "cancelled"))) return null;
  const schedule = timelineSchedule(event);
  if (schedule === null) return null;
  const community = await getPublishedCommunity(db, event);
  if (event.communityProfileId !== undefined && community === undefined) return null;
  const host = community === undefined ? undefined : {
    id: community._id, slug: community.slug, displayName: community.displayName,
    ...(options.includeHostImage === false ? {} : { imageUrl: await getPublicEventCommunityImage(db, community) }),
  };
  return {
    id: event._id, slug: event.slug, title: event.title, status: event.eventStatus, schedule,
    ...(host === undefined ? {} : { host, href: eventPathForSlugs(host.slug, event.slug) }),
    ...(event.communityName === undefined ? {} : { communityName: event.communityName }),
  };
}
export async function timelinePerformer(db: DatabaseReader, personId: Doc<"eventSlots">["personProfileId"]) {
  if (personId === undefined) return undefined;
  const profile = await db.get(personId);
  if (!isPublicEventPerformer(profile)) return undefined;
  return { id: profile._id, slug: profile.slug, displayName: profile.displayName };
}
export async function timelineSlot(db: DatabaseReader, slot: Doc<"eventSlots">): Promise<TimelineSlot | null> {
  if (slot.reviewState !== "confirmed") return null;
  const schedule = authoredTimedSchedule(slot);
  if (schedule === null) return null;
  const performer = await timelinePerformer(db, slot.personProfileId);
  return {
    id: slot._id, eventId: slot.eventId, schedule,
    displayLabel: /^Session \d+$/.test(slot.displayLabel) ? performer?.displayName ?? `Slot ${slot.position + 1}` : slot.displayLabel,
    ...(performer === undefined ? {} : { performer }),
  };
}
