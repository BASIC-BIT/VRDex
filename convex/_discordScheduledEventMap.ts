import type { EventIntakeFields } from "../packages/api-contracts/src/event-intake";
import { cutUnits, DISCORD_ID } from "./_eventConnectors";
import { eventDateForInstant, eventLocalTimeLenient } from "./_eventSchedule";

export const SCHEDULED_EVENT_END_FALLBACK_MS = 4 * 3_600_000;
export const IMPORT_HORIZON_MS = 60 * 86_400_000;
export const RECONCILE_HORIZON_MS = 90 * 86_400_000;
export const DISCORD_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const DAY_MS = 86_400_000;
// Discord's limits: https://discord.com/developers/docs/resources/guild-scheduled-event
const NAME_MAX = 100;
const LOCATION_MAX = 100;
const DESCRIPTION_MAX = 1000;
// EventIntakeFieldsSchema's limits. carriedFieldsHash clips a venue to the same 120, so a longer owner-path venue still matches.
const TITLE_MAX = 120;
const VENUE_MAX = 120;
const SUMMARY_MAX = 240;

export type DiscordRecurrenceRule = {
  start: string; end: string | null; frequency: 0 | 1 | 2 | 3; interval: number; by_weekday: number[] | null;
  by_n_weekday: Array<{ n: 1 | 2 | 3 | 4 | 5; day: number }> | null; by_month: number[] | null; by_month_day: number[] | null; by_year_day: number[] | null; count: number | null;
};
export type DiscordScheduledEvent = {
  id: string; guild_id: string; creator_id?: string | null; name: string; description?: string | null; scheduled_start_time: string; scheduled_end_time: string | null;
  privacy_level: number; status: 1 | 2 | 3 | 4; entity_type: 1 | 2 | 3; entity_metadata: { location?: string } | null; recurrence_rule: DiscordRecurrenceRule | null;
};
export type DiscordScheduledEventBody = {
  name: string; privacy_level: 2; entity_type: 3; channel_id: null; entity_metadata: { location: string };
  scheduled_start_time: string; scheduled_end_time: string; description: string; image?: string;
};
export type ScheduledEventFieldsInput = Pick<DiscordScheduledEvent, "name" | "description" | "scheduled_start_time" | "scheduled_end_time" | "entity_metadata">;
export type ScheduledEventSource = {
  title: string; summary?: string; venueLabel?: string; worldNames: string[]; startAt?: number; endAt?: number; timezone?: string;
  status: "scheduled" | "cancelled"; url: string; artworkImageUrl?: string;
};

const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === "string" ? value : null;
const instant = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
const integers = (value: unknown) => Array.isArray(value) && value.every(Number.isInteger) ? value as number[] : null;

function parseRecurrenceRule(value: unknown): DiscordRecurrenceRule | null {
  const rule = record(value);
  const start = instant(rule?.start);
  if (!rule || !start || ![0, 1, 2, 3].includes(rule.frequency as number) || !Number.isInteger(rule.interval) || (rule.interval as number) < 1) return null;
  return {
    start, end: instant(rule.end), frequency: rule.frequency as DiscordRecurrenceRule["frequency"], interval: rule.interval as number,
    by_weekday: integers(rule.by_weekday), by_n_weekday: Array.isArray(rule.by_n_weekday) ? rule.by_n_weekday : null,
    by_month: integers(rule.by_month), by_month_day: integers(rule.by_month_day), by_year_day: integers(rule.by_year_day),
    count: Number.isInteger(rule.count) ? rule.count as number : null,
  };
}

