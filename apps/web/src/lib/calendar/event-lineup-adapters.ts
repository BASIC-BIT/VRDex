import type { BroadcastInputRef, BroadcastInputChoice } from "../../../../../convex/_eventBroadcastSources";
import type { PlaybackStream } from "../../../../../convex/_eventPlayback";
import { resolveEventLocalTime, type EventIntakePatch, type EventIntakeLocalTime } from "../../../../../packages/api-contracts/src/event-intake";
import { readIntakeEditorClock } from "./event-editor-time";
import type { LineupTimingRow } from "./event-lineup-timing";
import { formatZonedDateTimeInput } from "./zoned-date-time";

export type SlotFormRow = {
  position?: number;
  selectedStreamId?: string;
  broadcastInput?: BroadcastInputRef | null;
  broadcastInputChoices?: BroadcastInputChoice[];
  streamChoices?: PlaybackStream[];
  id: string;
  offsetMinutes: string;
  durationMinutes: string;
  personSlug: string;
  displayLabel: string;
  roleLabel: string;
  startAtOverride?: number;
  offsetMsOverride?: number;
  endAtOverride?: number;
  durationMsOverride?: number;
};

export type UntimedFormRow = {
  clientKey: string;
  position: number;
  performerLabel: string;
  personSlug: string;
  roleLabel: string;
  broadcastInput?: BroadcastInputRef | null;
  broadcastInputChoices?: BroadcastInputChoice[];
};

export function timeUntimedLineupRow({ row, offsetMinutes, eventStartAt }: {
  row: UntimedFormRow; offsetMinutes: string; eventStartAt: number;
}): SlotFormRow {
  return { id: row.clientKey, position: row.position, personSlug: row.personSlug,
    displayLabel: row.performerLabel, roleLabel: row.roleLabel, offsetMinutes,
    ...(row.broadcastInput === undefined ? {} : { broadcastInput: row.broadcastInput }),
    broadcastInputChoices: row.broadcastInputChoices,
    durationMinutes: "", startAtOverride: eventStartAt + Number(offsetMinutes) * 60_000 };
}

export function readStaffLineupTimings(rows: readonly SlotFormRow[], eventStartAt: number): LineupTimingRow[] {
  return rows.map(row => {
    const offsetMs = row.offsetMsOverride ?? (row.offsetMinutes.trim() && Number.isInteger(Number(row.offsetMinutes)) ? Number(row.offsetMinutes) * 60_000 : undefined);
    const startAt = row.startAtOverride ?? (offsetMs === undefined ? undefined : (Number.isFinite(eventStartAt) ? eventStartAt : 0) + offsetMs);
    const endAt = row.endAtOverride ?? (startAt !== undefined && row.durationMsOverride !== undefined ? startAt + row.durationMsOverride : undefined) ?? (startAt !== undefined && row.durationMinutes.trim() && Number.isInteger(Number(row.durationMinutes)) && Number(row.durationMinutes) > 0 ? startAt + Number(row.durationMinutes) * 60_000 : undefined);
    return { key: row.id, ...(startAt === undefined ? {} : { startAt }), ...(endAt === undefined ? {} : { endAt }) };
  });
}

/** Offset edits retain the exact duration even while the new offset is incomplete. */
export function changeStaffSlotOffset(row: SlotFormRow, offsetMinutes: string, eventStartAt: number): SlotFormRow {
  const timing = readStaffLineupTimings([row], eventStartAt)[0]!;
  const durationMsOverride = timing.startAt !== undefined && timing.endAt !== undefined
    ? timing.endAt - timing.startAt : row.durationMsOverride;
  return { ...row, offsetMinutes, offsetMsOverride: undefined, startAtOverride: undefined, endAtOverride: undefined, durationMsOverride };
}

export function applyStaffLineupTimings(rows: readonly SlotFormRow[], timings: readonly LineupTimingRow[], eventStartAt: number): SlotFormRow[] {
  const originals = new Map(rows.map(row => [row.id, row]));
  const previous = new Map(readStaffLineupTimings(rows, eventStartAt).map(row => [row.key, row]));
  return timings.map((timing, position) => {
    const row = originals.get(timing.key) ?? { id: timing.key, offsetMinutes: "", durationMinutes: "", personSlug: "", displayLabel: "", roleLabel: "Participant" };
    const old = previous.get(timing.key);
    if (old?.startAt === timing.startAt && old?.endAt === timing.endAt) return { ...row, position };
    return { ...row, position, startAtOverride: Number.isFinite(eventStartAt) ? timing.startAt : undefined, endAtOverride: Number.isFinite(eventStartAt) ? timing.endAt : undefined,
      offsetMsOverride: Number.isFinite(eventStartAt) ? undefined : timing.startAt,
      durationMsOverride: !Number.isFinite(eventStartAt) && timing.startAt !== undefined && timing.endAt !== undefined ? timing.endAt - timing.startAt : undefined,
      offsetMinutes: timing.startAt === undefined ? "" : String((timing.startAt - (Number.isFinite(eventStartAt) ? eventStartAt : 0)) / 60_000),
      durationMinutes: timing.startAt === undefined || timing.endAt === undefined ? "" : String((timing.endAt - timing.startAt) / 60_000),
    };
  });
}

export function readIntakeInstant(fields: EventIntakePatch, local: EventIntakeLocalTime | null | undefined): number | undefined {
  const clock = readIntakeEditorClock({ fields, local });
  return clock.kind === "resolved" ? clock.instant : undefined;
}

export function readIntakeLineupTimings(fields: EventIntakePatch): LineupTimingRow[] {
  return (fields.lineup ?? []).map(row => {
    if (row.relativeTiming) {
      const startAt = (readIntakeInstant(fields, fields.start) ?? 0) + row.relativeTiming.offsetMinutes * 60_000;
      return { key: row.clientKey, startAt, endAt: startAt + row.relativeTiming.durationMinutes * 60_000 };
    }
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
    if ((row.relativeTiming || (readIntakeInstant(fields, fields.start) === undefined && !row.start && !row.end)) && timing.startAt !== undefined && timing.endAt !== undefined) {
      return { ...row, position, start: null, end: null, relativeTiming: { offsetMinutes: (timing.startAt - (readIntakeInstant(fields, fields.start) ?? 0)) / 60_000, durationMinutes: (timing.endAt - timing.startAt) / 60_000 } };
    }
    return { ...row, position,
      ...(old?.startAt === timing.startAt ? {} : { start: timing.startAt === undefined ? null : intakeLocalFromInstant(fields, timing.startAt) }),
      ...(old?.endAt === timing.endAt ? {} : { end: timing.endAt === undefined ? null : intakeLocalFromInstant(fields, timing.endAt) }),
    };
  });
  return { ...fields, lineup };
}
