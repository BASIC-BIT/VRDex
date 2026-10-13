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
