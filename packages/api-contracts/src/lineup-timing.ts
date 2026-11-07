type TimedLineupRow = { startAt?: number; endAt?: number; followingBlocked?: boolean };
const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Derive display/runtime ends from canonical row order without changing authored timing. */
export function inferLineupEnds<T extends TimedLineupRow>(rows: readonly T[], eventEndAt?: number): Array<T & { endAt?: number }> {
  const counts = new Map<number, number>();
  for (const row of rows) if (finite(row.startAt)) counts.set(row.startAt, (counts.get(row.startAt) ?? 0) + 1);
  const orderedAt = (index: number) => {
    const start = rows[index]?.startAt;
    if (!finite(start) || counts.get(start) !== 1) return false;
    const before = rows[index - 1]?.startAt, after = rows[index + 1]?.startAt;
    return (before === undefined || (finite(before) && before < start))
      && (after === undefined || (finite(after) && after > start));
  };
  return rows.map((row, index) => {
    const copy = { ...row };
    if (row.followingBlocked || row.endAt !== undefined || !finite(row.startAt) || !orderedAt(index)) return copy;
    const next = rows[index + 1];
    const end = next === undefined ? eventEndAt : orderedAt(index + 1) ? next.startAt : undefined;
    return finite(end) && end > row.startAt ? { ...copy, endAt: end } : copy;
  });
}
