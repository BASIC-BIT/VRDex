import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FAILURE_CONFIRMATION_MS,
  handoffEligibleAt,
  joinSlot,
  shouldHandoff,
  type HandoffInput,
  type PlaybackSlot,
} from "../../apps/web/src/lib/event-playback";

const stream = { streamId: "live", pcUrl: "pc", questUrl: "quest" };

function handoffInput(overrides: Partial<HandoffInput> = {}): HandoffInput {
  return {
    scheduleNow: 480_000,
    observationNow: 2_000,
    eligibleAt: 480_000,
    following: true,
    paused: false,
    nextReady: true,
    silenceDurationMs: 1_000,
    evidence: {
      failureSince: 1_000,
      observedAt: 2_000,
      progressing: false,
      analysisActive: true,
    },
    ...overrides,
  };
}

describe("joinSlot", () => {
  const slots: readonly PlaybackSlot[] = [
    { key: "a", startAt: 1_000, endAt: 2_000, stream },
    { key: "b", startAt: 3_000, endAt: 4_000, stream },
  ];

  it("joins only an active authored interval", () => {
    assert.equal(joinSlot(slots, 999), undefined);
    assert.equal(joinSlot(slots, 1_000)?.key, "a");
    assert.equal(joinSlot(slots, 1_999)?.key, "a");
    assert.equal(joinSlot(slots, 2_000), undefined);
    assert.equal(joinSlot(slots, 2_500), undefined);
    assert.equal(joinSlot(slots, 4_000), undefined);
  });

  it("infers a missing end from the next authored start", () => {
    const open = [
      { key: "a", startAt: 1_000, stream },
      { key: "b", startAt: 2_000, endAt: 3_000, stream },
    ];
    assert.equal(joinSlot(open, 1_999)?.key, "a");
    assert.equal(joinSlot(open, 2_000)?.key, "b");
  });

  it("rejects ambiguous overlap and invalid schedule timestamps", () => {
    const overlap = [
      { key: "a", startAt: 1_000, endAt: 3_000, stream },
      { key: "b", startAt: 2_000, endAt: 4_000, stream },
    ];
    assert.equal(joinSlot(overlap, 2_500), undefined);
    assert.equal(joinSlot([{ key: "bad", startAt: Number.NaN }], 1_000), undefined);
    assert.equal(joinSlot(slots, Number.POSITIVE_INFINITY), undefined);
  });

  it("does not filter a current slot that has no stream", () => {
    const barrier = [
      { key: "empty", startAt: 1_000, endAt: 2_000 },
      { key: "later", startAt: 2_000, endAt: 3_000, stream },
    ];
    assert.equal(joinSlot(barrier, 1_500)?.key, "empty");
  });
});

describe("handoff policy", () => {
  it("arms two minutes before the later boundary for gaps and overlaps", () => {
    assert.equal(
      handoffEligibleAt(
        { key: "a", startAt: 0, endAt: 600_000 },
        { key: "b", startAt: 600_000 },
      ),
      480_000,
    );
    assert.equal(
      handoffEligibleAt(
        { key: "a", startAt: 0, endAt: 500_000 },
        { key: "b", startAt: 600_000 },
      ),
      480_000,
    );
    assert.equal(
      handoffEligibleAt(
        { key: "a", startAt: 0, endAt: 700_000 },
        { key: "b", startAt: 600_000 },
      ),
      580_000,
    );
    assert.equal(
      handoffEligibleAt(
        { key: "a", startAt: 0 },
        { key: "b", startAt: 600_000 },
      ),
      480_000,
    );
  });

  it("requires eligibility, follow mode, playback, and a ready next source", () => {
    assert.equal(shouldHandoff(handoffInput({ scheduleNow: 479_999 })), false);
    assert.equal(shouldHandoff(handoffInput({ scheduleNow: 481_000 })), true);
    assert.equal(shouldHandoff(handoffInput({ following: false })), false);
    assert.equal(shouldHandoff(handoffInput({ paused: true })), false);
    assert.equal(shouldHandoff(handoffInput({ nextReady: false })), false);
    assert.equal(shouldHandoff(handoffInput()), true);
  });

  it("never advances from the schedule clock alone", () => {
    assert.equal(
      shouldHandoff(
        handoffInput({
          scheduleNow: 900_000,
          evidence: {
            observedAt: 2_000,
            progressing: true,
            analysisActive: true,
          },
        }),
      ),
      false,
    );
  });

  it("requires 1000ms of observed failure", () => {
    assert.equal(
      shouldHandoff(
        handoffInput({ evidence: { ...handoffInput().evidence, failureSince: 1_001 } }),
      ),
      false,
    );
    assert.equal(FAILURE_CONFIRMATION_MS, 1_000);
    assert.equal(shouldHandoff(handoffInput()), true);
  });

  it("requires progressing active analysis for connected silence", () => {
    const silence = {
      silenceSince: 1_000,
      observedAt: 2_000,
      progressing: true,
      analysisActive: true,
    };
    assert.equal(shouldHandoff(handoffInput({ evidence: silence })), true);
    assert.equal(
      shouldHandoff(handoffInput({ evidence: { ...silence, progressing: false } })),
      false,
    );
    assert.equal(
      shouldHandoff(handoffInput({ evidence: { ...silence, analysisActive: false } })),
      false,
    );
  });

  it("rejects stale, future, and invalid monotonic evidence", () => {
    assert.equal(shouldHandoff(handoffInput({ observationNow: 2_501 })), false);
    assert.equal(shouldHandoff(handoffInput({ observationNow: 1_999 })), false);
    assert.equal(shouldHandoff(handoffInput({ observationNow: Number.NaN })), false);
  });

  it("keeps wall-clock schedule time separate from monotonic observations", () => {
    const wallNow = 1_800_000_480_000;
    assert.equal(
      shouldHandoff(
        handoffInput({ scheduleNow: wallNow, eligibleAt: wallNow, observationNow: 2_000 }),
      ),
      true,
    );
    assert.equal(
      shouldHandoff(
        handoffInput({
          scheduleNow: wallNow + 86_400_000,
          eligibleAt: wallNow,
          observationNow: 1_999,
        }),
      ),
      false,
    );
  });
});
