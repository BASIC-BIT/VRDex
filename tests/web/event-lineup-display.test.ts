import assert from "node:assert/strict";
import test from "node:test";
import { formatLineupTimeRange } from "../../apps/web/src/lib/calendar/event-lineup-display";

test("same-day lineup range is compact in the authored timezone", () => {
  assert.equal(formatLineupTimeRange({ startAt: Date.UTC(2027,9,15,20), endAt: Date.UTC(2027,9,15,21), timezone: "UTC", eventDate: "2027-10-15" }), "20:00 - 21:00 · UTC");
});
test("lineup range retains crossing dates and exact seconds and milliseconds", () => {
  assert.equal(formatLineupTimeRange({ startAt: Date.UTC(2027,9,15,23,59,30,456), endAt: Date.UTC(2027,9,16,0,5,20,123), timezone: "UTC", eventDate: "2027-10-15" }), "Oct 15, 2027 23:59:30.456 - Oct 16, 2027 00:05:20.123 · UTC");
});
test("later-day and unknown-end ranges retain only known data", () => {
  assert.equal(formatLineupTimeRange({ startAt: Date.UTC(2027,9,16,1), timezone: "UTC", eventDate: "2027-10-15" }), "Oct 16, 2027 01:00 · UTC");
  assert.equal(formatLineupTimeRange({ timezone: "UTC", eventDate: "2027-10-15" }), "");
});
