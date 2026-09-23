import assert from "node:assert/strict";
import { test } from "node:test";
import {
  membershipChartPoints,
  membershipRangePoints,
  dashboardBounds,
  dashboardHref,
  dashboardLocation,
  localDayRanges,
  moveWidget,
  parseLocalDate,
} from "../../apps/web/src/app/account/communities/[slug]/club-analytics-model";

test("range parsing rejects invalid dates and retains browser navigation context", () => {
  assert.equal(parseLocalDate("2026-02-30"), null);
  const state = dashboardLocation(
    new URLSearchParams(
      "from=2026-09-01&to=2026-09-30&day=2026-09-12&instance=session1",
    ),
    30,
  );
  assert.equal(state.day, "2026-09-12");
  const href = dashboardHref("/club", state, { instance: null });
  assert.equal(href, "/club?from=2026-09-01&to=2026-09-30&day=2026-09-12");
  assert.deepEqual(
    dashboardLocation(new URL(href, "https://example.test").searchParams, 30),
    { ...state, instance: null },
  );
});

test("day bounds use local calendar transitions across daylight saving time", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const spring = dashboardBounds({
      from: "2026-03-01",
      to: "2026-03-31",
      day: "2026-03-08",
      instance: null,
    });
    const fall = dashboardBounds({
      from: "2026-11-01",
      to: "2026-11-01",
      day: null,
      instance: null,
    });
    assert.equal(spring.endAt - spring.startAt, 23 * 3600_000);
    assert.equal(fall.endAt - fall.startAt, 25 * 3600_000);
    const days = localDayRanges("2026-03-07", "2026-03-09");
    assert.equal(days[1]!.endAt - days[1]!.startAt, 23 * 3600_000);
    assert.equal(days[0]!.endAt, days[1]!.startAt);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("widget reorder preserves hidden widgets and respects boundaries", () => {
  assert.deepEqual(
    moveWidget(["activity", "membership", "instances"], "membership", -1),
    ["membership", "activity", "instances"],
  );
  assert.deepEqual(moveWidget(["activity"], "activity", 1), ["activity"]);
});

test("membership charts break on collection gaps while retaining sparse observations", () => {
  const points = [0, 6, 12, 18].map(hour => ({ at: hour * 3600_000, value: 100 + hour, coverage: "observed" }));
  assert.equal(membershipChartPoints(points, [{ startAt: 0, endAt: 24 * 3600_000 }]).filter(p => p.value === null).length, 0);
  const gaps = membershipChartPoints(points, [{ startAt: 0, endAt: 7 * 3600_000 }, { startAt: 11 * 3600_000, endAt: 24 * 3600_000 }]);
  assert.deepEqual(gaps.filter(p => p.value !== null).map(p => p.value), [100, 106, 112, 118]);
  assert.deepEqual(gaps.filter(p => p.value === null).map(p => p.at), [7 * 3600_000, 11 * 3600_000]);
  assert.ok(membershipChartPoints(points, []).some(p => p.value === null));
  assert.equal(membershipChartPoints([{ at: 0, value: 99, coverage: "unknown" }], []).at(0)?.value, null);
});

test("membership range isolates partial days and preserves unknown days", () => {
  const days = [true, false, true, true].map((continuous, i) => ({ startAt: i * 86400_000, membership: { lastValue: 100 + i, continuous } }));
  const points = membershipRangePoints(days);
  assert.deepEqual(points.map(p => p.value), [100, null, 101, null, 102, 103]);
});
