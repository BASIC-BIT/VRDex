import assert from "node:assert/strict";
import { it } from "node:test";
import { buildGroupPopulationSeries } from "../../convex/_groupPopulationSeries";
const minute = 60_000;
const point = (observedAt: number, population: number, instanceCount = 1) => ({ observedAt, totalPopulation: population, activeInstanceCount: instanceCount, coverageState: "observed" as const });
it("series preserves narrow observed extrema, empty polls and silent gaps within 720 buckets", () => {
  const series = buildGroupPopulationSeries({ startAt: 0, endAt: 24 * 60 * minute, coverageWindows: [], observations: [point(0, 1), point(10_000, 90, 9), point(20_000, 2), point(minute, 0, 0), point(20 * minute, 7)] });
  assert.equal(series.buckets.length, 720);
  assert.equal(series.peakConcurrency, 90);
  assert.equal(series.buckets[0]?.populationMax, 90);
  assert.equal(series.buckets[0]?.populationLast, 0);
  assert.equal(series.buckets[2]?.populationLast, undefined);
  assert.deepEqual(series.buckets[2]?.observedSpans, []);
  assert.deepEqual(series.buckets[0]?.observedSpans[0]?.points.map(p => p.population), [1, 90, 0]);
  assert.equal(series.playerHours, (45.5 * 10_000 + 46 * 10_000 + 1 * 40_000) / 3_600_000);
});
it("series segments explicit gaps before reducing even inside the same bucket", () => {
  const series = buildGroupPopulationSeries({ startAt: 0, endAt: 24 * 60 * minute, observations: [point(0, 10), point(30_000, 8), point(90_000, 50), point(110_000, 2)], coverageWindows: [{ startedAt: 40_000, endedAt: 80_000, state: "degraded" }] });
  assert.equal(series.buckets[0]?.observedSpans.length, 2);
  assert.equal(series.playerHours, (9 * 30_000 + 26 * 20_000) / 3_600_000);
  assert.equal(series.coverageRatio, 50_000 / (24 * 60 * minute));
});
it("series clips integration using boundary samples without fabricating in-range peaks", () => {
  const series = buildGroupPopulationSeries({ startAt: 10_000, endAt: 50_000, observations: [point(0, 100), point(60_000, 200)], coverageWindows: [] });
  assert.equal(series.peakConcurrency, 0);
  assert.equal(series.playerHours, 150 * 40_000 / 3_600_000);
  assert.equal(series.coverageRatio, 1);
  assert.ok(series.buckets.every(b => b.populationLast === undefined));
});
it("bucket fragments share full in-window segment bounds without joining neighboring failures", () => {
  const series = buildGroupPopulationSeries({ startAt: 0, endAt: 600_000,
    observations: [point(-10_000, 99), point(17_000, 1), point(137_000, 2), point(257_000, 3), point(377_000, 4), point(617_000, 99)],
    coverageWindows: [{ startedAt: 200_000, endedAt: 240_000, state: "degraded" }],
  });
  assert.deepEqual(series.buckets.flatMap(bucket => bucket.observedSpans.map(span => [span.startAt, span.endAt])),
    [[17_000, 137_000], [17_000, 137_000], [257_000, 377_000], [257_000, 377_000]]);
  assert.ok(series.buckets.flatMap(bucket => bucket.observedSpans.flatMap(span => span.points)).every(point => point.observedAt >= 0 && point.observedAt < 600_000));
});
