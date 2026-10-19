import assert from "node:assert/strict";
import test from "node:test";
import { projectEditorTime, readIntakeEditorClock, resolveEditorTime } from "../../apps/web/src/lib/calendar/event-editor-time";
import { applyStaffLineupTimings, readStaffLineupTimings, type SlotFormRow } from "../../apps/web/src/lib/calendar/event-lineup-adapters";
import type { EventIntakeLocalTime, EventIntakePatch } from "../../packages/api-contracts/src/event-intake";

test("projects Los Angeles 23:00 into Indianapolis on the following day", () => {
  assert.equal(projectEditorTime({ instant: Date.UTC(2026, 9, 16, 6), timezone: "America/Indianapolis" }).value, "2026-10-16T02:00");
});

test("requires an explicit repeated-hour choice and projects both occurrences", () => {
  assert.equal(resolveEditorTime({ value: "2026-11-01T01:30", timezone: "America/New_York" }).kind, "ambiguous");
  assert.deepEqual(resolveEditorTime({ value: "2026-11-01T01:30", timezone: "America/New_York" }), { kind: "ambiguous", instants: [Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)] });
  assert.deepEqual(resolveEditorTime({ value: "2026-11-01T01:30", timezone: "America/New_York", occurrence: "later" }), { kind: "resolved", instant: Date.UTC(2026, 10, 1, 6, 30) });
  for (const [hour, occurrence] of [[5, "earlier"], [6, "later"]] as const) {
    assert.deepEqual(projectEditorTime({ instant: Date.UTC(2026, 10, 1, hour, 30, 45, 123), timezone: "America/New_York" }), { value: "2026-11-01T01:30", occurrence });
    assert.deepEqual(resolveEditorTime({ value: "2026-11-01T01:30", timezone: "America/New_York", occurrence }), { kind: "resolved", instant: Date.UTC(2026, 10, 1, hour, 30) });
  }
});

test("keeps a DST gap distinct from invalid and empty clocks", () => {
  assert.equal(resolveEditorTime({ value: "2026-03-08T02:30", timezone: "America/New_York" }).kind, "gap");
  assert.deepEqual(resolveEditorTime({ value: "", timezone: "invalid" }), { kind: "empty" });
  for (const value of [" ", "2026-10-15", "2026-10-15T", "2026-02-30T12:00", "2026-10-15T24:00", "2026-10-15T12:60", "2026-10-15T12:00:00"]) {
    assert.deepEqual(resolveEditorTime({ value, timezone: "America/Indianapolis" }), { kind: "invalid" });
  }
  for (const timezone of ["", "invalid", "+05:00"]) {
    assert.deepEqual(resolveEditorTime({ value: "2026-10-15T12:00", timezone }), { kind: "invalid" });
  }
});

test("resolves a complete input in its explicit zone", () => {
  assert.deepEqual(resolveEditorTime({ value: "2026-10-15T23:00", timezone: "America/Los_Angeles" }), { kind: "resolved", instant: Date.UTC(2026, 9, 16, 6) });
});

test("missing source context retains the unresolved source clock and identity", () => {
  const local: EventIntakeLocalTime = { time: "23:00", dayOffset: 1, occurrence: "later" };
  for (const fields of [{}, { timezone: "America/Los_Angeles" }, { eventDate: "2026-10-15" }, { eventDate: null, timezone: null }] satisfies EventIntakePatch[]) {
    const before = structuredClone(fields);
    const result = readIntakeEditorClock({ fields, local });
    assert.deepEqual(result, { kind: "unresolved", date: fields.eventDate, timezone: fields.timezone, local });
    if (result.kind === "unresolved") assert.equal(result.local, local);
    assert.deepEqual(fields, before);
  }
});

test("unresolved gaps and repeated hours keep source context", () => {
  for (const [eventDate, local] of [["2026-03-08", { time: "02:30" }], ["2026-11-01", { time: "01:30" }], ["invalid", { time: "12:00" }]] satisfies [string, EventIntakeLocalTime][]) {
    const fields: EventIntakePatch = { eventDate, timezone: "America/New_York" };
    assert.deepEqual(readIntakeEditorClock({ fields, local }), { kind: "unresolved", date: eventDate, timezone: fields.timezone, local });
  }
});

test("resolves intake source dates, offsets and occurrences without mutation", () => {
  const fields: EventIntakePatch = { eventDate: "2026-10-31", timezone: "America/New_York" };
  const local: EventIntakeLocalTime = { time: "01:30", dayOffset: 1, occurrence: "later" };
  assert.deepEqual(readIntakeEditorClock({ fields, local }), { kind: "resolved", instant: Date.UTC(2026, 10, 1, 6, 30) });
  assert.deepEqual(local, { time: "01:30", dayOffset: 1, occurrence: "later" });
  for (const missing of [undefined, null]) assert.deepEqual(readIntakeEditorClock({ fields, local: missing }), { kind: "empty" });
  assert.deepEqual(readIntakeEditorClock({ fields: { ...fields, timeTba: true }, local }), { kind: "empty" });
  assert.deepEqual(readIntakeEditorClock({ fields: { eventDate: "2026-10-31", timeTba: true }, local: null }), { kind: "empty" });
});

test("display projection leaves untouched millisecond instants authoritative", () => {
  const instant = Date.UTC(2026, 9, 16, 6, 0, 45, 123);
  const rows: SlotFormRow[] = [{ id: "precise", position: 0, offsetMinutes: "0", durationMinutes: "60", personSlug: "guest", displayLabel: "Guest", roleLabel: "DJ", startAtOverride: instant, endAtOverride: instant + 3_620_333 }];
  const before = structuredClone(rows);
  const timings = readStaffLineupTimings(rows, instant);
  for (const timezone of ["America/Indianapolis", "America/Los_Angeles", "UTC"]) {
    assert.ok(projectEditorTime({ instant, timezone }).value);
    assert.deepEqual(applyStaffLineupTimings(rows, timings, instant), before);
    assert.equal(timings[0]?.startAt, instant);
    assert.equal(timings[0]?.endAt, instant + 3_620_333);
  }
  assert.deepEqual(rows, before);
});
