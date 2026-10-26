import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { localDayBands, scheduleGeometry, timeToX } from "../../apps/web/src/lib/timeline/geometry";

describe("timeline geometry", () => {
  it("maps one elapsed hour to exactly 100 pixels in either direction", () => {
    assert.equal(timeToX({ instant: 3_600_000, origin: 0, pixelsPerHour: 100 }), 100);
    assert.equal(timeToX({ instant: 0, origin: 3_600_000, pixelsPerHour: 100 }), -100);
  });

  it("keeps a midnight-crossing event as one authored bar", () => {
    assert.deepEqual(scheduleGeometry({
      schedule: { kind: "timed", startAt: Date.parse("2026-10-26T23:00Z"), endAt: Date.parse("2026-10-27T02:00Z") },
      origin: Date.parse("2026-10-26T22:00Z"), pixelsPerHour: 100,
    }), { kind: "bar", x: 100, width: 300 });
  });

  it("keeps missing, reversed and invalid ends as markers without inventing width", () => {
    for (const schedule of [
      { kind: "open_end", startAt: 3_600_000 },
      { kind: "timed", startAt: 3_600_000, endAt: 0 },
      { kind: "timed", startAt: 3_600_000, endAt: 3_600_000 },
      { kind: "timed", startAt: 3_600_000, endAt: Number.NaN },
      { kind: "timed", startAt: 3_600_000, endAt: Infinity },
    ] satisfies Parameters<typeof scheduleGeometry>[0]["schedule"][]) {
      assert.deepEqual(scheduleGeometry({ schedule, origin: 0, pixelsPerHour: 100 }), { kind: "marker", x: 100 });
    }
    assert.equal(scheduleGeometry({ schedule: { kind: "open_end", startAt: Number.NaN }, origin: 0, pixelsPerHour: 100 }), null);
  });

  it("retains the authored date rather than shifting date-only items to the viewer's day", () => {
    assert.deepEqual(scheduleGeometry({ schedule: { kind: "date_only", eventDate: "2026-10-26" }, origin: 0, pixelsPerHour: 100 }), {
      kind: "untimed", eventDate: "2026-10-26",
    });
  });

  it("finds Indianapolis midnight boundaries rather than UTC midnight", () => {
    assert.deepEqual(localDayBands({ startAt: Date.parse("2026-10-27T03:00Z"), endAt: Date.parse("2026-10-27T05:00Z"), timeZone: "America/Indiana/Indianapolis" }), [
      { startAt: Date.parse("2026-10-26T04:00Z"), endAt: Date.parse("2026-10-27T04:00Z"), label: "Oct 26, 2026" },
      { startAt: Date.parse("2026-10-27T04:00Z"), endAt: Date.parse("2026-10-28T04:00Z"), label: "Oct 27, 2026" },
    ]);
  });

  it("gives New York's repeated hour distinct positions on a 25-hour day", () => {
    const origin = Date.parse("2026-11-01T04:00Z");
    assert.deepEqual(localDayBands({ startAt: origin, endAt: Date.parse("2026-11-02T05:00Z"), timeZone: "America/New_York" }), [
      { startAt: origin, endAt: Date.parse("2026-11-02T05:00Z"), label: "Nov 1, 2026" },
    ]);
    assert.equal(timeToX({ instant: Date.parse("2026-11-01T05:30Z"), origin, pixelsPerHour: 100 }), 150);
    assert.equal(timeToX({ instant: Date.parse("2026-11-01T06:30Z"), origin, pixelsPerHour: 100 }), 250);
  });

  it("ends New York's shortened day after 23 elapsed hours", () => {
    const startAt = Date.parse("2026-03-08T05:00Z");
    const endAt = Date.parse("2026-03-09T04:00Z");
    assert.deepEqual(localDayBands({ startAt, endAt, timeZone: "America/New_York" }), [
      { startAt, endAt, label: "Mar 8, 2026" },
    ]);
    assert.equal(timeToX({ instant: endAt, origin: startAt, pixelsPerHour: 100 }), 2300);
  });

  it("starts a day at its first real instant when Havana skips midnight", () => {
    const startAt = Date.parse("2026-03-08T05:00Z");
    const endAt = Date.parse("2026-03-09T04:00Z");
    assert.deepEqual(localDayBands({ startAt, endAt, timeZone: "America/Havana" }), [
      { startAt, endAt, label: "Mar 8, 2026" },
    ]);
  });

  it("skips Samoa's missing calendar date without a zero-width band", () => {
    assert.deepEqual(localDayBands({
      startAt: Date.parse("2011-12-29T10:00Z"), endAt: Date.parse("2011-12-31T10:00Z"), timeZone: "Pacific/Apia",
    }), [
      { startAt: Date.parse("2011-12-29T10:00Z"), endAt: Date.parse("2011-12-30T10:00Z"), label: "Dec 29, 2011" },
      { startAt: Date.parse("2011-12-30T10:00Z"), endAt: Date.parse("2011-12-31T10:00Z"), label: "Dec 31, 2011" },
    ]);
  });

  it("returns no bands for an empty, reversed or invalid range", () => {
    for (const [startAt, endAt] of [[0, 0], [1, 0], [Number.NaN, 1], [0, Infinity]]) {
      assert.deepEqual(localDayBands({ startAt, endAt, timeZone: "UTC" }), []);
    }
  });
});