/** The trust boundary for anything Discord or the gateway sends: past it, every field has its declared type. */
export function parseScheduledEvent(value: unknown): DiscordScheduledEvent | null {
  const item = record(value);
  const start = instant(item?.scheduled_start_time);
  if (!item || !start || typeof item.name !== "string" || ![1, 2, 3, 4].includes(item.status as number)) return null;
  if (typeof item.id !== "string" || !DISCORD_ID.test(item.id) || typeof item.guild_id !== "string" || !DISCORD_ID.test(item.guild_id)) return null;
  const recurrence_rule = item.recurrence_rule === null || item.recurrence_rule === undefined ? null : parseRecurrenceRule(item.recurrence_rule);
  if (!recurrence_rule && item.recurrence_rule !== null && item.recurrence_rule !== undefined) return null;
  const location = text(record(item.entity_metadata)?.location);
  return {
    id: item.id, guild_id: item.guild_id, creator_id: text(item.creator_id), name: item.name, description: text(item.description),
    scheduled_start_time: start, scheduled_end_time: instant(item.scheduled_end_time), privacy_level: item.privacy_level as number,
    status: item.status as DiscordScheduledEvent["status"], entity_type: item.entity_type as DiscordScheduledEvent["entity_type"],
    entity_metadata: location === null ? null : { location }, recurrence_rule,
  };
}

