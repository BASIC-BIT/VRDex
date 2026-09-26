import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatCalendarDate,
  formatZonedDateTimeInput,
  parseZonedDateTimeInput,
} from "../../apps/web/src/lib/calendar/zoned-date-time";

describe("event authoring time zones", () => {
  it("keeps a date-only July 4 on July 4 for UTC-12 and UTC+14 viewers", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["Etc/GMT+12", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        assert.equal(formatCalendarDate("2026-07-04"), "Jul 4, 2026");
      }
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it("converts local event times with the offset active on that date", () => {
    assert.equal(
      parseZonedDateTimeInput("2026-07-15T21:30", "America/New_York", "Event start time"),
      Date.parse("2026-07-16T01:30:00.000Z"),
    );
    assert.equal(
      parseZonedDateTimeInput("2026-01-15T21:30", "America/New_York", "Event start time"),
      Date.parse("2026-01-16T02:30:00.000Z"),
    );
  });

  it("rejects a local time skipped by the spring DST transition", () => {
    assert.throws(
      () => parseZonedDateTimeInput("2026-03-08T02:30", "America/New_York", "Event start time"),
      /must be a valid local time in America\/New_York/,
    );
  });

  it("uses the earlier occurrence of a repeated fall DST time", () => {
    assert.equal(
      parseZonedDateTimeInput("2026-11-01T01:30", "America/New_York", "Event start time"),
      Date.parse("2026-11-01T05:30:00.000Z"),
    );
    assert.equal(
      parseZonedDateTimeInput("2026-10-25T02:30", "Europe/Berlin", "Event start time"),
      Date.parse("2026-10-25T00:30:00.000Z"),
    );
    assert.equal(
      parseZonedDateTimeInput("2026-04-05T01:45", "Australia/Lord_Howe", "Event start time"),
      Date.parse("2026-04-04T14:45:00.000Z"),
    );
  });

  it("formats stored instants back in the event authoring time zone", () => {
    assert.equal(
      formatZonedDateTimeInput(Date.parse("2026-07-16T01:30:00.000Z"), "America/New_York"),
      "2026-07-15T21:30",
    );
  });
});
