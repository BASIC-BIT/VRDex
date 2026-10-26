import type { z, PublicGroupPopulationSeriesSchema } from "../packages/api-contracts/src/schemas";
import type { Doc } from "./_generated/dataModel";
import { MAX_INTERPOLATION_GAP_MS, type CoverageWindow } from "./_communityTelemetry";

export type PopulationSeries = z.infer<typeof PublicGroupPopulationSeriesSchema>;
type Observation = Pick<Doc<"communityPopulationObservations">, "observedAt" | "totalPopulation" | "activeInstanceCount" | "coverageState">;
type Point = PopulationSeries["buckets"][number]["observedSpans"][number]["points"][number];

export function buildGroupPopulationSeries({ observations, coverageWindows, startAt, endAt }: {
  observations: Observation[];
  coverageWindows: CoverageWindow[];
  startAt: number;
  endAt: number;
}): PopulationSeries {
  const sorted = [...observations].sort((a, b) => a.observedAt - b.observedAt);
  const gaps = coverageWindows.filter(window => window.state !== "observed" && window.state !== "estimated");
  const segments: Point[][] = [];
  let previous: Observation | undefined;
  let segment: Point[] = [];
  let measuredMs = 0;
  let playerMs = 0;
  let peakConcurrency = 0;
  for (const row of sorted) {
    if (row.coverageState !== "observed" && row.coverageState !== "estimated") {
      previous = undefined;
      continue;
    }
    const delta = previous ? row.observedAt - previous.observedAt : 0;
    const connected = previous !== undefined && delta > 0 && delta <= MAX_INTERPOLATION_GAP_MS &&
      !gaps.some(gap => gap.startedAt < row.observedAt && (gap.endedAt ?? endAt) > previous!.observedAt);
    if (!connected) {
      segment = [];
      segments.push(segment);
    }
    if (connected && previous) {
      const left = Math.max(startAt, previous.observedAt);
      const right = Math.min(endAt, row.observedAt);
      if (right > left) {
        const slope = (row.totalPopulation - previous.totalPopulation) / delta;
        const leftPopulation = previous.totalPopulation + slope * (left - previous.observedAt);
        const rightPopulation = previous.totalPopulation + slope * (right - previous.observedAt);
        measuredMs += right - left;
        playerMs += (leftPopulation + rightPopulation) / 2 * (right - left);
      }
    }
    if (row.observedAt >= startAt && row.observedAt < endAt) {
      peakConcurrency = Math.max(peakConcurrency, row.totalPopulation);
      segment.push({ observedAt: row.observedAt, population: row.totalPopulation, instanceCount: row.activeInstanceCount });
    }
    previous = row;
  }
  const width = Math.max(120_000, Math.ceil((endAt - startAt) / 720));
  const buckets: PopulationSeries["buckets"] = [];
  for (let start = startAt; start < endAt; start += width) {
    const end = Math.min(endAt, start + width);
    const observedSpans = segments.flatMap(points => {
      const inside = points.filter(point => point.observedAt >= start && point.observedAt < end);
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (!first || !last) return [];
      const extrema = [first, last];
      for (const key of ["population", "instanceCount"] as const) {
        extrema.push(inside.reduce((a, b) => a[key] <= b[key] ? a : b));
        extrema.push(inside.reduce((a, b) => a[key] >= b[key] ? a : b));
      }
      return [{ startAt: first.observedAt, endAt: last.observedAt,
        points: [...new Map(extrema.map(point => [point.observedAt, point])).values()].sort((a, b) => a.observedAt - b.observedAt) }];
    });
    const points = observedSpans.flatMap(span => span.points);
    const last = points[points.length - 1];
    buckets.push({ startAt: start, endAt: end, observedSpans, ...(last ? {
      populationMin: Math.min(...points.map(point => point.population)),
      populationMax: Math.max(...points.map(point => point.population)),
      populationLast: last.population,
      instanceCountMin: Math.min(...points.map(point => point.instanceCount)),
      instanceCountMax: Math.max(...points.map(point => point.instanceCount)),
      instanceCountLast: last.instanceCount,
      observedAt: last.observedAt,
    } : {}) });
  }
  return { startAt, endAt, coverageRatio: measuredMs / Math.max(1, endAt - startAt), peakConcurrency, playerHours: playerMs / 3_600_000, buckets };
}