function fit(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${cutUnits(trimmed, max - 1).trimEnd()}…` : trimmed;
}

// The text, clipped so the URL always fits as the last line.
function describe(text: string, url: string): string {
  const urlLine = `\n\n${url}`;
  const clipped = fit(text, DESCRIPTION_MAX - urlLine.length);
  return clipped ? `${clipped}${urlLine}` : url;
}

export function toScheduledEventBody(source: ScheduledEventSource & { startAt: number }, image?: string): DiscordScheduledEventBody {
  return {
    name: fit(source.title, NAME_MAX), privacy_level: 2, entity_type: 3, channel_id: null,
    entity_metadata: { location: fit(source.worldNames.join(", ") || source.venueLabel || source.url, LOCATION_MAX) },
    scheduled_start_time: new Date(source.startAt).toISOString(),
    scheduled_end_time: new Date(source.endAt ?? source.startAt + SCHEDULED_EVENT_END_FALLBACK_MS).toISOString(),
    description: describe(source.summary ?? "", source.url),
    ...(image ? { image } : {}),
  };
}

const read = (value: string | null | undefined, max: number) => cutUnits(value?.trim() ?? "", max).trim() || null;
const sameText = (inbound: string | null | undefined, written: string | undefined) => written !== undefined && inbound?.trim() === written.trim();
// The staff patch collapses a summary's whitespace and intake publish keeps it raw, so a linked description reads as the summary either way.
const collapsed = (value: string | null) => value?.replace(/\s+/g, " ") ?? null;
const sameSummary = (text: string | null | undefined, summary: string | undefined) => collapsed(read(text, SUMMARY_MAX)) === collapsed(read(summary, SUMMARY_MAX));

// The description as VRDex's summary, minus the event's own URL line.
function withoutUrlLine(description: string | null | undefined, url: string): string | null | undefined {
  const lines = description?.trimEnd().split("\n") ?? [];
  return lines[lines.length - 1]?.trim() === url ? lines.slice(0, -1).join("\n") : description;
}

/**
 * The PATCH for a live Discord event. VRDex's summary cap must not cost an organiser their description: where the live text
 * reads back as this summary it stays, and only a missing URL line is added. Its echo reads back the same way, so it hashes equal.
 */
export function patchKeepingDescription(body: DiscordScheduledEventBody, live: string | null, source: Pick<ScheduledEventSource, "summary" | "url">): Omit<DiscordScheduledEventBody, "description"> & { description?: string } {
  const plain = withoutUrlLine(live, source.url);
  if (!sameSummary(plain, source.summary)) return body;
  const { description: _description, ...kept } = body;
  return plain === live ? { ...kept, description: describe(live ?? "", source.url) } : kept;
}

/**
 * Discord's copy as intake fields, with the keys and shape correctionFields hashes. A value that equals what the export
 * writes takes the linked event's own instead, so clipping and the fallbacks never flow back: an unchanged echo reads as
 * the event itself, and a one-field Discord edit changes only that field.
 */
export function scheduledEventToFields(item: ScheduledEventFieldsInput, linked: ScheduledEventSource | null): EventIntakeFields {
  // A date-only event has no export to compare with.
  const written = linked?.startAt === undefined ? null : toScheduledEventBody({ ...linked, startAt: linked.startAt });
  const timezone = linked?.timezone ?? "UTC";
  const description = linked ? withoutUrlLine(item.description, linked.url) : item.description;
  const startAt = Date.parse(item.scheduled_start_time);
  const endAt = item.scheduled_end_time ? Date.parse(item.scheduled_end_time) : null;
  const eventDate = eventDateForInstant(startAt, timezone);
  // Discord moves the fallback end along with the start, so the span counts as well as the written instant.
  const fallbackEnd = linked !== null && linked.endAt === undefined
    && (endAt === Date.parse(written?.scheduled_end_time ?? "") || endAt === startAt + SCHEDULED_EVENT_END_FALLBACK_MS);
  return {
    title: read(sameText(item.name, written?.name) ? linked?.title : item.name, TITLE_MAX),
    eventDate, timezone,
    start: eventLocalTimeLenient(startAt, eventDate, timezone),
    end: endAt === null || fallbackEnd ? null : eventLocalTimeLenient(endAt, eventDate, timezone),
    summary: read(linked && (sameText(item.description, written?.description) || sameSummary(description, linked.summary)) ? linked.summary : description, SUMMARY_MAX),
    venueLabel: read(sameText(item.entity_metadata?.location, written?.entity_metadata.location) ? linked?.venueLabel : item.entity_metadata?.location, VENUE_MAX),
  };
}

// candidateFromConnectorFields marks every given key explicit and an explicit null clears a value, so absent fields stay out.
// timezone stays: it is in the carried hash, and on a linked event it is the zone the map read in, so a patch cannot move it.
// ponytail: a candidate time is HH:MM, so a fall-back-hour echo loses occurrence and misses lastExportedHash; a linked import compares the map's own fields against correctionFields first, which keeps it.
export function scheduledEventCandidateFields(fields: EventIntakeFields): Partial<EventIntakeFields> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
}

// Discord's weekdays start at Monday 0.
function recursOn(rule: DiscordRecurrenceRule, at: number, first: number): boolean {
  const night = new Date(at);
  const weekday = (night.getUTCDay() + 6) % 7;
  switch (rule.frequency) {
    case 3: return rule.by_weekday?.includes(weekday) ?? true;
    case 2: return (at - first) % (7 * rule.interval * DAY_MS) === 0;
    case 1: {
      const nth = rule.by_n_weekday?.[0];
      return nth?.day === weekday && Math.ceil(night.getUTCDate() / 7) === nth.n;
    }
    case 0: return night.getUTCMonth() + 1 === rule.by_month?.[0] && night.getUTCDate() === rule.by_month_day?.[0]
      && (night.getUTCFullYear() - new Date(first).getUTCFullYear()) % rule.interval === 0;
  }
}

// ponytail: UTC stepping drifts an hour across DST for zones Discord shows locally; plan 11 replaces expansion with series import.
export function scheduledEventOccurrences(item: DiscordScheduledEvent, now: number, horizonMs = IMPORT_HORIZON_MS): Array<{ externalId: string; externalSeriesId?: string; startAt: number; endAt: number | null }> {
  const itemStart = Date.parse(item.scheduled_start_time);
  const duration = item.scheduled_end_time ? Date.parse(item.scheduled_end_time) - itemStart : null;
  const endOf = (startAt: number) => duration === null ? null : startAt + duration;
  const rule = item.recurrence_rule;
  if (!rule) return [{ externalId: item.id, startAt: itemStart, endAt: endOf(itemStart) }];
  const first = Date.parse(rule.start);
  const horizon = now + horizonMs;
  const last = Math.min(horizon, rule.end ? Date.parse(rule.end) : horizon);
  const nights: ReturnType<typeof scheduledEventOccurrences> = [];
  let seen = 0;
  // Every rule walks the calendar a day at a time, so a month or year without the rule's day needs no special case.
  for (let startAt = first; startAt <= last && (rule.count === null || seen < rule.count); startAt += DAY_MS) {
    if (!recursOn(rule, startAt, first)) continue;
    seen++; // count runs from the rule's start, so past nights use it up.
    if (startAt > now && startAt < horizon) nights.push({ externalId: `${item.id}:${new Date(startAt).toISOString().slice(0, 10)}`, externalSeriesId: item.id, startAt, endAt: endOf(startAt) });
  }
  return nights;
}
