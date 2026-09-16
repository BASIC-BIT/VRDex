export type SeriesPoint = { at: number; value: number; coverage: string };
export type SeriesSummary = {
  peak: number | null;
  average: number | null;
  playerHours: number | null;
  lastValue: number | null;
  coverageRatio: number;
};
export const MAX_OBSERVED_GAP_MS = 5 * 60_000;

export type SeriesSegment = {
  peak: number | null;
  area: number;
  observedDuration: number;
  first: SeriesPoint | null;
  last: SeriesPoint | null;
};

/** Compact page statistics. Endpoints preserve the interval across page boundaries. */
export function summarizeSeriesSegment(
  points: SeriesPoint[],
  startAt: number,
  endAt: number,
): SeriesSegment {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const summary = summarizeSeries(sorted, startAt, endAt);
  const observedDuration = summary.coverageRatio * (endAt - startAt);
  return {
    peak: summary.peak,
    area: (summary.average ?? 0) * observedDuration,
    observedDuration,
    first: sorted[0] ?? null,
    last: sorted[sorted.length - 1] ?? null,
  };
}

/** Merge ordered summary pages, counting each cross-page interval exactly once. */
export function mergeSeriesSegments(
  segments: SeriesSegment[],
  startAt: number,
  endAt: number,
): SeriesSummary {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt)
    throw new Error("Invalid analytics range.");
  let peak: number | null = null;
  let area = 0;
  let duration = 0;
  let previous: SeriesPoint | null = null;
  let lastValue: number | null = null;
  for (const segment of segments) {
    if (segment.peak !== null) peak = Math.max(peak ?? 0, segment.peak);
    area += segment.area;
    duration += segment.observedDuration;
    if (previous && segment.first && previous.at < segment.first.at) {
      const bridge = summarizeSeriesSegment(
        [previous, segment.first],
        startAt,
        endAt,
      );
      area += bridge.area;
      duration += bridge.observedDuration;
      if (bridge.peak !== null) peak = Math.max(peak ?? 0, bridge.peak);
    }
    if (segment.last) {
      previous = segment.last;
      if (previous.coverage === "observed" && previous.at < endAt)
        lastValue = previous.value;
    }
  }
  return {
    peak,
    average: duration ? area / duration : null,
    playerHours: duration ? area / 3600_000 : null,
    lastValue,
    coverageRatio: duration / (endAt - startAt),
  };
}

export function summarizeSeries(
  points: SeriesPoint[],
  startAt: number,
  endAt: number,
): SeriesSummary {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt)
    throw new Error("Invalid analytics range.");
  const sorted = [
    ...new Map(points.map((point) => [point.at, point])).values(),
  ].sort((a, b) => a.at - b.at);
  const observed = (point: SeriesPoint) =>
    point.coverage === "observed" &&
    Number.isFinite(point.value) &&
    point.value >= 0;
  let peak: number | null = null,
    area = 0,
    duration = 0;
  let lastValue: number | null = null;
  for (const point of sorted) {
    if (observed(point) && point.at < endAt) lastValue = point.value;
    if (observed(point) && point.at >= startAt && point.at < endAt)
      peak = Math.max(peak ?? 0, point.value);
  }
  for (let index = 1; index < sorted.length; index++) {
    const a = sorted[index - 1]!,
      b = sorted[index]!;
    if (
      !observed(a) ||
      !observed(b) ||
      b.at - a.at > MAX_OBSERVED_GAP_MS ||
      b.at <= startAt ||
      a.at >= endAt
    )
      continue;
    const left = Math.max(startAt, a.at),
      right = Math.min(endAt, b.at);
    if (right <= left) continue;
    const valueAt = (at: number) =>
      a.value + ((b.value - a.value) * (at - a.at)) / (b.at - a.at);
    const first = valueAt(left),
      last = valueAt(right);
    area += ((first + last) / 2) * (right - left);
    duration += right - left;
    peak = Math.max(peak ?? 0, first, last);
  }
  return {
    peak,
    average: duration ? area / duration : null,
    playerHours: duration ? area / 3600_000 : null,
    lastValue,
    coverageRatio: duration / (endAt - startAt),
  };
}

/** Find local calendar boundaries by instant, so DST repeats/skips remain distinct. */
export function timeBuckets(
  startAt: number,
  endAt: number,
  timeZone: string,
  grain: "day" | "hour" = "day",
) {
  if (endAt <= startAt || endAt - startAt > 93 * 86400_000)
    throw new Error("Choose a range of at most 93 days.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(grain === "hour"
      ? {
          hour: "2-digit",
          hourCycle: "h23" as const,
          timeZoneName: "longOffset" as const,
        }
      : {}),
  });
  const key = (at: number) => formatter.format(at);
  const buckets: Array<{ startAt: number; endAt: number }> = [];
  let current = startAt;
  while (current < endAt) {
    const label = key(current),
      step = grain === "day" ? 3600_000 : 15 * 60_000;
    let low = current,
      high = Math.min(current + step, endAt);
    while (high < endAt && key(high) === label) {
      low = high;
      high = Math.min(high + step, endAt);
    }
    if (key(high) !== label) {
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (key(middle) === label) low = middle;
        else high = middle;
      }
    }
    buckets.push({ startAt: current, endAt: high });
    current = high;
  }
  return buckets;
}
export function buildBuckets(
  points: SeriesPoint[],
  options: {
    startAt: number;
    endAt: number;
    timeZone: string;
    grain: "day" | "hour";
  },
) {
  return timeBuckets(
    options.startAt,
    options.endAt,
    options.timeZone,
    options.grain,
  ).map((bucket) => ({
    ...bucket,
    ...summarizeSeries(points, bucket.startAt, bucket.endAt),
  }));
}
