export type RangeDays = 7 | 30 | 90;
export type DashboardLocation = {
  from: string;
  to: string;
  day: string | null;
  instance: string | null;
};

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  return localDateKey(date) === value ? date : null;
}

export function defaultDashboardRange(rangeDays: RangeDays, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  from.setDate(from.getDate() - rangeDays + 1);
  return { from: localDateKey(from), to: localDateKey(now) };
}

export function dashboardLocation(
  search: URLSearchParams,
  rangeDays: RangeDays,
  now = new Date(),
): DashboardLocation {
  const fallback = defaultDashboardRange(rangeDays, now);
  const fromDate = parseLocalDate(search.get("from"));
  const toDate = parseLocalDate(search.get("to"));
  const valid =
    fromDate &&
    toDate &&
    fromDate <= toDate &&
    (toDate.getTime() - fromDate.getTime()) / 86400_000 < 91;
  const range = valid
    ? { from: localDateKey(fromDate), to: localDateKey(toDate) }
    : fallback;
  const day = search.get("day");
  return {
    ...range,
    day:
      parseLocalDate(day) && day! >= range.from && day! <= range.to
        ? day
        : null,
    instance: search.get("instance") || null,
  };
}

export function dashboardBounds(location: DashboardLocation) {
  const start = parseLocalDate(location.day ?? location.from)!;
  const end = parseLocalDate(location.day ?? location.to)!;
  end.setDate(end.getDate() + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

export function localDayRanges(from: string, to: string) {
  const cursor = parseLocalDate(from)!;
  const last = parseLocalDate(to)!;
  const days: Array<{ key: string; startAt: number; endAt: number }> = [];
  while (cursor <= last && days.length < 91) {
    const key = localDateKey(cursor);
    const startAt = cursor.getTime();
    cursor.setDate(cursor.getDate() + 1);
    days.push({ key, startAt, endAt: cursor.getTime() });
  }
  return days;
}

export function dashboardHref(
  pathname: string,
  location: DashboardLocation,
  update: Partial<DashboardLocation> = {},
) {
  const next = { ...location, ...update };
  const params = new URLSearchParams({ from: next.from, to: next.to });
  if (next.day) params.set("day", next.day);
  if (next.instance) params.set("instance", next.instance);
  return `${pathname}?${params}`;
}

export const homeWidgetLabels = {
  current: "Current activity",
  activity: "Activity history",
  membership: "Total membership",
  instances: "Recent instances",
  recaps: "Event recaps",
} as const;
export type HomeWidget = keyof typeof homeWidgetLabels;

export function moveWidget(
  widgets: readonly string[],
  widget: string,
  direction: -1 | 1,
) {
  const result = [...widgets];
  const index = result.indexOf(widget);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= result.length)
    return result;
  [result[index], result[destination]] = [result[destination]!, result[index]!];
  return result;
}

type MembershipInterval = { startAt: number; endAt: number };

export function membershipChartPoints(
  observations: readonly { at: number; value: number; coverage: string }[],
  intervals: readonly MembershipInterval[],
) {
  const points: Array<{ at: number; value: number | null; label: string }> = [];
  const label = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  for (const [index, point] of observations.entries()) {
    const previous = observations[index - 1];
    if (previous && previous.at < point.at) {
      let cursor = previous.at;
      const gaps: MembershipInterval[] = [];
      for (const interval of intervals) {
        if (interval.endAt <= cursor || interval.startAt >= point.at) continue;
        if (interval.startAt > cursor)
          gaps.push({ startAt: cursor, endAt: interval.startAt });
        cursor = Math.max(cursor, interval.endAt);
      }
      if (cursor < point.at) gaps.push({ startAt: cursor, endAt: point.at });
      for (const gap of gaps) {
        // Keep both real observations even when coverage begins/ends at them.
        const inset = Math.min(1, (point.at - previous.at) / 3);
        for (const at of new Set([
          Math.max(previous.at + inset, gap.startAt),
          Math.min(point.at - inset, gap.endAt),
        ]))
          points.push({ at, value: null, label: label(at) });
      }
    }
    points.push({
      at: point.at,
      value: point.coverage === "observed" ? point.value : null,
      label: label(point.at),
    });
  }
  return points;
}

export function membershipRangePoints(
  buckets: readonly {
    startAt: number;
    membership: {
      lastValue: number | null;
      continuous: boolean;
      continuousUntil?: number | null;
    } | null;
  }[],
  liveCoverageFresh = true,
) {
  const continuous = (bucket: (typeof buckets)[number]) =>
    bucket.membership?.continuous &&
    (bucket.membership.continuousUntil == null || liveCoverageFresh);
  const points: Array<{ at: number; value: number | null; label: string }> = [];
  for (const [index, bucket] of buckets.entries()) {
    const previous = buckets[index - 1];
    const label = new Date(bucket.startAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (previous && (!continuous(previous) || !continuous(bucket)))
      points.push({
        at: (previous.startAt + bucket.startAt) / 2,
        value: null,
        label,
      });
    points.push({
      at: bucket.startAt,
      value: bucket.membership?.lastValue ?? null,
      label,
    });
  }
  return points;
}
