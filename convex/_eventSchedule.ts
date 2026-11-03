import { timedEventRuntimeEndAt } from "./_eventRuntime";
import { resolveEventLocalTime, type EventIntakeLocalTime } from "../packages/api-contracts/src/event-intake";

export type EventSchedule =
  | { kind: "timed"; startAt: number; date: string; timeZone?: string }
  | { kind: "date_only"; date: string };

export type StoredEventSchedule = {
  scheduleKind?: "timed" | "date_only";
  eventDate?: string;
  startAt?: number;
  endAt?: number;
  timezone?: string;
  sortAt?: number;
};

export function normalizeEventSchedule(input: EventSchedule): {
  startAt?: number; eventDate: string; scheduleKind: "timed" | "date_only"; sortAt: number;
} {
  const dateValue = Date.parse(`${input.date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(dateValue) ||
      new Date(dateValue).toISOString().slice(0, 10) !== input.date) {
    throw new Error("Event date must be a valid calendar date.");
  }
  if (input.kind === "date_only") {
    return { scheduleKind: "date_only", eventDate: input.date, sortAt: dateValue };
  }
  if (!Number.isSafeInteger(input.startAt) || input.startAt < 0 || !Number.isFinite(new Date(input.startAt).getTime())) {
    throw new Error("Event start time must be a valid timestamp.");
  }
  if (input.timeZone !== undefined && eventDateForInstant(input.startAt, input.timeZone) !== input.date) {
    throw new Error("Event date must match its start time and time zone.");
  }
  return { scheduleKind: "timed", eventDate: input.date, sortAt: input.startAt, startAt: input.startAt };
}

export function eventDateForInstant(startAt: number, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(startAt);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// An instant's local clock relative to the event date, in the event intake shape.
export function eventLocalTime(instant: number, date: string, timeZone: string): EventIntakeLocalTime {
  const localDate = eventDateForInstant(instant, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  const value: EventIntakeLocalTime = { time, dayOffset: (Date.parse(localDate) - Date.parse(date)) / 86_400_000 };
  const choices = resolveEventLocalTime(date, value, timeZone);
  if (choices.length > 1) value.occurrence = choices[0] === instant ? "earlier" : "later";
  return value;
}

// eventLocalTime for external input: a zero dayOffset drops, and what it would throw on stays for the caller's schema check.
// Mirrors correctionFields, occurrence included, so a fall-back-hour echo hashes the same as the export.
export function eventLocalTimeLenient(instant: number, date: string, timeZone: string): EventIntakeLocalTime {
  const dayOffset = (Date.parse(eventDateForInstant(instant, timeZone)) - Date.parse(date)) / 86_400_000;
  const value: EventIntakeLocalTime = {
    time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant),
    ...(dayOffset ? { dayOffset } : {}),
  };
  let choices: number[] = [];
  try {
    choices = resolveEventLocalTime(date, value, timeZone);
  } catch {
    // An offset zone or an out-of-range dayOffset.
  }
  if (choices.length > 1) value.occurrence = choices[0] === instant ? "earlier" : "later";
  return value;
}

export function readEventSchedule(event: StoredEventSchedule) {
  if (event.scheduleKind === "date_only") return normalizeEventSchedule({ kind: "date_only", date: event.eventDate ?? "" });
  if (event.startAt === undefined) throw new Error("Timed event requires a start time.");
  return normalizeEventSchedule({ kind: "timed", startAt: event.startAt,
    date: event.eventDate ?? eventDateForInstant(event.startAt, event.timezone), timeZone: event.timezone });
}

// These numeric values are for indexing and ordering only, never public start instants.
export function eventSortAt(event: StoredEventSchedule): number {
  return event.sortAt ?? readEventSchedule(event).sortAt;
}

export function eventSortEndAt(event: StoredEventSchedule): number {
  // Keep the authored date upcoming until that date has ended everywhere (UTC-12).
  return event.scheduleKind === "date_only" ? eventSortAt(event) + 36 * 60 * 60 * 1000 - 1
    : timedEventRuntimeEndAt({ startAt: event.startAt ?? eventSortAt(event), endAt: event.endAt });
}

export function publicEventSchedule(event: StoredEventSchedule) {
  const { sortAt: _sortAt, ...schedule } = readEventSchedule(event);
  return schedule;
}

// Enable only after the schedule migration reports completion and indexes are deployed.
export function dateOnlyEventsEnabled(): boolean {
  return process.env.EVENT_DATE_ONLY_ENABLED === "true";
}

export function requireDateOnlyEventsEnabled(): void {
  if (!dateOnlyEventsEnabled()) throw new Error("Date-only event publication is not enabled.");
}
