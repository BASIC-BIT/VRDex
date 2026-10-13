import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  changeLineupDuration,
  generateLineupTimings,
  getLineupEndAt,
  getLineupEndConflict,
  insertLineupSlot,
  removeLineupSlot,
  shiftLineupStart,
  type LineupEditResult,
  type LineupTimingRow,
} from "../../apps/web/src/lib/calendar/event-lineup-timing";

const base = Date.parse("2026-10-13T23:00:00Z");
const personA = { profileId: "person-a" };
const personB = { profileId: "person-b" };
type AssignedRow = LineupTimingRow & { person: { profileId: string }; streamUrl: string };
const rows: AssignedRow[] = [
  { key: "a", startAt: base, endAt: base + 3_600_000, person: personA, streamUrl: "https://example.com/a" },
  { key: "b", startAt: base + 4_200_000, endAt: base + 7_800_000, person: personB, streamUrl: "https://example.com/b" },
];

function editedRows<T>(result: LineupEditResult<T>): T[] {
  if (!result.ok) assert.fail(result.reason);
  return result.rows;
}

function assertAssignments(actual: typeof rows): void {
  assert.deepEqual(actual.map((row) => row.key), ["a", "b"]);
  assert.equal(actual[0]?.person, personA);
  assert.equal(actual[1]?.person, personB);
  assert.deepEqual(actual.map((row) => row.streamUrl), ["https://example.com/a", "https://example.com/b"]);
}

describe("lineup generation", () => {
  it("uses supplied stable keys and exact elapsed durations", () => {
    assert.deepEqual(editedRows(generateLineupTimings({ startAt: base + 123, count: 2, durationMinutes: 15, keys: ["a", "b"] })), [
      { key: "a", startAt: base + 123, endAt: base + 900_123 },
      { key: "b", startAt: base + 900_123, endAt: base + 1_800_123 },
    ]);
  });

  it("accepts eighty rows and the maximum duration", () => {
    const result = editedRows(generateLineupTimings({ startAt: base, count: 80, durationMinutes: 1_440, keys: Array.from({ length: 80 }, (_, index) => `slot-${index}`) }));
    assert.equal(result.length, 80);
    assert.equal(result[79]?.endAt, base + 6_912_000_000);
  });

  it("rejects invalid counts and missing keys", () => {
    for (const count of [0, -1, 1.5, NaN, Infinity]) {
      assert.deepEqual(generateLineupTimings({ startAt: base, count, durationMinutes: 60, keys: ["a"] }), { ok: false, reason: "invalid_count" });
    }
    assert.deepEqual(generateLineupTimings({ startAt: base, count: 2, durationMinutes: 60, keys: ["a"] }), { ok: false, reason: "invalid_count" });
    assert.deepEqual(generateLineupTimings({ startAt: base, count: 81, durationMinutes: 60, keys: Array.from({ length: 81 }, (_, index) => `${index}`) }), { ok: false, reason: "slot_limit" });
  });

  it("requires a finite start boundary", () => {
    assert.deepEqual(generateLineupTimings({ startAt: NaN, count: 1, durationMinutes: 60, keys: ["a"] }), { ok: false, reason: "missing_boundary" });
  });
});

