export type LineupTimingRow = { key: string; startAt?: number; endAt?: number };

export type LineupEditResult<T> =
  | { ok: true; rows: T[] }
  | {
      ok: false;
      reason:
        | "invalid_duration"
        | "invalid_count"
        | "slot_limit"
        | "missing_boundary"
        | "missing_duration"
        | "missing_row";
    };

const MAX_SLOTS = 80;
const MAX_DURATION_MINUTES = 1_440;
const MINUTE_MS = 60_000;

function isValidDuration(durationMinutes: number): boolean {
  return Number.isInteger(durationMinutes) && durationMinutes > 0 && durationMinutes <= MAX_DURATION_MINUTES;
}

function isKnownAt(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function getKnownDurationMs(row: LineupTimingRow): number | undefined {
  if (!isKnownAt(row.startAt) || !isKnownAt(row.endAt) || row.endAt <= row.startAt) return undefined;
  return row.endAt - row.startAt;
}

function shiftRow<T extends LineupTimingRow>(row: T, deltaMs: number): T {
  return {
    ...row,
    ...(isKnownAt(row.startAt) ? { startAt: row.startAt + deltaMs } : {}),
    ...(isKnownAt(row.endAt) ? { endAt: row.endAt + deltaMs } : {}),
  };
}

export function generateLineupTimings({
  startAt,
  count,
  durationMinutes,
  keys,
}: {
  startAt: number;
  count: number;
  durationMinutes: number;
  keys: string[];
}): LineupEditResult<LineupTimingRow> {
  if (!isValidDuration(durationMinutes)) return { ok: false, reason: "invalid_duration" };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, reason: "invalid_count" };
  if (count > MAX_SLOTS) return { ok: false, reason: "slot_limit" };
  if (keys.length < count) return { ok: false, reason: "invalid_count" };
  if (!isKnownAt(startAt)) return { ok: false, reason: "missing_boundary" };

  const durationMs = durationMinutes * MINUTE_MS;
  return {
    ok: true,
    rows: keys.slice(0, count).map((key, index) => ({
      key,
      startAt: startAt + index * durationMs,
      endAt: startAt + (index + 1) * durationMs,
    })),
  };
}

export function insertLineupSlot<T extends LineupTimingRow>({
  rows,
  index,
  row,
  durationMinutes,
  eventStartAt,
}: {
  rows: readonly T[];
  index: number;
  row: T;
  durationMinutes: number;
  eventStartAt?: number;
}): LineupEditResult<T> {
  if (!isValidDuration(durationMinutes)) return { ok: false, reason: "invalid_duration" };
  if (rows.length >= MAX_SLOTS) return { ok: false, reason: "slot_limit" };
  if (!Number.isInteger(index) || index < 0 || index > rows.length) return { ok: false, reason: "missing_row" };
  const startAt = index === 0 ? eventStartAt : rows[index - 1]?.endAt;
  if (!isKnownAt(startAt)) return { ok: false, reason: "missing_boundary" };

  const durationMs = durationMinutes * MINUTE_MS;
  return {
    ok: true,
    rows: [
      ...rows.slice(0, index),
      { ...row, startAt, endAt: startAt + durationMs },
      ...shiftLineupStart(rows.slice(index), durationMs),
    ],
  };
}

export function changeLineupDuration<T extends LineupTimingRow>(
  rows: readonly T[],
  key: string,
  durationMinutes: number,
): LineupEditResult<T> {
  if (!isValidDuration(durationMinutes)) return { ok: false, reason: "invalid_duration" };
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  if (!row) return { ok: false, reason: "missing_row" };
  const previousDurationMs = getKnownDurationMs(row);
  if (previousDurationMs === undefined || !isKnownAt(row.startAt)) return { ok: false, reason: "missing_duration" };

  const durationMs = durationMinutes * MINUTE_MS;
  return {
    ok: true,
    rows: [
      ...rows.slice(0, index),
      { ...row, endAt: row.startAt + durationMs },
      ...shiftLineupStart(rows.slice(index + 1), durationMs - previousDurationMs),
    ],
  };
}

export function removeLineupSlot<T extends LineupTimingRow>(rows: readonly T[], key: string): LineupEditResult<T> {
  const index = rows.findIndex((row) => row.key === key);
  const row = rows[index];
  if (!row) return { ok: false, reason: "missing_row" };
  const durationMs = getKnownDurationMs(row) ?? 0;
  return {
    ok: true,
    rows: [...rows.slice(0, index), ...shiftLineupStart(rows.slice(index + 1), -durationMs)],
  };
}

export function shiftLineupStart<T extends LineupTimingRow>(rows: readonly T[], deltaMs: number): T[] {
  return rows.map((row) => shiftRow(row, deltaMs));
}

export function getLineupEndAt(rows: readonly LineupTimingRow[]): number | undefined {
  let latestEndAt: number | undefined;
  for (const row of rows) {
    if (row.startAt === undefined && row.endAt === undefined) continue;
    if (getKnownDurationMs(row) === undefined || !isKnownAt(row.endAt)) return undefined;
    latestEndAt = latestEndAt === undefined ? row.endAt : Math.max(latestEndAt, row.endAt);
  }
  return latestEndAt;
}

export function getLineupEndConflict(
  explicitEndAt: number | undefined,
  rows: readonly LineupTimingRow[],
): { latestKnownAt: number; lineupEndAt?: number } | undefined {
  if (!isKnownAt(explicitEndAt)) return undefined;
  let latestKnownAt = explicitEndAt;
  for (const row of rows) {
    if (isKnownAt(row.startAt)) latestKnownAt = Math.max(latestKnownAt, row.startAt);
    if (isKnownAt(row.endAt)) latestKnownAt = Math.max(latestKnownAt, row.endAt);
  }
  if (latestKnownAt <= explicitEndAt) return undefined;
  const lineupEndAt = getLineupEndAt(rows);
  return { latestKnownAt, ...(lineupEndAt !== undefined ? { lineupEndAt } : {}) };
}
