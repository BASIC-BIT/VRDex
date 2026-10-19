import assert from "node:assert/strict";
import test from "node:test";
import { resolveEventTimezoneDefault } from "../../apps/web/src/lib/event-timezone-default";

test("a valid account preference wins over browser detection", () => {
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "America/New_York", browserTimezone: "Europe/London" }), "America/New_York");
});
test("invalid preferences fall back to browser then UTC", () => {
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "invalid", browserTimezone: "Europe/London" }), "Europe/London");
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "invalid", browserTimezone: "invalid" }), "UTC");
  assert.equal(resolveEventTimezoneDefault({}), "UTC");
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "America/Indiana/Indianapolis" }), "America/Indiana/Indianapolis");
});

test("fixed offsets are not event timezone defaults", () => {
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "+05:00", browserTimezone: "Europe/London" }), "Europe/London");
  assert.equal(resolveEventTimezoneDefault({ browserTimezone: "-04:00" }), "UTC");
});

test("named IANA zones remain valid preferences even with constant offsets", () => {
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "Etc/GMT+5", browserTimezone: "Europe/London" }), "Etc/GMT+5");
  assert.equal(resolveEventTimezoneDefault({ browserTimezone: "Etc/GMT+5" }), "Etc/GMT+5");
  assert.equal(resolveEventTimezoneDefault({ savedPreference: "UTC" }), "UTC");
});

test("Indianapolis defaults preserve either valid regional identity", () => {
  for (const zone of ["America/Indianapolis", "America/Indiana/Indianapolis"]) {
    assert.equal(resolveEventTimezoneDefault({ savedPreference: zone, browserTimezone: "America/New_York" }), zone);
    assert.equal(resolveEventTimezoneDefault({ browserTimezone: zone }), zone);
  }
});
