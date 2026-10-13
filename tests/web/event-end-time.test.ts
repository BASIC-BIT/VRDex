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

  it("leaves a sessionless event without an end", () => {
    const startAt = Date.parse("2026-09-01T20:00:00.000Z");
    assert.equal(resolveAuthoredEventEndAt({
      startAt,
      scheduleChanged: false,
    }), undefined);
  });

  it("uses an explicitly authored end", () => {
    assert.equal(resolveAuthoredEventEndAt({
      startAt: 2_000,
      authoredEndAt: 6_000,
      previousStartAt: 1_000,
      previousEndAt: 4_000,
      scheduleChanged: false,
    }), 6_000);
  });

  it("clears a stored end while retaining a known lineup end", () => {
    assert.equal(resolveAuthoredEventEndAt({
      startAt: 2_000,
      authoredEndAt: null,
      derivedEndAt: 3_000,
      previousStartAt: 1_000,
      previousEndAt: 4_000,
      scheduleChanged: false,
    }), 3_000);
    assert.equal(resolveAuthoredEventEndAt({
      startAt: 2_000,
      authoredEndAt: null,
      previousStartAt: 1_000,
      previousEndAt: 4_000,
      scheduleChanged: false,
    }), undefined);
  });
});
