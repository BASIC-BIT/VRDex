import assert from "node:assert/strict";
import { it } from "node:test";
import {
  summarizeSeries,
  summarizeSeriesSegment,
  mergeSeriesSegments,
} from "../../convex/_clubAnalyticsMath";
import { computePopulationMetrics } from "../../convex/_communityTelemetry";
const point = (at: number, value = 10, breakBefore = false) => ({
  at,
  value,
  coverage: "observed",
  breakBefore,
});
it("keeps real boundary intervals in the population adapter", () => {
  const points = Array.from({ length: 32 }, (_, i) =>
    point((i * 2 - 1) * 60_000),
  );
  const summary = computePopulationMetrics(
    points.map((p) => ({
      observedAt: p.at,
      population: p.value,
      coverageState: "observed",
      instanceKey: "one",
      worldId: "world",
    })),
    0,
    3_600_000,
  );
  assert.equal(summary.playerHours, 10);
  assert.equal(summary.coverageRatio, 1);
});
it("accepts quiet cadence allowance but never a longer unobserved interval", () => {
  for (const gap of [301_000, 359_999, 360_000, 360_001]) {
    const result = summarizeSeries([point(0, 0), point(gap, 0)], 0, gap);
    assert.equal(result.coverageRatio, gap <= 360_000 ? 1 : 0);
    assert.equal(result.playerHours, gap <= 360_000 ? 0 : null);
  }
});
it("preserves outage breaks across one-point summary pages", () => {
  const points = [point(0), point(120_000, 10, true), point(240_000)];
  const whole = summarizeSeries(points, 0, 240_000);
  assert.equal(whole.coverageRatio, 0.5);
  assert.deepEqual(
    mergeSeriesSegments(
      points.map((p) => summarizeSeriesSegment([p], 0, 240_000)),
      0,
      240_000,
    ),
    whole,
  );
});
it("does not invent an observed peak from out-of-range endpoints", () => {
  assert.equal(
    summarizeSeries([point(-60_000, 100), point(60_000, 200)], 0, 30_000).peak,
    null,
  );
});
