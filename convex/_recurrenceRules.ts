import { resolveEventLocalTime } from "../packages/api-contracts/src/event-intake";
import type { DiscordRecurrenceRule } from "./_discordScheduledEventMap";
import { eventDateForInstant } from "./_eventSchedule";
import { SERIES_MAX_COUNT, type SeriesRule } from "./_eventSeriesModel";

/** The first night of a series in its own wall clock: an external rule carries no times, so they come from here. */
export type RecurrenceAnchor = { date: string; timezone: string; startTime: string; endTime?: string };
export type ParsedRecurrence = { rule: SeriesRule; startsOn: string; endsOn?: string; count?: number };
/** The part of a Discord recurrence rule a client may write; Discord sets `end`, `count`, and `by_year_day` itself. */
export type DiscordRecurrenceWrite = Pick<DiscordRecurrenceRule, "start" | "frequency" | "interval" | "by_weekday" | "by_n_weekday" | "by_month" | "by_month_day">;

type RuleShape = Pick<SeriesRule, "frequency" | "weekday" | "ordinal">;

// RRULE day codes, indexed by VRDex's weekday (0 Sunday).
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const GOOGLE_KEYS = ["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"];
const ORDINALS = [1, 2, 3, 4];

const weekdayOf = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();
const validDate = (date: string) => {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
};
const validCount = (count: number) => Number.isInteger(count) && count >= 1 && count <= SERIES_MAX_COUNT;

// Absent bounds and times stay absent keys: callers compare and store these whole.
function parsed(shape: RuleShape, anchor: RecurrenceAnchor, endsOn: string | undefined, count: number | undefined): ParsedRecurrence {
  const rule: SeriesRule = { frequency: shape.frequency, weekday: shape.weekday, ...(shape.ordinal === undefined ? {} : { ordinal: shape.ordinal }), startTime: anchor.startTime, ...(anchor.endTime === undefined ? {} : { endTime: anchor.endTime }) };
  return { rule, startsOn: anchor.date, ...(endsOn === undefined ? {} : { endsOn }), ...(count === undefined ? {} : { count }) };
}

// UNTIL's date form is the last date itself; its UTC form is the instant the last night's day ends, read in the anchor's zone.
function untilDate(until: string, timezone: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(until);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!match[4]) return validDate(date) ? date : null;
  const ms = Date.parse(`${date}T${match[4]}:${match[5]}:${match[6]}.000Z`);
  return Number.isFinite(ms) ? eventDateForInstant(ms, timezone) : null;
}

/** A Google `recurrence` as a series rule, or null when it is outside the fixed set (including any EXDATE or second rule). */
export function parseGoogleRecurrence(recurrence: string[], anchor: RecurrenceAnchor): ParsedRecurrence | null {
  const [line, ...rest] = recurrence;
  if (!line?.startsWith("RRULE:") || rest.length) return null;
  const parts = line.slice("RRULE:".length).split(";").map((part) => part.split("="));
  const values = new Map(parts.map(([key, value]) => [key!, value]));
  if (values.size !== parts.length || [...values].some(([key, value]) => !GOOGLE_KEYS.includes(key) || !value)) return null;

  const interval = values.get("INTERVAL") ?? "1";
  const byday = values.get("BYDAY");
  let shape: RuleShape;
  if (values.get("FREQ") === "WEEKLY" && (interval === "1" || interval === "2")) {
    const weekday = byday === undefined ? weekdayOf(anchor.date) : DAY_CODES.indexOf(byday);
    if (weekday < 0) return null;
    shape = { frequency: interval === "2" ? "biweekly" : "weekly", weekday };
  } else if (values.get("FREQ") === "MONTHLY" && interval === "1") {
    const match = /^(-1|[1-4])([A-Z]{2})$/.exec(byday ?? "");
    const weekday = match ? DAY_CODES.indexOf(match[2]!) : -1;
    if (weekday < 0) return null;
    shape = { frequency: "monthly_weekday", weekday, ordinal: Number(match![1]) as 1 | 2 | 3 | 4 | -1 };
  } else return null;

  const until = values.get("UNTIL");
  const endsOn = until === undefined ? undefined : untilDate(until, anchor.timezone);
  const count = values.has("COUNT") ? Number(values.get("COUNT")) : undefined;
  if (endsOn === null || (count !== undefined && !validCount(count))) return null;
  return parsed(shape, anchor, endsOn, count);
}

