import assert from "node:assert/strict";
import { it } from "node:test";
import { formatDiscordRecurrence, formatGoogleRecurrence, parseDiscordRecurrence, parseGoogleRecurrence, type DiscordRecurrenceWrite } from "../../convex/_recurrenceRules";

const anchor = { date: "2026-11-07", timezone: "America/New_York", startTime: "20:00", endTime: "23:00" };
const times = { startTime: "20:00", endTime: "23:00" };
const weekly = { frequency: "weekly", weekday: 6, ...times } as const;
const fixed = [weekly, { ...weekly, frequency: "biweekly" }, ...[1, 2, 3, 4, -1].map((ordinal) => ({ ...weekly, frequency: "monthly_weekday", ordinal }))] as const;
const start = "2026-11-08T01:00:00.000Z";

it("parses the Google rules in the fixed set", () => {
  assert.deepEqual(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA"], anchor), { rule: weekly, startsOn: "2026-11-07" });
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=SA"], anchor)?.rule.frequency, "biweekly");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY"], anchor)?.rule.weekday, 6);
  assert.deepEqual(parseGoogleRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=1SA"], anchor)?.rule, { frequency: "monthly_weekday", weekday: 6, ordinal: 1, ...times });
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=MONTHLY;BYDAY=-1SA"], anchor)?.rule.ordinal, -1);
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"], anchor)?.endsOn, "2026-12-05");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261205"], anchor)?.endsOn, "2026-12-05");
  assert.equal(parseGoogleRecurrence(["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=10"], anchor)?.count, 10);
});

it("returns null for Google rules outside the fixed set", () => {
  for (const recurrence of [[], ["RRULE:FREQ=DAILY"], ["RRULE:FREQ=WEEKLY;BYDAY=MO,SA"], ["RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=SA"],
    ["RRULE:FREQ=MONTHLY;BYDAY=5SA"], ["RRULE:FREQ=MONTHLY;BYDAY=SA"], ["RRULE:FREQ=MONTHLY;BYMONTHDAY=7"], ["RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1"],
    ["RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=1SA"], ["RRULE:FREQ=YEARLY"], ["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=521"],
    ["RRULE:FREQ=WEEKLY;BYDAY=SA", "EXDATE;TZID=America/New_York:20261114T200000"], ["RRULE:FREQ=WEEKLY;BYDAY=SA", "RRULE:FREQ=WEEKLY;BYDAY=MO"]])
    assert.equal(parseGoogleRecurrence(recurrence, anchor), null, recurrence.join(" "));
});

it("formats each fixed rule as the RRULE Google emits and round-trips it", () => {
  assert.deepEqual(formatGoogleRecurrence(weekly), ["RRULE:FREQ=WEEKLY;BYDAY=SA"]);
  assert.deepEqual(formatGoogleRecurrence({ ...weekly, frequency: "biweekly" }), ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA"]);
  assert.deepEqual(formatGoogleRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: -1 }), ["RRULE:FREQ=MONTHLY;BYDAY=-1SA"]);
  assert.deepEqual(formatGoogleRecurrence(weekly, "2026-12-05", undefined, "America/New_York"), ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261206T045959Z"]);
  assert.deepEqual(formatGoogleRecurrence(weekly, undefined, 10), ["RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=10"]);
  for (const rule of fixed) assert.deepEqual(parseGoogleRecurrence(formatGoogleRecurrence(rule), anchor)?.rule, rule);
});

it("writes UNTIL as the last instant of a local day the clock changes on", () => {
  // 23:59 happens twice on a Cairo fall-back night and not at all on a Nuuk spring-forward night.
  assert.deepEqual(formatGoogleRecurrence(weekly, "2026-10-29", undefined, "Africa/Cairo"), ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261029T215959Z"]);
  assert.deepEqual(formatGoogleRecurrence(weekly, "2027-03-27", undefined, "America/Nuuk"), ["RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20270328T005959Z"]);
});

it("formats Discord rules and refuses the last weekday", () => {
  const none = { by_month: null, by_month_day: null };
  assert.deepEqual(formatDiscordRecurrence(weekly, start), { start, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, ...none });
  assert.deepEqual(formatDiscordRecurrence({ ...weekly, frequency: "biweekly" }, start), { start, frequency: 2, interval: 2, by_weekday: [5], by_n_weekday: null, ...none });
  assert.deepEqual(formatDiscordRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: 2 }, start), { start, frequency: 1, interval: 1, by_weekday: null, by_n_weekday: [{ n: 2, day: 5 }], ...none });
  assert.equal(formatDiscordRecurrence({ ...weekly, frequency: "monthly_weekday", ordinal: -1 }, start), null);
});

it("parses Discord rules in the fixed set and nothing else", () => {
  for (const rule of fixed.filter((r) => !("ordinal" in r) || r.ordinal !== -1))
    assert.deepEqual(parseDiscordRecurrence(formatDiscordRecurrence(rule, start)!, anchor)?.rule, rule);
  const base: DiscordRecurrenceWrite = { start, frequency: 2, interval: 1, by_weekday: [5], by_n_weekday: null, by_month: null, by_month_day: null };
  assert.equal(parseDiscordRecurrence({ ...base, end: "2026-12-06T04:59:59.000Z", count: 10 }, anchor)?.endsOn, "2026-12-05");
  for (const rule of [{ ...base, frequency: 3, by_weekday: [0, 1, 2, 3, 4] }, { ...base, by_weekday: [0, 4] }, { ...base, interval: 3 },
    { ...base, frequency: 1, by_weekday: null, by_n_weekday: [{ n: 5, day: 4 }] }, { ...base, frequency: 0, by_weekday: null, by_month: [11], by_month_day: [7] }])
    assert.equal(parseDiscordRecurrence(rule, anchor), null, JSON.stringify(rule));
});

it("takes the Discord weekday from the anchor, whichever day the rule names", () => {
  const base: DiscordRecurrenceWrite = { start, frequency: 2, interval: 1, by_weekday: [6], by_n_weekday: null, by_month: null, by_month_day: null };
  assert.equal(parseDiscordRecurrence(base, anchor)?.rule.weekday, 6);
  assert.deepEqual(parseDiscordRecurrence({ ...base, frequency: 1, by_weekday: null, by_n_weekday: [{ n: 1, day: 6 }] }, anchor)?.rule, { frequency: "monthly_weekday", weekday: 6, ordinal: 1, ...times });
});
