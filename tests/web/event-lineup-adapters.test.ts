import assert from "node:assert/strict";
import test from "node:test";
import { applyIntakeLineupTimings, applyStaffLineupTimings, changeStaffSlotOffset, readIntakeLineupTimings, readStaffLineupTimings, type SlotFormRow } from "../../apps/web/src/lib/calendar/event-lineup-adapters";
import { formatLineupTimeRange } from "../../apps/web/src/lib/calendar/event-lineup-display";
import { shiftLineupStart } from "../../apps/web/src/lib/calendar/event-lineup-timing";
import { acceptIntakeSuggestion, restoreIntakeTiming } from "../../apps/web/src/lib/calendar/event-intake-suggestions";
import type { EventIntakePatch } from "../../packages/api-contracts/src/event-intake";

test("staff timing retains exact instants and metadata after an unchanged roundtrip and a shift", () => {
  const rows: SlotFormRow[] = [{ id: "a", position: 0, offsetMinutes: "0", durationMinutes: "60", personSlug: "guest", displayLabel: "Guest", roleLabel: "DJ", selectedStreamId: "vrcdn:guest", startAtOverride: 1791936000123, endAtOverride: 1791939600456 }];
  const timings = readStaffLineupTimings(rows, 1791936000000);
  assert.deepEqual(timings, [{ key: "a", startAt: 1791936000123, endAt: 1791939600456 }]);
  assert.deepEqual(applyStaffLineupTimings(rows, timings, 1791936000000), rows);
  const moved = applyStaffLineupTimings(rows, shiftLineupStart(timings, 900000), 1791936000000);
  assert.equal(moved[0]?.startAtOverride, 1791936900123);
  assert.equal(moved[0]?.endAtOverride, 1791940500456);
  assert.equal(moved[0]?.selectedStreamId, "vrcdn:guest");
  assert.equal(moved[0]?.personSlug, "guest");
});

test("an unchanged partial intake row survives timing roundtrip", () => {
  const fields: EventIntakePatch = { eventDate: "2026-10-13", timezone: "America/New_York", lineup: [{ clientKey: "partial", position: 0, performerLabel: "Guest", start: { time: "23:00" } }] };
  const timings = readIntakeLineupTimings(fields);
  assert.equal(timings[0]?.endAt, undefined);
  assert.deepEqual(applyIntakeLineupTimings(fields, timings), fields);
});

test("intake shift crosses midnight and retains both repeated-hour occurrences", () => {
  const fields: EventIntakePatch = { eventDate: "2026-11-01", timezone: "America/New_York", lineup: [
    { clientKey: "early", position: 0, performerLabel: "Early", start: { time: "01:15", occurrence: "earlier" }, end: { time: "01:30", occurrence: "earlier" } },
    { clientKey: "late", position: 1, performerLabel: "Late", start: { time: "01:15", occurrence: "later" }, end: { time: "01:30", occurrence: "later" } },
    { clientKey: "night", position: 2, start: { time: "23:50" }, end: { time: "00:00", dayOffset: 1 } },
  ] };
  const moved = applyIntakeLineupTimings(fields, shiftLineupStart(readIntakeLineupTimings(fields), 900000));
  assert.deepEqual(moved.lineup?.map(row => row.start), [{ time: "01:30", dayOffset: 0, occurrence: "earlier" }, { time: "01:30", dayOffset: 0, occurrence: "later" }, { time: "00:05", dayOffset: 1 }]);
  assert.deepEqual(readIntakeLineupTimings(moved).map(row => row.startAt), [Date.UTC(2026,10,1,5,30), Date.UTC(2026,10,1,6,30), Date.UTC(2026,10,2,5,5)]);
});

test("intake unresolved clocks survive and out-of-contract transformations fail atomically", () => {
  const fields: EventIntakePatch = { eventDate: "2026-11-01", timezone: "America/New_York", lineup: [
    { clientKey: "ambiguous", position: 0, performerLabel: "Guest", start: { time: "01:30" } },
    { clientKey: "limit", position: 1, start: { time: "23:30", dayOffset: 7 }, end: { time: "23:45", dayOffset: 7 } },
  ] };
  const timings = readIntakeLineupTimings(fields);
  assert.deepEqual(timings[0], { key: "ambiguous" });
  assert.throws(() => applyIntakeLineupTimings(fields, shiftLineupStart(timings, 3600000)), RangeError);
  assert.equal(fields.lineup?.[1]?.start?.dayOffset, 7);
  const reordered = applyIntakeLineupTimings(fields, [timings[1]!, { key: "new" }, timings[0]!]);
  assert.deepEqual(reordered.lineup?.map(row => [row.clientKey, row.position]), [["limit",0],["new",1],["ambiguous",2]]);
  assert.deepEqual(reordered.lineup?.[2]?.start, { time: "01:30" });
});

test("removing an untimed row does not restore it from a Time TBA backup", () => {
  const backup: EventIntakePatch = { eventDate: "2026-10-13", timezone: "UTC", lineup: [{ clientKey: "keep", position: 0, start: { time: "20:00" } }, { clientKey: "remove", position: 1, start: { time: "21:00" } }] };
  const current = applyIntakeLineupTimings({ ...backup, timeTba: true, lineup: backup.lineup?.map(row => ({ ...row, start: null })) }, [{ key: "keep" }]);
  assert.deepEqual(restoreIntakeTiming(current, backup).lineup?.map(row => row.clientKey), ["keep"]);
});