describe("lineup insertion", () => {
  it("inserts fifteen minutes and preserves the following ten-minute gap", () => {
    const snapshot = structuredClone(rows);
    const newRow: AssignedRow = { key: "new", person: { profileId: "new-person" }, streamUrl: "https://example.com/new" };
    const result = editedRows(insertLineupSlot({ rows, index: 1, row: newRow, durationMinutes: 15, eventStartAt: base }));
    assert.deepEqual(result.map(({ key, startAt, endAt }) => ({ key, startAt, endAt })), [
      { key: "a", startAt: base, endAt: base + 3_600_000 },
      { key: "new", startAt: base + 3_600_000, endAt: base + 4_500_000 },
      { key: "b", startAt: base + 5_100_000, endAt: base + 8_700_000 },
    ]);
    assertAssignments([result[0], result[2]]);
    assert.equal(result[1]?.person, newRow.person);
    assert.equal(result[1]?.streamUrl, newRow.streamUrl);
    assert.deepEqual(rows, snapshot);
    assert.equal("startAt" in newRow, false);
  });

  it("inserts before the first row at the event start while preserving its gap", () => {
    const result = editedRows(insertLineupSlot({ rows, index: 0, row: { ...rows[0], key: "new" }, durationMinutes: 15, eventStartAt: base - 600_000 }));
    assert.equal(result[0]?.startAt, base - 600_000);
    assert.equal(result[0]?.endAt, base + 300_000);
    assert.equal(result[1]?.startAt, base + 900_000);
    assert.equal(result[2]?.startAt, base + 5_100_000);
  });

  it("inserts after the last row at its known end", () => {
    const result = editedRows(insertLineupSlot({ rows, index: 2, row: { ...rows[0], key: "new" }, durationMinutes: 15 }));
    assert.equal(result[2]?.startAt, base + 7_800_000);
    assert.equal(result[2]?.endAt, base + 8_700_000);
    assert.deepEqual(result.slice(0, 2), rows);
  });

  it("can generate a first slot in an empty lineup without guessing a start", () => {
    assert.deepEqual(editedRows(insertLineupSlot({ rows: [], index: 0, row: { key: "a" }, durationMinutes: 15, eventStartAt: 0 })), [{ key: "a", startAt: 0, endAt: 900_000 }]);
    assert.deepEqual(insertLineupSlot({ rows: [], index: 0, row: { key: "a" }, durationMinutes: 15 }), { ok: false, reason: "missing_boundary" });
  });

  it("requires the immediate preceding end instead of guessing an unknown duration", () => {
    assert.deepEqual(insertLineupSlot({ rows: [{ key: "a", startAt: base }], index: 1, row: { key: "new" }, durationMinutes: 15, eventStartAt: base }), { ok: false, reason: "missing_boundary" });
    assert.deepEqual(insertLineupSlot({ rows: [{ key: "a" }], index: 1, row: { key: "new" }, durationMinutes: 15, eventStartAt: base }), { ok: false, reason: "missing_boundary" });
    assert.deepEqual(insertLineupSlot({ rows, index: 0, row: { ...rows[0], key: "new" }, durationMinutes: 15 }), { ok: false, reason: "missing_boundary" });
  });

  it("preserves untimed rows and shifts only known fields on partial rows", () => {
    const partial: LineupTimingRow[] = [rows[0], { key: "untimed" }, { key: "start-only", startAt: base + 4_200_000 }, { key: "end-only", endAt: base + 7_800_000 }];
    const result = editedRows(insertLineupSlot({ rows: partial, index: 1, row: { key: "new" }, durationMinutes: 15 }));
    assert.deepEqual(result.slice(2), [{ key: "untimed" }, { key: "start-only", startAt: base + 5_100_000 }, { key: "end-only", endAt: base + 8_700_000 }]);
    assert.equal("endAt" in result[3], false);
    assert.equal("startAt" in result[4], false);
  });

  it("advances fifteen elapsed minutes across the fall DST transition", () => {
    const dstStart = Date.parse("2026-11-01T05:55:00Z");
    const result = editedRows(insertLineupSlot({ rows: [{ key: "later", startAt: Date.parse("2026-11-01T06:10:00Z"), endAt: Date.parse("2026-11-01T06:30:00Z") }], index: 0, row: { key: "new" }, durationMinutes: 15, eventStartAt: dstStart }));
    assert.equal(result[0]?.endAt, Date.parse("2026-11-01T06:10:00Z"));
    assert.equal(result[1]?.startAt, Date.parse("2026-11-01T06:25:00Z"));
    assert.equal(result[1]?.endAt, Date.parse("2026-11-01T06:45:00Z"));
  });

  it("rejects adding an eighty-first slot", () => {
    assert.deepEqual(insertLineupSlot({ rows: Array.from({ length: 80 }, (_, index) => ({ key: `${index}` })), index: 0, row: { key: "new" }, durationMinutes: 15, eventStartAt: base }), { ok: false, reason: "slot_limit" });
  });

  it("rejects positions outside the lineup", () => {
    for (const index of [-1, 3, 0.5, NaN]) {
      assert.deepEqual(insertLineupSlot({ rows, index, row: { ...rows[0], key: "new" }, durationMinutes: 15, eventStartAt: base }), { ok: false, reason: "missing_row" });
    }
  });
});

