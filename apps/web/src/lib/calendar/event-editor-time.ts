import {
  resolveEventLocalTime,
  selectEventLocalTime,
  type EventIntakeLocalTime,
  type EventIntakePatch,
} from "../../../../../packages/api-contracts/src/event-intake";
import { formatZonedDateTimeInput } from "./zoned-date-time";

export type EditorTimeResolution =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "gap" }
  | { kind: "ambiguous"; instants: readonly number[] }
  | { kind: "resolved"; instant: number };

export function resolveEditorTime({ value, timezone, occurrence }: {
  value: string;
  timezone: string;
  occurrence?: EventIntakeLocalTime["occurrence"];
}): EditorTimeResolution {
  if (value === "") return { kind: "empty" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return { kind: "invalid" };
  const date = value.slice(0, 10);
  const local: EventIntakeLocalTime = { time: value.slice(11), ...(occurrence ? { occurrence } : {}) };
  try {
    const instants = resolveEventLocalTime(date, local, timezone);
    if (instants.length === 0) return { kind: "gap" };
    if (instants.length > 1 && !occurrence) return { kind: "ambiguous", instants };
    return { kind: "resolved", instant: selectEventLocalTime(date, local, timezone) };
  } catch {
    return { kind: "invalid" };
  }
}

/** A minute-precision view only. Keep the original instant until the clock is edited. */
export function projectEditorTime({ instant, timezone }: {
  instant: number;
  timezone: string;
}): { value: string; occurrence?: EventIntakeLocalTime["occurrence"] } {
  const value = formatZonedDateTimeInput(instant, timezone);
  const resolution = resolveEditorTime({ value, timezone });
  if (resolution.kind !== "ambiguous") return { value };
  const minuteInstant = Math.floor(instant / 60_000) * 60_000;
  return { value, occurrence: resolution.instants[0] === minuteInstant ? "earlier" : "later" };
}

export function readIntakeEditorClock({ fields, local }: {
  fields: EventIntakePatch;
  local: EventIntakeLocalTime | null | undefined;
}):
  | { kind: "empty" }
  | { kind: "resolved"; instant: number }
  | { kind: "unresolved"; date: EventIntakePatch["eventDate"]; timezone: EventIntakePatch["timezone"]; local: EventIntakeLocalTime } {
  if (!local || fields.timeTba) return { kind: "empty" };
  if (fields.eventDate && fields.timezone) {
    try {
      return { kind: "resolved", instant: selectEventLocalTime(fields.eventDate, local, fields.timezone) };
    } catch { /* Keep the source clock and its context unresolved. */ }
  }
  return { kind: "unresolved", date: fields.eventDate, timezone: fields.timezone, local };
}
