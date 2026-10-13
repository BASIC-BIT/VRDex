import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidatePatch } from "../../apps/web/src/lib/event-intake-source";
import { eventLocalDate, formatIntakeDateTimeInput, parseIntakeDateTimeInput } from "../../apps/web/src/lib/calendar/event-intake-date-time";

describe("intake wall date and time", () => {
  it("keeps the base date when empty or incomplete", () => {
    for (const value of ["", "2026-10-11", "2026-10-11T"]) assert.deepEqual(parseIntakeDateTimeInput({ value, eventDate: "2026-10-10", eventStart: true }), { eventDate: "2026-10-10", local: null });
  });
  it("maps Starts atomically to its date and zero offset", () => {
    assert.deepEqual(parseIntakeDateTimeInput({ value: "2026-10-10T23:00", eventStart: true }), { eventDate: "2026-10-10", local: { time: "23:00", dayOffset: 0 } });
  });
  it("maps an overnight end to the next calendar day", () => {
    assert.deepEqual(parseIntakeDateTimeInput({ value: "2026-10-11T02:00", eventDate: "2026-10-10", eventStart: false }), { eventDate: "2026-10-10", local: { time: "02:00", dayOffset: 1 } });
    assert.equal(formatIntakeDateTimeInput({ eventDate: "2026-10-10", local: { time: "02:00", dayOffset: 1 } }), "2026-10-11T02:00");
  });
  it("does not invent midnight for date-only fields", () => {
    assert.equal(formatIntakeDateTimeInput({ eventDate: "2026-10-10" }), "");
    assert.equal(eventLocalDate("2026-10-10"), "2026-10-10");
  });
  it("rejects invalid complete calendar and clock values", () => {
    for (const value of ["2026-02-30T12:00", "2026-13-01T12:00", "2026-10-10T24:00", "2026-10-10T23:61"]) assert.throws(() => parseIntakeDateTimeInput({ value, eventStart: true }));
    assert.equal(eventLocalDate("2026-02-30"), "");
  });
  it("accepts only secondary offsets from -1 through 7", () => {
    for (const [value, offset] of [["2026-10-09T12:00", -1], ["2026-10-17T12:00", 7]] as const) assert.equal(parseIntakeDateTimeInput({ value, eventDate: "2026-10-10", eventStart: false }).local?.dayOffset, offset);
    for (const value of ["2026-10-08T12:00", "2026-10-18T12:00"]) assert.throws(() => parseIntakeDateTimeInput({ value, eventDate: "2026-10-10", eventStart: false }));
  });
  it("retains explicit secondary dates when Starts moves and refuses an out-of-range move", () => {
    const value = formatIntakeDateTimeInput({ eventDate: "2026-10-10", local: { time: "02:00", dayOffset: 1 } });
    assert.equal(parseIntakeDateTimeInput({ value, eventDate: "2026-10-12", eventStart: false }).local?.dayOffset, -1);
    assert.throws(() => parseIntakeDateTimeInput({ value, eventDate: "2026-10-13", eventStart: false }));
  });
});

it("keeps an extracted date without inventing a time", () => {
  const patch = candidatePatch({ event: { title: null, communitySlug: null, eventDate: "2026-10-10", start: null, end: null, startDate: null, endDate: null, timezone: null, venueLabel: null, summary: null, sourceUrl: null }, lineup: [], evidence: [], questions: [] });
  assert.equal(patch.tentative?.eventDate, "2026-10-10");
  assert.equal(patch.tentative?.start, undefined);
  assert.deepEqual(parseIntakeDateTimeInput({ value: "", eventDate: patch.tentative?.eventDate, eventStart: true }), { eventDate: "2026-10-10", local: null });
});