for (const cascade of [false, true]) test(`offset-only edits retain exact duration through invalid input after cascade=${cascade}`, () => {
  const startAt = Date.UTC(2027, 9, 15, 20, 0, 10, 123);
  let row: SlotFormRow = { id: "precise", offsetMinutes: "0", durationMinutes: "60", personSlug: "guest", displayLabel: "Guest", roleLabel: "DJ", startAtOverride: startAt, endAtOverride: startAt + 3_620_333 };
  if (cascade) row = applyStaffLineupTimings([row], shiftLineupStart(readStaffLineupTimings([row], startAt), 900_000), startAt)[0]!;
  const invalid = changeStaffSlotOffset(row, "bad", startAt);
  assert.deepEqual(readStaffLineupTimings([invalid], startAt), [{ key: "precise" }]);
  const cleared = changeStaffSlotOffset(invalid, "", startAt);
  const corrected = changeStaffSlotOffset(cleared, "15", startAt);
  assert.deepEqual(readStaffLineupTimings([corrected], startAt), [{ key: "precise", startAt: startAt + 900_000, endAt: startAt + 900_000 + 3_620_333 }]);
  assert.equal(corrected.personSlug, "guest");
  assert.equal(row.endAtOverride! - row.startAtOverride!, 3_620_333);
});

test("offset-only edits do not invent an unknown end", () => {
  const row: SlotFormRow = { id: "partial", offsetMinutes: "0", durationMinutes: "", personSlug: "", displayLabel: "Guest", roleLabel: "DJ", startAtOverride: 1_000 };
  assert.deepEqual(readStaffLineupTimings([changeStaffSlotOffset(row, "15", 1_000)], 1_000), [{ key: "partial", startAt: 901_000 }]);
});


test("source-zone acceptance preserves local rollover and source evidence", () => {
  const fields: EventIntakePatch = { eventDate: "2026-10-16", timezone: "America/Indiana/Indianapolis", tentative: { eventDate: "2026-10-15", timezone: "America/Los_Angeles", start: { time: "23:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 1 }, doors: { time: "22:30", dayOffset: 0 }, lineup: [{ clientKey: "import", position: 0, performerLabel: "Guest", start: { time: "23:00", dayOffset: 0 }, end: { time: "00:00", dayOffset: 1 } }] }, questions: ["lineup: identity remains unconfirmed"] };
  let next = fields;
  for (const key of ["start", "end", "doors", "lineup"] as const) {
    const accepted = acceptIntakeSuggestion({ fields: next, acceptance: { key, proposalDate: next.tentative?.eventDate } });
    assert.ok(accepted); next = accepted;
  }
  assert.deepEqual(next.start, { time: "02:00", dayOffset: 0 });
  assert.deepEqual(next.end, { time: "05:00", dayOffset: 0 });
  assert.deepEqual(next.doors, { time: "01:30", dayOffset: 0 });
  assert.deepEqual(next.lineup?.[0]?.start, next.start);
  assert.deepEqual(next.lineup?.[0]?.end, { time: "03:00", dayOffset: 0 });
  assert.deepEqual(next.questions, fields.questions);
});
test("unresolved source clocks cannot be accepted as known local instants", () => {
  for (const tentative of [
    { eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30", dayOffset: 0 } },
    { eventDate: "2026-03-08", timezone: "America/New_York", start: { time: "02:30", dayOffset: 0 } },
    { eventDate: "2026-10-15", start: { time: "23:00", dayOffset: 0 } },
  ]) {
    const fields = { eventDate: tentative.eventDate, tentative };
    assert.equal(acceptIntakeSuggestion({ fields, acceptance: { key: "start", proposalDate: tentative.eventDate } }), null);
  }
});

test("lineup repeats display their own offset at each instant", () => {
  assert.equal(formatLineupTimeRange({ startAt: Date.UTC(2026, 10, 1, 5, 30), endAt: Date.UTC(2026, 10, 1, 6, 30), timezone: "America/New_York" }), "01:30 GMT-4 - 01:30 GMT-5");
});
test("accepting source fields in either order preserves resolved instants", () => {
  const source = { eventDate: "2026-10-15", timezone: "America/Los_Angeles", start: { time: "23:00", dayOffset: 0 }, end: { time: "01:00", dayOffset: 1 } };
  for (const order of [["start", "end", "eventDate", "timezone"], ["timezone", "eventDate", "end", "start"], ["eventDate", "start", "timezone", "end"]] as const) {
    let fields: EventIntakePatch = { eventDate: "2026-10-16", timezone: "America/Indiana/Indianapolis", tentative: source, questions: ["keep source"] };
    for (const key of order) {
      const next = acceptIntakeSuggestion({ fields, acceptance: { key, proposalDate: fields.tentative?.eventDate } });
      assert.ok(next); fields = next;
    }
    assert.equal(fields.timezone, "America/Los_Angeles");
    assert.deepEqual(fields.start, { time: "23:00", dayOffset: 0 });
    assert.deepEqual(fields.end, { time: "01:00", dayOffset: 1 });
    assert.deepEqual(fields.questions, ["keep source"]);
  }
});
