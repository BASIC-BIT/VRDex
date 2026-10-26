import { EventIntakeLocalTimeSchema, resolveEventLocalTime, type EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";

const calendarDayMs = 86_400_000;
function calendarDay(date: string): number {
  // Reuse contract calendar validation. UTC is only used to count calendar days.
  resolveEventLocalTime(date, { time: "00:00" }, "UTC");
  return Date.parse(`${date}T00:00:00Z`);
}

export function eventLocalDate(date?: string | null, value?: EventIntakeLocalTime | null): string {
  if (!date) return "";
  try { return new Date(calendarDay(date) + (value?.dayOffset ?? 0) * calendarDayMs).toISOString().slice(0, 10); }
  catch { return ""; }
}

export function formatIntakeDateTimeInput({ eventDate, local }: { eventDate?: string | null; local?: EventIntakeLocalTime | null }): string {
  const date = eventLocalDate(eventDate, local);
  return date && local ? `${date}T${local.time}` : "";
}

export function parseIntakeDateTimeInput({ value, eventDate, eventStart }: { value: string; eventDate?: string | null; eventStart: boolean }): { eventDate: string | null; local: EventIntakeLocalTime | null } {
  if (!value || !value.includes("T") || value.endsWith("T")) return { eventDate: eventDate ?? null, local: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Event date must be valid.");
  const date = value.slice(0, 10);
  const day = calendarDay(date);
  const baseDate = eventStart ? date : eventDate;
  if (!baseDate) throw new Error("Event date must be valid.");
  const local = EventIntakeLocalTimeSchema.parse({ time: value.slice(11), dayOffset: (day - calendarDay(baseDate)) / calendarDayMs });
  return { eventDate: baseDate, local };
}
