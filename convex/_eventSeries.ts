import type { Doc } from "./_generated/dataModel";
import type { SeriesRule } from "./_eventSeriesModel";

const DAY_MS = 86_400_000;
const MAX_COUNT = 520;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Calendar dates as whole UTC days since the epoch; never a local Date.
function toDay(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) return Number.NaN;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / DAY_MS : Number.NaN;
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(day: number): number {
  return new Date(day * DAY_MS).getUTCDay();
}

/** The nth (1..4) or last (-1) `weekday` of the month containing `year`/`month` (0-based). */
function monthlyWeekday(year: number, month: number, weekday: number, ordinal: number): number {
  if (ordinal === -1) {
    const last = Date.UTC(year, month + 1, 0) / DAY_MS;
    return last - ((weekdayOf(last) - weekday + 7) % 7);
  }
  const first = Date.UTC(year, month, 1) / DAY_MS;
  return first + ((weekday - weekdayOf(first) + 7) % 7) + (ordinal - 1) * 7;
}

/**
 * Occurrence dates inside the inclusive window `from..to`. Generation runs from `startsOn`
 * so the biweekly anchor and `count` do not depend on the window; `endsOn` is inclusive.
 */
export function occurrenceDates(
  series: Pick<Doc<"eventSeries">, "rule" | "startsOn" | "endsOn" | "count">,
  from: string,
  to: string,
): string[] {
  const { rule, startsOn, endsOn, count } = series;
  const start = toDay(startsOn);
  const fromDayValue = toDay(from);
  const stop = Math.min(toDay(to), endsOn === undefined ? Infinity : toDay(endsOn));
  if (![start, fromDayValue, stop].every(Number.isFinite)) return [];

  const dates: string[] = [];
  let generated = 0;
  const emit = (day: number) => {
    generated += 1;
    if (day >= fromDayValue) dates.push(fromDay(day));
  };
  const more = () => count === undefined || generated < count;

  if (rule.frequency === "monthly_weekday") {
    const anchor = new Date(start * DAY_MS);
    for (let year = anchor.getUTCFullYear(), month = anchor.getUTCMonth(); more(); month += 1) {
      const day = monthlyWeekday(year, month, rule.weekday, rule.ordinal ?? 1);
      if (day > stop) break;
      if (day >= start) emit(day);
    }
  } else {
    const step = rule.frequency === "biweekly" ? 14 : 7;
    for (let day = start + ((rule.weekday - weekdayOf(start) + 7) % 7); day <= stop && more(); day += step) {
      emit(day);
    }
  }
  return dates;
}

/** Throws on a rule, or series bounds, outside the fixed recurrence set. */
export function validateSeriesRule(
  rule: SeriesRule,
  bounds?: { startsOn: string; endsOn?: string; count?: number },
): void {
  if (!["weekly", "biweekly", "monthly_weekday"].includes(rule.frequency)) {
    throw new Error("Repeat frequency must be weekly, biweekly, or monthly_weekday.");
  }
  if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
    throw new Error("Repeat weekday must be 0 to 6.");
  }
  if (rule.frequency === "monthly_weekday") {
    if (rule.ordinal === undefined || ![1, 2, 3, 4, -1].includes(rule.ordinal)) {
      throw new Error("Monthly repeat ordinal must be 1, 2, 3, 4, or -1.");
    }
  } else if (rule.ordinal !== undefined) {
    throw new Error("Repeat ordinal applies only to monthly repeats.");
  }
  for (const time of [rule.startTime, rule.endTime, rule.doorsTime]) {
    if (time !== undefined && !TIME_PATTERN.test(time)) throw new Error("Repeat times must be HH:MM.");
  }
  if (!bounds) return;
  const start = toDay(bounds.startsOn);
  if (!Number.isFinite(start)) throw new Error("Series start date must be YYYY-MM-DD.");
  if (bounds.endsOn !== undefined && !(toDay(bounds.endsOn) >= start)) {
    throw new Error("Series end date must be a YYYY-MM-DD date on or after the start date.");
  }
  if (bounds.count !== undefined && (!Number.isInteger(bounds.count) || bounds.count < 1 || bounds.count > MAX_COUNT)) {
    throw new Error(`Repeat count must be 1 to ${MAX_COUNT}.`);
  }
}
