import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { TimelineSchedule } from "../../convex/_eventTimelineTypes";
import { packEvents, packPlan, reconcileEventLanes } from "../../apps/web/src/lib/timeline/packing";

function event(id: string, startAt: number, endAt: number) {
  return { id, schedule: { kind: "timed", startAt, endAt } satisfies TimelineSchedule };
}

function item(key: string, startAt: number, endAt: number) {
  return { key, schedule: { kind: "timed", startAt, endAt } satisfies TimelineSchedule };
}

describe("public timeline packing", () => {
  it("reuses a lane at exactly an hour of space, but not one millisecond earlier", () => {
    assert.deepEqual(packEvents({ events: [event("A", 0, 3_600_000), event("B", 7_199_999, 10_800_000), event("C", 7_200_000, 10_800_000)] }), [
      { eventId: "A", lane: 0 }, { eventId: "B", lane: 1 }, { eventId: "C", lane: 0 },
    ]);
  });

  it("sorts equal starts by stable ID regardless of input order", () => {
    assert.deepEqual(packEvents({ events: [event("B", 0, 1), event("A", 0, 1)] }), [
      { eventId: "A", lane: 0 }, { eventId: "B", lane: 1 },
    ]);
  });

  it("uses the first available row rather than keeping a community row", () => {
    assert.deepEqual(packEvents({ events: [event("A", 0, 3_600_000), event("B", 0, 7_200_000), event("C", 7_200_000, 10_800_000)] }), [
      { eventId: "A", lane: 0 }, { eventId: "B", lane: 1 }, { eventId: "C", lane: 0 },
    ]);
  });

  it("preserves frozen prior lanes while appending later events", () => {
    const events = [event("A", 0, 3_600_000), event("B", 0, 3_600_000)];
    const previous = [{ eventId: "A", lane: 1 }, { eventId: "B", lane: 0 }];
    assert.deepEqual(packEvents({ events: [...events, event("C", 7_200_000, 10_800_000)], previous }), [
      { eventId: "A", lane: 1 }, { eventId: "B", lane: 0 }, { eventId: "C", lane: 0 },
    ]);
    assert.deepEqual(previous, [{ eventId: "A", lane: 1 }, { eventId: "B", lane: 0 }]);
  });

  it("leaves markers, date-only items and invalid intervals out of solid lanes", () => {
    assert.deepEqual(packEvents({ events: [
      { id: "marker", schedule: { kind: "open_end", startAt: 0 } },
      { id: "untimed", schedule: { kind: "date_only", eventDate: "2026-10-26" } },
      event("reversed", 10, 0), event("empty", 0, 0), event("invalid", 0, Number.NaN), event("infinite", 0, Infinity),
      event("valid", 0, 1),
    ] }), [{ eventId: "valid", lane: 0 }]);
  });
});

describe("My night packing", () => {
  it("places adjacent saved sets in the same lane with zero spacing", () => {
    assert.deepEqual(packPlan({ items: [item("B", 3_600_000, 7_200_000), item("A", 0, 3_600_000)] }), [
      { key: "A", lane: 0, overlapping: false }, { key: "B", lane: 0, overlapping: false },
    ]);
  });

  it("retains every selection and marks both sides of every genuine overlap", () => {
    assert.deepEqual(packPlan({ items: [item("A", 0, 10), item("B", 2, 4), item("C", 5, 8), item("D", 10, 12)] }), [
      { key: "A", lane: 0, overlapping: true }, { key: "B", lane: 1, overlapping: true },
      { key: "C", lane: 1, overlapping: true }, { key: "D", lane: 0, overlapping: false },
    ]);
  });

  it("breaks equal-start ties by stable key and omits invalid intervals", () => {
    assert.deepEqual(packPlan({ items: [item("B", 0, 5), item("A", 0, 3), item("reversed", 3, 0), item("invalid", Number.NaN, 10)] }), [
      { key: "A", lane: 0, overlapping: true }, { key: "B", lane: 1, overlapping: true },
    ]);
  });
});

describe("stable public lane reconciliation", () => {
  const h = 3_600_000;
  const earlier = event("earlier", -4 * h, -h),
    ongoing = event("ongoing", -2 * h, 20 * h);
  it("keeps an unchanged ongoing event in lane 1 when its earlier prefetch neighbor drops out", () => {
    const previousEvents = [earlier, ongoing];
    const previous = packEvents({ events: previousEvents });
    assert.deepEqual(previous, [
      { eventId: "earlier", lane: 0 },
      { eventId: "ongoing", lane: 1 },
    ]);
    assert.deepEqual(
      reconcileEventLanes({ events: [ongoing], previousEvents, previous }),
      [{ eventId: "ongoing", lane: 1 }],
    );
    assert.deepEqual(
      reconcileEventLanes({
        events: [ongoing, event("later", 22 * h, 24 * h)],
        previousEvents: [ongoing],
        previous: [{ eventId: "ongoing", lane: 1 }],
      }),
      [
        { eventId: "ongoing", lane: 1 },
        { eventId: "later", lane: 0 },
      ],
    );
  });
  it("recomputes for an actual prepend or a material authored-time change", () => {
    assert.deepEqual(
      reconcileEventLanes({
        events: [earlier, ongoing],
        previousEvents: [ongoing],
        previous: [{ eventId: "ongoing", lane: 0 }],
      }),
      [
        { eventId: "earlier", lane: 0 },
        { eventId: "ongoing", lane: 1 },
      ],
    );
    assert.deepEqual(
      reconcileEventLanes({
        events: [earlier, event("ongoing", 0, 20 * h)],
        previousEvents: [earlier, ongoing],
        previous: [
          { eventId: "earlier", lane: 0 },
          { eventId: "ongoing", lane: 1 },
        ],
      }),
      [
        { eventId: "earlier", lane: 0 },
        { eventId: "ongoing", lane: 0 },
      ],
    );
  });
});
