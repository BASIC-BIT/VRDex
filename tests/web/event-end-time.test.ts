import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAuthoredEventEndAt } from "../../apps/web/src/lib/calendar/event-end-time";

describe("event authoring end times", () => {
  for (const scheduleChanged of [false, true]) {
    it(`keeps a stored end fixed with scheduleChanged=${scheduleChanged}`, () => {
      assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, derivedEndAt: 5_000, previousStartAt: 1_000, previousEndAt: 4_000, scheduleChanged }), 4_000);
    });
  }

  it("keeps a stored end without needing a previous start", () => {
    assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, previousEndAt: 4_000, derivedEndAt: 5_000, scheduleChanged: true }), 4_000);
  });

  it("leaves a sessionless event without an end", () => {
    assert.equal(resolveAuthoredEventEndAt({ startAt: Date.parse("2026-09-01T20:00:00.000Z"), scheduleChanged: false }), undefined);
  });

  it("uses an explicitly authored end ahead of stored and derived ends", () => {
    assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, authoredEndAt: 6_000, derivedEndAt: 5_000, previousStartAt: 1_000, previousEndAt: 4_000, scheduleChanged: true }), 6_000);
    assert.equal(resolveAuthoredEventEndAt({ startAt: -2_000, authoredEndAt: 0, previousEndAt: 4_000, scheduleChanged: false }), 0);
  });

  it("clears a stored end while retaining only a known derived end", () => {
    assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, authoredEndAt: null, derivedEndAt: 3_000, previousStartAt: 1_000, previousEndAt: 4_000, scheduleChanged: false }), 3_000);
    assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, authoredEndAt: null, previousStartAt: 1_000, previousEndAt: 4_000, scheduleChanged: false }), undefined);
  });

  it("uses a legitimate derived end when neither authored nor stored end exists", () => {
    assert.equal(resolveAuthoredEventEndAt({ startAt: 2_000, derivedEndAt: 3_000, scheduleChanged: false }), 3_000);
  });
});
