import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptIntakeSuggestion, rebaseIntakeSuggestions, rebaseIntakeTimes, restoreIntakeTiming } from "../../apps/web/src/lib/calendar/event-intake-suggestions";
import { EventIntakePatchSchema, type EventIntakePatch } from "../../packages/api-contracts/src/event-intake";
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

describe("intake suggestion calendar provenance", () => {
  const accept = (fields: EventIntakePatch, key: keyof NonNullable<EventIntakePatch["tentative"]>) => {
    const accepted = acceptIntakeSuggestion({ fields, acceptance: { key, proposalDate: fields.tentative?.eventDate } });
    assert.ok(accepted);
    return accepted;
  };
  it("normalizes remaining clocks and lineup after Date, then preserves them through serialization and a base edit", () => {
    const date = accept({ eventDate: "2026-10-10", tentative: { eventDate: "2026-10-11", start: { time: "23:00" }, end: { time: "02:00", dayOffset: 1 }, lineup: [{ clientKey: "pending", position: 0, start: { time: "01:00", dayOffset: 1 } }] } }, "eventDate");
    assert.equal(date.tentative?.eventDate, undefined);
    assert.deepEqual(date.tentative?.start, { time: "23:00", dayOffset: 0 });
    const moved = rebaseIntakeSuggestions({ ...date, eventDate: "2026-10-12" }, date.eventDate);
    const resumed = EventIntakePatchSchema.parse(JSON.parse(JSON.stringify(moved)));
    assert.equal(formatIntakeDateTimeInput({ eventDate: resumed.eventDate, local: accept(resumed, "end").end }), "2026-10-12T02:00");
    assert.equal(formatIntakeDateTimeInput({ eventDate: resumed.eventDate, local: accept(resumed, "lineup").lineup?.[0].start }), "2026-10-12T01:00");
    assert.equal(formatIntakeDateTimeInput({ eventDate: resumed.eventDate, local: accept(resumed, "start").start }), "2026-10-11T23:00");
  });
  it("keeps a reference date when a manual base move would put pending offsets outside the schema", () => {
    for (const eventDate of ["2026-10-01", "2026-10-20"]) {
      const moved = rebaseIntakeSuggestions({ eventDate, tentative: { end: { time: "02:00", dayOffset: 1 } } }, "2026-10-11");
      assert.equal(moved.tentative?.eventDate, "2026-10-11");
      EventIntakePatchSchema.parse(moved);
      assert.equal(acceptIntakeSuggestion({ fields: moved, acceptance: { key: "end", proposalDate: moved.tentative?.eventDate } }), null);
      const recovered = accept(accept(moved, "eventDate"), "end");
      assert.equal(formatIntakeDateTimeInput({ eventDate: recovered.eventDate, local: recovered.end }), "2026-10-12T02:00");
    }
  });
  it("leaves unknown source clocks unknown after a manual base edit", () => {
    const moved = rebaseIntakeSuggestions({ eventDate: "2026-10-12", tentative: { end: { time: "02:00" } } }, "2026-10-11");
    assert.deepEqual(moved.tentative?.end, { time: "02:00" });
    assert.equal(acceptIntakeSuggestion({ fields: moved, acceptance: { key: "end", proposalDate: undefined } }), null);
  });
  it("guards absent or invalid accepted/source dates and both translated offset boundaries without mutation", () => {
    for (const fields of [
      { tentative: { eventDate: "2026-10-11", end: { time: "02:00" } } },
      { eventDate: "2026-10-10", tentative: { end: { time: "02:00" } } },
      { eventDate: "2026-02-30", tentative: { eventDate: "2026-10-11", end: { time: "02:00" } } },
      { eventDate: "2026-10-10", tentative: { eventDate: "2026-02-30", end: { time: "02:00" } } },
      { eventDate: "2026-10-01", tentative: { eventDate: "2026-10-11", end: { time: "02:00", dayOffset: 1 } } },
      { eventDate: "2026-10-20", tentative: { eventDate: "2026-10-11", end: { time: "02:00", dayOffset: 1 } } },
    ] satisfies EventIntakePatch[]) {
      const before = structuredClone(fields);
      assert.equal(acceptIntakeSuggestion({ fields, acceptance: { key: "end", proposalDate: fields.tentative.eventDate } }), null);
      assert.deepEqual(fields, before);
    }
  });
  it("preserves absent and explicit null lineup fields while rebasing accepted clocks", () => {
    for (const lineup of [undefined, null]) {
      assert.equal(rebaseIntakeTimes({ eventDate: "2026-10-10", lineup }, "2026-10-10", "2026-10-11").lineup, lineup);
      assert.equal(restoreIntakeTiming({ eventDate: "2026-10-10", lineup }, null).lineup, lineup);
    }
  });
});

it("retains a normalized suggestion's base while the accepted date is temporarily empty", () => {
  const cleared = rebaseIntakeSuggestions({ eventDate: null, tentative: { end: { time: "02:00", dayOffset: 1 } } }, "2026-10-11");
  assert.equal(cleared.tentative?.eventDate, "2026-10-11");
  const moved = rebaseIntakeSuggestions({ ...cleared, eventDate: "2026-10-12" }, null);
  const accepted = acceptIntakeSuggestion({ fields: moved, acceptance: { key: "end", proposalDate: moved.tentative?.eventDate } });
  assert.ok(accepted);
  assert.equal(formatIntakeDateTimeInput({ eventDate: accepted.eventDate, local: accepted.end }), "2026-10-12T02:00");
});