describe("lineup duration changes", () => {
  for (const { durationMinutes, endAt, laterStartAt, laterEndAt } of [
    { durationMinutes: 45, endAt: base + 2_700_000, laterStartAt: base + 3_300_000, laterEndAt: base + 6_900_000 },
    { durationMinutes: 75, endAt: base + 4_500_000, laterStartAt: base + 5_100_000, laterEndAt: base + 8_700_000 },
  ]) {
    it(`changes A to ${durationMinutes} minutes while preserving assignments and gaps`, () => {
      const snapshot = structuredClone(rows);
      const result = editedRows(changeLineupDuration(rows, "a", durationMinutes));
      assert.equal(result[0]?.endAt, endAt);
      assert.equal(result[1]?.startAt, laterStartAt);
      assert.equal(result[1]?.endAt, laterEndAt);
      assertAssignments(result);
      assert.deepEqual(rows, snapshot);
    });
  }

  it("does not move rows preceding the edited row", () => {
    const result = editedRows(changeLineupDuration(rows, "b", 15));
    assert.deepEqual(result[0], rows[0]);
    assert.equal(result[1]?.endAt, base + 5_100_000);
  });

  it("requires both old boundaries and a positive old duration", () => {
    for (const row of [{ key: "a" }, { key: "a", startAt: base }, { key: "a", endAt: base }, { key: "a", startAt: base, endAt: base }, { key: "a", startAt: base, endAt: base - 1 }]) {
      assert.deepEqual(changeLineupDuration([row], "a", 15), { ok: false, reason: "missing_duration" });
    }
    assert.deepEqual(changeLineupDuration(rows, "missing", 15), { ok: false, reason: "missing_row" });
  });

  it("preserves subminute imported duration differences and partial later fields", () => {
    const result = editedRows(changeLineupDuration([{ key: "a", startAt: base + 123, endAt: base + 60_456 }, { key: "untimed" }, { key: "later", startAt: base + 120_789 }], "a", 1));
    assert.deepEqual(result, [{ key: "a", startAt: base + 123, endAt: base + 60_123 }, { key: "untimed" }, { key: "later", startAt: base + 120_456 }]);
  });
});

describe("lineup removal and start shifting", () => {
  it("removes the insertion to restore original rows and gap", () => {
    const inserted = editedRows(insertLineupSlot({ rows, index: 1, row: { ...rows[0], key: "new" }, durationMinutes: 15 }));
    assert.deepEqual(editedRows(removeLineupSlot(inserted, "new")), rows);
    assert.equal(inserted.length, 3);
  });

  it("removes a known duration and shifts later fields by that exact duration", () => {
    const result = editedRows(removeLineupSlot(rows, "a"));
    assert.deepEqual(result, [{ ...rows[1], startAt: base + 600_000, endAt: base + 4_200_000 }]);
    assert.equal(result[0]?.person, personB);
    assert.equal(rows.length, 2);
  });

  it("removes untimed and partial rows without fabricating a delta", () => {
    for (const row of [{ key: "unknown" }, { key: "unknown", startAt: base }, { key: "unknown", endAt: base }]) {
      const input = [rows[0], row, rows[1]];
      assert.deepEqual(editedRows(removeLineupSlot(input, "unknown")), rows);
      assert.equal(input.length, 3);
    }
    assert.deepEqual(removeLineupSlot(rows, "missing"), { ok: false, reason: "missing_row" });
  });

  it("shifts all known timestamps while retaining milliseconds and unknown fields", () => {
    const input: LineupTimingRow[] = [{ key: "a", startAt: base + 123, endAt: base + 60_456 }, { key: "untimed" }, { key: "start-only", startAt: base + 789 }, { key: "end-only", endAt: base + 987 }];
    const snapshot = structuredClone(input);
    const result = shiftLineupStart(input, -900_000);
    assert.deepEqual(result, [{ key: "a", startAt: base - 899_877, endAt: base - 839_544 }, { key: "untimed" }, { key: "start-only", startAt: base - 899_211 }, { key: "end-only", endAt: base - 899_013 }]);
    assert.deepEqual(input, snapshot);
    assert.notEqual(result, input);
    assertAssignments(shiftLineupStart(rows, 900_000));
    assert.deepEqual(shiftLineupStart([], 900_000), []);
  });
});

