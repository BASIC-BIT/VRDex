import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAuthoredEventEndAt } from "../../apps/web/src/lib/calendar/event-end-time";

describe("event authoring end times", () => {
  it("preserves and shifts a stored end when the schedule is unchanged", () => {
    assert.equal(resolveAuthoredEventEndAt({
      startAt: 2_000,
      derivedEndAt: 3_000,
      previousStartAt: 1_000,
      previousEndAt: 4_000,
      scheduleChanged: false,
    }), 5_000);
  });

  it("uses the final session after the schedule changes", () => {
    assert.equal(resolveAuthoredEventEndAt({
      startAt: 2_000,
      derivedEndAt: 3_000,
      previousStartAt: 1_000,
      previousEndAt: 4_000,
      scheduleChanged: true,
    }), 3_000);
  });

  it("defaults a sessionless event to 60 minutes", () => {
    const startAt = Date.parse("2026-09-01T20:00:00.000Z");
    assert.equal(resolveAuthoredEventEndAt({
      startAt,
      scheduleChanged: false,
    }), startAt + 60 * 60_000);
  });
});
