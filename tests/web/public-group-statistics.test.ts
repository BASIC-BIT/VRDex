import assert from "node:assert/strict";
import test from "node:test";
import { buildPopulationChartModel, populationRangeInput, localStatisticsDay } from "../../apps/web/src/lib/public-group-statistics";
import { buildGroupPopulationSeries } from "../../convex/_groupPopulationSeries";

const start = Date.parse("2026-10-20T00:00:00Z");
const row = (offset: number, population: number) => ({ observedAt: start + offset, totalPopulation: population, activeInstanceCount: population === 0 ? 0 : 2, coverageState: "observed" as const });

test("720 positions retain missing buckets, separate spans inside a bucket and real zero", () => {
  const series = buildGroupPopulationSeries({ startAt: start, endAt: start + 86_400_000,
    observations: [row(10_000, 12), row(20_000, 25), row(90_000, 4), row(100_000, 0)],
    coverageWindows: [{ startedAt: start + 30_000, endedAt: start + 80_000, state: "unknown" }],
  });
  const model = buildPopulationChartModel(series, start + 100_000);
  assert.equal(model.buckets.length, 720);
  assert.equal(model.buckets.filter(bucket => bucket.observedSpans.length === 0).length, 719);
  assert.deepEqual(model.segments.map(segment => segment.map(point => point.population)), [[12, 25], [4, 0]]);
  assert.equal(model.currentPopulation, 0);
  assert.equal(model.currentInstanceCount, 0);
  assert.equal(model.points.find(point => point.population === 25)?.observedAt, start + 20_000);
  assert.equal(model.currentPopulation, buildPopulationChartModel(series, start + 460_000).currentPopulation);
  assert.equal(buildPopulationChartModel(series, start + 460_001).currentPopulation, undefined);
});

test("last 24 hours omit clock-dependent bounds; explicit local days use paired epochs", () => {
  assert.deepEqual(populationRangeInput(null), {});
  const prior = process.env.TZ;
  process.env.TZ = "America/Indianapolis";
  try {
    assert.deepEqual(localStatisticsDay("2026-10-20"), { startAt: Date.parse("2026-10-20T04:00:00Z"), endAt: Date.parse("2026-10-21T04:00:00Z") });
    assert.deepEqual(populationRangeInput(localStatisticsDay("2026-10-20")), { statisticsStartAt: 1792468800000, statisticsEndAt: 1792555200000 });
    assert.equal(localStatisticsDay("2026-02-30"), null);
    assert.deepEqual(localStatisticsDay("2025-11-02"), { startAt: Date.parse("2025-11-02T04:00:00Z"), endAt: Date.parse("2025-11-03T05:00:00Z") });
    assert.deepEqual(localStatisticsDay("2026-03-08"), { startAt: Date.parse("2026-03-08T05:00:00Z"), endAt: Date.parse("2026-03-09T04:00:00Z") });
  } finally { process.env.TZ = prior; }
});

test("matching full span bounds connect bucket fragments while adjacent failure spans stay apart", () => {
  const series = buildGroupPopulationSeries({ startAt: start, endAt: start + 600_000,
    observations: [row(17_000, 12), row(137_000, 25), row(257_000, 4), row(377_000, 0)],
    coverageWindows: [{ startedAt: start + 200_000, endedAt: start + 240_000, state: "degraded" }],
  });
  const model = buildPopulationChartModel(series, start + 400_000);
  assert.deepEqual(model.segments.map(segment => segment.map(point => point.observedAt - start)), [[17_000, 137_000], [257_000, 377_000]]);
  assert.deepEqual(model.points.map(point => point.population), [12, 25, null, 4, 0, null]);
});
