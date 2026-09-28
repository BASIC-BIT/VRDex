import assert from "node:assert/strict";
import test from "node:test";
import { searchEventTimezones } from "../../apps/web/src/lib/event-timezones";

test("EST resolves to New York with the event-date summer offset", () => {
  const result = searchEventTimezones("EST", "2026-07-15")[0];
  assert.equal(result?.value, "America/New_York");
  assert.match(result!.label, /UTC-04:00/);
});
test("city and regional aliases find IANA zones", () => {
  assert.equal(searchEventTimezones("London", null)[0]?.value, "Europe/London");
  assert.equal(searchEventTimezones("Pacific", "2026-01-01")[0]?.value, "America/Los_Angeles");
});
test("an existing IANA zone stays selectable and invalid text yields no options", () => {
  assert.equal(searchEventTimezones("America/Indiana/Indianapolis", "2026-07-15")[0]?.value, "America/Indiana/Indianapolis");
  assert.deepEqual(searchEventTimezones("not a zone", null), []);
});
