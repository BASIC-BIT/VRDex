import type { PlaybackStream } from "../../../../../convex/_eventPlayback";
import { resolveEventLocalTime, selectEventLocalTime, type EventIntakePatch, type EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import type { LineupTimingRow } from "./event-lineup-timing";
import { formatZonedDateTimeInput } from "./zoned-date-time";

export type SlotFormRow = {
  position?: number;
  selectedStreamId?: string;
  streamChoices?: PlaybackStream[];
  id: string;
  offsetMinutes: string;
  durationMinutes: string;
  personSlug: string;
  displayLabel: string;
  roleLabel: string;
  startAtOverride?: number;
  endAtOverride?: number;
  durationMsOverride?: number;
};

export function readStaffLineupTimings(rows: readonly SlotFormRow[], eventStartAt: number): LineupTimingRow[] {
  return rows.map(row => {
    const startAt = row.startAtOverride ?? (row.offsetMinutes.trim() && Number.isInteger(Number(row.offsetMinutes)) && Number.isFinite(eventStartAt) ? eventStartAt + Number(row.offsetMinutes) * 60_000 : undefined);
    const endAt = row.endAtOverride ?? (startAt !== undefined && row.durationMsOverride !== undefined ? startAt + row.durationMsOverride : undefined) ?? (startAt !== undefined && row.durationMinutes.trim() && Number.isInteger(Number(row.durationMinutes)) && Number(row.durationMinutes) > 0 ? startAt + Number(row.durationMinutes) * 60_000 : undefined);
    return { key: row.id, ...(startAt === undefined ? {} : { startAt }), ...(endAt === undefined ? {} : { endAt }) };
  });
}

/** Offset edits retain the exact duration even while the new offset is incomplete. */
export function changeStaffSlotOffset(row: SlotFormRow, offsetMinutes: string, eventStartAt: number): SlotFormRow {
  const timing = readStaffLineupTimings([row], eventStartAt)[0]!;
  const durationMsOverride = timing.startAt !== undefined && timing.endAt !== undefined
    ? timing.endAt - timing.startAt : row.durationMsOverride;
  return { ...row, offsetMinutes, startAtOverride: undefined, endAtOverride: undefined, durationMsOverride };
}

export function applyStaffLineupTimings(rows: readonly SlotFormRow[], timings: readonly LineupTimingRow[], eventStartAt: number): SlotFormRow[] {
  const originals = new Map(rows.map(row => [row.id, row]));
  const previous = new Map(readStaffLineupTimings(rows, eventStartAt).map(row => [row.key, row]));
  return timings.map((timing, position) => {
    const row = originals.get(timing.key) ?? { id: timing.key, offsetMinutes: "", durationMinutes: "", personSlug: "", displayLabel: "", roleLabel: "Participant" };
    const old = previous.get(timing.key);
    if (old?.startAt === timing.startAt && old?.endAt === timing.endAt) return { ...row, position };
    return { ...row, position, startAtOverride: timing.startAt, endAtOverride: timing.endAt, durationMsOverride: undefined,
      offsetMinutes: timing.startAt === undefined ? "" : String((timing.startAt - eventStartAt) / 60_000),
      durationMinutes: timing.startAt === undefined || timing.endAt === undefined ? "" : String((timing.endAt - timing.startAt) / 60_000),
    };
  });
}

export function readIntakeInstant(fields: EventIntakePatch, local: EventIntakeLocalTime | null | undefined): number | undefined {
  if (fields.timeTba || !fields.eventDate || !fields.timezone || !local) return undefined;
  try { return selectEventLocalTime(fields.eventDate, local, fields.timezone); } catch { return undefined; }
}

export function readIntakeLineupTimings(fields: EventIntakePatch): LineupTimingRow[] {
  return (fields.lineup ?? []).map(row => {
    const startAt = readIntakeInstant(fields, row.start);
    const endAt = readIntakeInstant(fields, row.end);
    return { key: row.clientKey, ...(startAt === undefined ? {} : { startAt }), ...(endAt === undefined ? {} : { endAt }) };
  });
}

/** Serialize only representable instants. Callers catch RangeError and keep the original draft. */
export function intakeLocalFromInstant(fields: EventIntakePatch, instant: number): EventIntakeLocalTime {
  if (!fields.eventDate || !fields.timezone) throw new RangeError("Event date must be valid.");
  const formatted = formatZonedDateTimeInput(instant, fields.timezone);
  const dayOffset = (Date.parse(`${formatted.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fields.eventDate}T00:00:00Z`)) / 86_400_000;
  if (!Number.isInteger(dayOffset) || dayOffset < -1 || dayOffset > 7) throw new RangeError("Event date must be valid.");
  const local = { time: formatted.slice(11, 16), dayOffset };
  const choices = resolveEventLocalTime(fields.eventDate, local, fields.timezone);
  if (!choices.includes(instant)) throw new RangeError("Event date must be valid.");
  return choices.length > 1 ? { ...local, occurrence: choices[0] === instant ? "earlier" : "later" } : local;
}

export function applyIntakeLineupTimings(fields: EventIntakePatch, timings: readonly LineupTimingRow[]): EventIntakePatch {
  const originals = new Map((fields.lineup ?? []).map(row => [row.clientKey, row]));
  const previous = new Map(readIntakeLineupTimings(fields).map(row => [row.key, row]));
  const lineup = timings.map((timing, position) => {
    const row = originals.get(timing.key) ?? { clientKey: timing.key, position };
    const old = previous.get(timing.key);
    return { ...row, position,
      ...(old?.startAt === timing.startAt ? {} : { start: timing.startAt === undefined ? null : intakeLocalFromInstant(fields, timing.startAt) }),
      ...(old?.endAt === timing.endAt ? {} : { end: timing.endAt === undefined ? null : intakeLocalFromInstant(fields, timing.endAt) }),
    };
  });
  return { ...fields, lineup };
}
