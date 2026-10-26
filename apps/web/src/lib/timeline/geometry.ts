import type { TimelineRange, TimelineSchedule } from "../../../../../convex/_eventTimelineTypes";
import { formatCalendarDate, formatZonedDateTimeInput, parseZonedDateTimeInput } from "../calendar/zoned-date-time";

const HOUR_MS = 3_600_000;
type Scale = { origin: number; pixelsPerHour: number };
export type ScheduleGeometry =
  | { kind: "bar"; x: number; width: number }
  | { kind: "marker"; x: number }
  | { kind: "untimed"; eventDate: string };

export function timeToX({ instant, origin, pixelsPerHour }: Scale & { instant: number }): number {
  return ((instant - origin) / HOUR_MS) * pixelsPerHour;
}

export function scheduleGeometry({ schedule, ...scale }: Scale & { schedule: TimelineSchedule }): ScheduleGeometry | null {
  if (schedule.kind === "date_only") return { kind: "untimed", eventDate: schedule.eventDate };
  if (!Number.isFinite(schedule.startAt)) return null;
  const x = timeToX({ instant: schedule.startAt, ...scale });
  if (schedule.kind === "timed" && Number.isFinite(schedule.endAt) && schedule.endAt > schedule.startAt) {
    return { kind: "bar", x, width: timeToX({ instant: schedule.endAt, ...scale }) - x };
  }
  return { kind: "marker", x };
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function localDayStart(date: string, timeZone: string): number {
  try {
    return parseZonedDateTimeInput(`${date}T00:00`, timeZone, "Day start");
  } catch {
    // Midnight, or an entire date, can be skipped. Find the first real instant
    // at or after this local date within a bounded bracket around UTC midnight.
    const nominal = Date.parse(`${date}T00:00:00Z`);
    let before = nominal - 36 * HOUR_MS;
    let after = nominal + 36 * HOUR_MS;
    while (after - before > 1) {
      const middle = before + Math.floor((after - before) / 2);
      if (formatZonedDateTimeInput(middle, timeZone).slice(0, 10) < date) before = middle;
      else after = middle;
    }
    return after;
  }
}

/** Full local days intersecting the half-open range. Day widths may be 23 or 25 hours. */
export function localDayBands({ startAt, endAt, timeZone }: TimelineRange): Array<{ startAt: number; endAt: number; label: string }> {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return [];
  const bands = [];
  let date = formatZonedDateTimeInput(startAt, timeZone).slice(0, 10);
  let dayStart = localDayStart(date, timeZone);
  while (dayStart < endAt) {
    const followingDate = nextDate(date);
    const dayEnd = localDayStart(followingDate, timeZone);
    bands.push({ startAt: dayStart, endAt: dayEnd, label: formatCalendarDate(date) });
    date = formatZonedDateTimeInput(dayEnd, timeZone).slice(0, 10);
    dayStart = dayEnd;
  }
  return bands;
}
