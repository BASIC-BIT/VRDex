import assert from "node:assert/strict";
import test from "node:test";
import { eventTimezoneLabel, searchEventTimezones } from "../../apps/web/src/lib/event-timezones";

test("Eastern aliases find New York without claiming a guessed offset", () => {
  for (const query of ["EST", "EDT", "eastern"]) {
    const result = searchEventTimezones(query, "2026-07-15")[0];
    assert.equal(result?.value, "America/New_York");
    assert.doesNotMatch(result!.label, /UTC[+-]|EDT|EST/);
    assert.match(result!.label, /Eastern/);
  }
});
test("resolved fallback instants distinguish EDT from EST", () => {
  const earlier = searchEventTimezones("EST", "2026-11-01", Date.parse("2026-11-01T05:30:00Z"))[0];
  const later = searchEventTimezones("EDT", "2026-11-01", Date.parse("2026-11-01T06:30:00Z"))[0];
  assert.match(earlier!.label, /EDT.*UTC-04:00/);
  assert.match(later!.label, /EST.*UTC-05:00/);
  assert.match(eventTimezoneLabel("America/New_York", Date.parse("2026-11-01T06:30:00Z")), /Eastern.*EST/);
});
test("city and regional aliases preserve ambiguous choices", () => {
  assert.equal(searchEventTimezones("London", null)[0]?.value, "Europe/London");
  assert.equal(searchEventTimezones("Pacific", null)[0]?.value, "America/Los_Angeles");
  assert.ok(searchEventTimezones("cst", null).length > 1);
});
test("valid legacy zones remain selectable with readable labels", () => {
  assert.equal(searchEventTimezones("America/Indiana/Indianapolis", null)[0]?.value, "America/Indiana/Indianapolis");
  assert.equal(eventTimezoneLabel("America/Indiana/Indianapolis"), "Eastern (Indianapolis)");
  assert.deepEqual(searchEventTimezones("not a zone", null), []);
});

test("UTC labels omit identical region, abbreviation and IANA parts", () => {
  const instant = Date.UTC(2027, 9, 15, 20);
  assert.equal(eventTimezoneLabel("UTC", instant), "UTC");
  const option = searchEventTimezones("UTC", "2027-10-15", instant).find(option => option.value === "UTC");
  assert.equal(option?.value, "UTC");
  assert.doesNotMatch(option!.label, / · UTC/);
});

test("both Indianapolis identifiers use friendly date-correct regional labels", () => {
  for (const zone of ["America/Indianapolis", "America/Indiana/Indianapolis"]) {
    assert.equal(eventTimezoneLabel(zone), "Eastern (Indianapolis)");
    assert.equal(eventTimezoneLabel(zone, Date.UTC(2026, 6, 15, 12)), "Eastern (Indianapolis) · EDT (UTC-04:00)");
    assert.equal(eventTimezoneLabel(zone, Date.UTC(2026, 0, 15, 12)), "Eastern (Indianapolis) · EST (UTC-05:00)");
    assert.equal(searchEventTimezones(zone, null)[0]?.value, zone);
  }
});

test("undated regional labels do not invent seasonal offsets", () => {
  assert.equal(eventTimezoneLabel("America/New_York"), "Eastern");
  assert.equal(eventTimezoneLabel("America/New_York", Number.NaN), "Eastern");
  assert.equal(eventTimezoneLabel("America/New_York", Date.UTC(2026, 6, 15, 12)), "Eastern · EDT (UTC-04:00)");
});

test("fixed IANA offsets are identified separately from regional Eastern zones", () => {
  assert.equal(eventTimezoneLabel("Etc/GMT+5"), "Fixed offset (UTC-05:00)");
  assert.equal(eventTimezoneLabel("Etc/GMT+5", Date.UTC(2026, 6, 15, 12)), "Fixed offset (UTC-05:00)");
  assert.notEqual(eventTimezoneLabel("Etc/GMT+5"), eventTimezoneLabel("America/Indianapolis"));
});
