import assert from "node:assert/strict";
import { it } from "node:test";
import { inferLineupEnds } from "../src/lineup-timing";

it("retains explicit ends, including authored gaps and overlaps", () => {
  const rows = [{ startAt: 10, endAt: 15 }, { startAt: 20, endAt: 35 }, { startAt: 30 }];
  assert.deepEqual(inferLineupEnds(rows, 40).map(row => row.endAt), [15, 35, 40]);
});
it("infers missing ends from the immediate next start and the final event end", () => {
  assert.deepEqual(inferLineupEnds([{ startAt: 10 }, { startAt: 20 }, { startAt: 30 }], 40).map(row => row.endAt), [20, 30, 40]);
});
it("keeps a final end unknown when the event has no valid later end", () => {
  for (const end of [undefined, 10, 5, NaN, Infinity]) assert.equal(inferLineupEnds([{ startAt: 10 }], end)[0]?.endAt, undefined);
});
it("treats an untimed row as a barrier without inventing a duration", () => {
  assert.deepEqual(inferLineupEnds([{ startAt: 10 }, {}, { startAt: 30 }], 40).map(row => row.endAt), [undefined, undefined, 40]);
});
it("does not infer across equal starts or an adjacent equal-time successor", () => {
  assert.deepEqual(inferLineupEnds([{ startAt: 10 }, { startAt: 20 }, { startAt: 20 }, { startAt: 30 }], 40).map(row => row.endAt), [undefined, undefined, undefined, 40]);
});
it("keeps locally out-of-order starts unknown without blocking earlier ordered rows", () => {
  assert.deepEqual(inferLineupEnds([{ startAt: 10 }, { startAt: 20 }, { startAt: 40 }, { startAt: 30 }], 50).map(row => row.endAt), [20, undefined, undefined, undefined]);
});
it("handles absolute overnight instants without resetting at midnight", () => {
  const start = Date.UTC(2026, 10, 6, 23), midnight = Date.UTC(2026, 10, 7), end = Date.UTC(2026, 10, 7, 1);
  assert.deepEqual(inferLineupEnds([{ startAt: start }, { startAt: midnight }], end).map(row => row.endAt), [midnight, end]);
});
it("returns derived copies without mutating authored rows or ordering", () => {
  const rows = Object.freeze([Object.freeze({ key: "a", startAt: 10 }), Object.freeze({ key: "b", startAt: 20 })]);
  const projected = inferLineupEnds(rows, 30);
  assert.deepEqual(projected, [{ key: "a", startAt: 10, endAt: 20 }, { key: "b", startAt: 20, endAt: 30 }]);
  assert.deepEqual(rows, [{ key: "a", startAt: 10 }, { key: "b", startAt: 20 }]);
  assert.notEqual(projected, rows); assert.notEqual(projected[0], rows[0]);
});
it("does not use nonfinite starts as inferred boundaries", () => {
  assert.deepEqual(inferLineupEnds([{ startAt: NaN }, { startAt: 20 }], 30).map(row => row.endAt), [undefined, undefined]);
  assert.deepEqual(inferLineupEnds([{ startAt: 10 }, { startAt: Infinity }], 30).map(row => row.endAt), [undefined, undefined]);
});

it("does not use a next-start timestamp repeated elsewhere in the lineup", () => {
  const rows = [{ startAt: 10 }, { startAt: 20 }, { startAt: 30 }, { startAt: 20 }, { startAt: 40 }];
  assert.equal(inferLineupEnds(rows, 50)[0]?.endAt, undefined);
});