it("rejects invalid durations consistently before editing", () => {
  for (const durationMinutes of [0, -1, 0.5, 1_441, NaN, Infinity]) {
    assert.deepEqual(generateLineupTimings({ startAt: base, count: 1, durationMinutes, keys: ["a"] }), { ok: false, reason: "invalid_duration" });
    assert.deepEqual(insertLineupSlot({ rows, index: 1, row: { ...rows[0], key: "new" }, durationMinutes }), { ok: false, reason: "invalid_duration" });
    assert.deepEqual(changeLineupDuration(rows, "a", durationMinutes), { ok: false, reason: "invalid_duration" });
  }
});

describe("lineup end conflicts", () => {
  it("reports the latest end and ignores untimed performers when offering a target", () => {
    assert.deepEqual(getLineupEndConflict(base + 7_000_000, [rows[1], { key: "untimed" }, rows[0]]), { latestKnownAt: base + 7_800_000, lineupEndAt: base + 7_800_000 });
  });

  it("reports an overrun from a known start without guessing its unknown end", () => {
    assert.deepEqual(getLineupEndConflict(base + 7_000_000, [...rows, { key: "unknown", startAt: base + 8_000_000 }]), { latestKnownAt: base + 8_000_000 });
  });

  it("does not offer an incomplete lineup target even when a known end overruns", () => {
    assert.deepEqual(getLineupEndConflict(base + 7_000_000, [...rows, { key: "unknown", startAt: base + 600_000 }]), { latestKnownAt: base + 7_800_000 });
    assert.deepEqual(getLineupEndConflict(base, [{ key: "end-only", endAt: base + 900_000 }]), { latestKnownAt: base + 900_000 });
  });

  it("has no conflict without a boundary, known timing, or a strict overrun", () => {
    assert.equal(getLineupEndConflict(undefined, rows), undefined);
    assert.equal(getLineupEndConflict(base, []), undefined);
    assert.equal(getLineupEndConflict(base, [{ key: "untimed" }]), undefined);
    assert.equal(getLineupEndConflict(base + 7_800_000, rows), undefined);
  });
});


describe("legitimate derived lineup ends", () => {
  it("uses the exact latest end across complete rows and untimed performers", () => {
    assert.equal(getLineupEndAt([{ ...rows[1], endAt: base + 7_800_123 }, { key: "untimed" }, rows[0]]), base + 7_800_123);
  });

  it("does not infer missing ends or starts from other rows", () => {
    assert.equal(getLineupEndAt([...rows, { key: "partial", startAt: base + 8_000_000 }]), undefined);
    assert.equal(getLineupEndAt([{ key: "end-only", endAt: base + 8_000_000 }]), undefined);
  });

  it("does not derive an end from empty, untimed, or invalid ranges", () => {
    assert.equal(getLineupEndAt([]), undefined);
    assert.equal(getLineupEndAt([{ key: "untimed" }]), undefined);
    for (const row of [{ key: "a", startAt: base, endAt: base }, { key: "a", startAt: base, endAt: base - 1 }, { key: "a", startAt: NaN, endAt: base }, { key: "a", startAt: base, endAt: Infinity }]) {
      assert.equal(getLineupEndAt([row]), undefined);
    }
  });
});
