import { formatCalendarDate, formatZonedDateTimeInput } from "./zoned-date-time";

/** Compact authoring times retain dates at day changes and exact stored precision. */
export function formatLineupTimeRange({ startAt, endAt, timezone, eventDate }: { startAt?: number; endAt?: number; timezone: string; eventDate?: string | null }): string {
  const instants = [startAt, endAt].filter((at): at is number => at !== undefined);
  if (!instants.length) return "";
  const values = instants.map(at => ({ at, local: formatZonedDateTimeInput(at, timezone) }));
  const showDates = values.some(({ local }) => local.slice(0, 10) !== (eventDate ?? values[0].local.slice(0, 10)));
  const range = values.map(({ at, local }) => {
    let time = local.slice(11);
    if (at % 60_000 !== 0) {
      const date = new Date(at);
      time += `:${String(date.getUTCSeconds()).padStart(2, "0")}`;
      if (date.getUTCMilliseconds()) time += `.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
    }
    return showDates ? `${formatCalendarDate(local.slice(0, 10))} ${time}` : time;
  }).join(" - ");
  return `${range} · ${timezone}`;
}