/** A Discord `recurrence_rule` as a series rule, or null when it is outside the fixed set. */
export function parseDiscordRecurrence(rule: DiscordRecurrenceWrite & Partial<DiscordRecurrenceRule>, anchor: RecurrenceAnchor): ParsedRecurrence | null {
  if (rule.by_month?.length || rule.by_month_day?.length || rule.by_year_day?.length) return null;
  // Plan 07 reads Discord's weekdays in UTC, so a US-evening `start` names the next day: the night's weekday is the anchor's (B12).
  const weekday = weekdayOf(anchor.date);
  let shape: RuleShape;
  if (rule.frequency === 2 && (rule.interval === 1 || rule.interval === 2) && rule.by_weekday?.length === 1 && !rule.by_n_weekday?.length) {
    shape = { frequency: rule.interval === 2 ? "biweekly" : "weekly", weekday };
  } else if (rule.frequency === 1 && rule.interval === 1 && rule.by_n_weekday?.length === 1 && !rule.by_weekday?.length) {
    const n = rule.by_n_weekday[0]?.n;
    if (!ORDINALS.includes(n as number)) return null;
    shape = { frequency: "monthly_weekday", weekday, ordinal: n as 1 | 2 | 3 | 4 };
  } else return null;

  const endsOn = rule.end ? eventDateForInstant(Date.parse(rule.end), anchor.timezone) : undefined;
  const count = rule.count ?? undefined;
  if (count !== undefined && !validCount(count)) return null;
  return parsed(shape, anchor, endsOn, count);
}

// The UTC instant `endsOn` ends in `timezone`. A spring-forward hour at 23:00 ends the day at 22:59:59; a repeated 23:00 hour ends on the later pass.
function untilStamp(endsOn: string, timezone: string): string {
  const lastMinute = resolveEventLocalTime(endsOn, { time: "23:59" }, timezone).pop() ?? resolveEventLocalTime(endsOn, { time: "22:59" }, timezone).pop()!;
  return new Date(lastMinute + 59_000).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/** The RRULE Google emits for a series. RFC 5545 forbids UNTIL with COUNT; a series with both was ended, so UNTIL wins. */
export function formatGoogleRecurrence(rule: SeriesRule, endsOn?: string, count?: number, timezone = "UTC"): string[] {
  const day = DAY_CODES[rule.weekday];
  const parts = rule.frequency === "monthly_weekday"
    ? ["FREQ=MONTHLY", `BYDAY=${rule.ordinal}${day}`]
    : ["FREQ=WEEKLY", ...(rule.frequency === "biweekly" ? ["INTERVAL=2"] : []), `BYDAY=${day}`];
  if (endsOn !== undefined) parts.push(`UNTIL=${untilStamp(endsOn, timezone)}`);
  else if (count !== undefined) parts.push(`COUNT=${count}`);
  return [`RRULE:${parts.join(";")}`];
}

/** The `recurrence_rule` to write for a series, or null for the last weekday, which Discord cannot express. */
export function formatDiscordRecurrence(rule: SeriesRule, start: string): DiscordRecurrenceWrite | null {
  // Discord's weekdays start at Monday 0.
  const day = (rule.weekday + 6) % 7;
  const none = { by_month: null, by_month_day: null };
  if (rule.frequency !== "monthly_weekday") {
    return { start, frequency: 2, interval: rule.frequency === "biweekly" ? 2 : 1, by_weekday: [day], by_n_weekday: null, ...none };
  }
  if (rule.ordinal === undefined || rule.ordinal === -1) return null;
  return { start, frequency: 1, interval: 1, by_weekday: null, by_n_weekday: [{ n: rule.ordinal, day }], ...none };
}
