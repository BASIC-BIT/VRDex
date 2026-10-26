import type { PublicGroupPopulationSeriesSchema } from "@vrdex/api-contracts";

export type PopulationSeries = ReturnType<typeof PublicGroupPopulationSeriesSchema.parse>;
export type StatisticsRange = { startAt: number; endAt: number } | null;
type Observation = PopulationSeries["buckets"][number]["observedSpans"][number]["points"][number];
type ChartPoint = { observedAt: number; population: number | null; instanceCount: number | null };

export function buildPopulationChartModel(series: PopulationSeries, now: number) {
  const spans = new Map<string, Observation[]>();
  for (const bucket of series.buckets) {
    for (const span of bucket.observedSpans) {
      const key = `${span.startAt}:${span.endAt}`;
      const points = spans.get(key) ?? [];
      points.push(...span.points);
      spans.set(key, points);
    }
  }
  const segments = [...spans.values()];
  const observations = segments.flat().sort((a, b) => a.observedAt - b.observedAt);
  const points: ChartPoint[] = segments.flatMap(segment => {
    const last = segment[segment.length - 1];
    return last ? [...segment, { observedAt: last.observedAt, population: null, instanceCount: null }] : [];
  });
  points.sort((a, b) => a.observedAt - b.observedAt);
  const last = observations[observations.length - 1];
  const current = last && now - last.observedAt <= 360_000 && now >= last.observedAt ? last : undefined;
  return { buckets: series.buckets, segments, points, observations, currentPopulation: current?.population, currentInstanceCount: current?.instanceCount };
}

export function populationRangeInput(range: StatisticsRange) {
  return range === null ? {} : { statisticsStartAt: range.startAt, statisticsEndAt: range.endAt };
}

export function localStatisticsDay(day: string): StatisticsRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || localStatisticsDate(start.getTime()) !== day) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.getTime(), endAt: end.getTime() };
}

export function localStatisticsDate(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatPopulationObservation(at: number) {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}
