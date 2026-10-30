import assert from "node:assert/strict";
import { it } from "node:test";
import { occurrenceDates, occurrenceTimes, validateSeriesRule } from "../../convex/_eventSeries";

const rule = (r: object) => ({ startTime: "20:00", ...r }) as never;
const friday = { frequency: "weekly", weekday: 5 };

it("weekly emits each matching weekday inside the window", () => {
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30" }, "2026-10-30", "2026-11-27"),
    ["2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-29" }, "2026-10-29", "2026-11-06"), ["2026-10-30", "2026-11-06"]);
});
it("biweekly stays anchored to startsOn, not to the window", () => {
  assert.deepEqual(occurrenceDates({ rule: rule({ frequency: "biweekly", weekday: 5 }), startsOn: "2026-10-30" }, "2026-11-01", "2026-12-31"),
    ["2026-11-13", "2026-11-27", "2026-12-11", "2026-12-25"]);
});
it("monthly_weekday picks the nth and the last weekday", () => {
  const monthly = (ordinal: number) => ({ rule: rule({ frequency: "monthly_weekday", weekday: 5, ordinal }), startsOn: "2026-11-01" });
  assert.deepEqual(occurrenceDates(monthly(2), "2026-11-01", "2027-01-31"), ["2026-11-13", "2026-12-11", "2027-01-08"]);
  assert.deepEqual(occurrenceDates(monthly(-1), "2026-11-01", "2027-01-31"), ["2026-11-27", "2026-12-25", "2027-01-29"]);
});
it("count counts from startsOn and endsOn is inclusive", () => {
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30", count: 3 }, "2026-11-06", "2027-01-01"), ["2026-11-06", "2026-11-13"]);
  assert.deepEqual(occurrenceDates({ rule: rule(friday), startsOn: "2026-10-30", endsOn: "2026-11-13" }, "2026-10-30", "2026-12-31"),
    ["2026-10-30", "2026-11-06", "2026-11-13"]);
});
it("validateSeriesRule rejects out-of-bounds rules and series bounds", () => {
  const ok = { frequency: "weekly", weekday: 5, startTime: "20:00" } as const;
  assert.doesNotThrow(() => validateSeriesRule(ok, { startsOn: "2026-10-30", endsOn: "2026-10-30", count: 520 }));
  assert.doesNotThrow(() => validateSeriesRule({ ...ok, frequency: "monthly_weekday", ordinal: -1, endTime: "23:59", doorsTime: "00:00" }));
  for (const bad of [
    { ...ok, frequency: "daily" },
    { ...ok, weekday: 7 },
    { ...ok, weekday: 1.5 },
    { ...ok, frequency: "monthly_weekday" },
    { ...ok, frequency: "monthly_weekday", ordinal: 5 },
    { ...ok, ordinal: 1 },
    { ...ok, startTime: "24:00" },
    { ...ok, endTime: "8:00" },
    { ...ok, doorsTime: "20:60" },
  ]) assert.throws(() => validateSeriesRule(bad as never), JSON.stringify(bad));
  for (const bounds of [
    { startsOn: "2026-02-30" },
    { startsOn: "2026-10-30", endsOn: "2026-10-29" },
    { startsOn: "2026-10-30", count: 0 },
    { startsOn: "2026-10-30", count: 521 },
    { startsOn: "2026-10-30", count: 2.5 },
  ]) assert.throws(() => validateSeriesRule(ok, bounds), JSON.stringify(bounds));
});
it("a doors time later than the start falls on the previous day", () => {
  const times = occurrenceTimes({ timezone: "America/New_York", rule: rule({ ...friday, startTime: "00:30", doorsTime: "23:30" }) }, "2026-11-06");
  assert.deepEqual([times!.startAt, times!.doorsOpenAt], [Date.parse("2026-11-06T05:30:00Z"), Date.parse("2026-11-06T04:30:00Z")]);
});
it("a doors or end time that does not exist that night is omitted, and the night keeps its start", () => {
  const series = (extra: object) => ({ timezone: "America/New_York", rule: rule({ frequency: "weekly", weekday: 0, ...extra }) });
  // 02:30 does not exist on 2027-03-14 in New York.
  const doorsGone = occurrenceTimes(series({ startTime: "03:30", doorsTime: "02:30" }), "2027-03-14");
  assert.deepEqual([doorsGone!.startAt, doorsGone!.doorsOpenAt], [Date.parse("2027-03-14T07:30:00Z"), undefined]);
  const endGone = occurrenceTimes(series({ startTime: "01:00", endTime: "02:30" }), "2027-03-14");
  assert.deepEqual([endGone!.startAt, endGone!.endAt], [Date.parse("2027-03-14T06:00:00Z"), undefined]);
});
