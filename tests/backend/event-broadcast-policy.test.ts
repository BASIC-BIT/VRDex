import assert from "node:assert/strict";
import { test } from "node:test";
import { decideHandoff } from "../../workers/restream/handoff-policy.mjs";
import { validateBroadcastPolicy } from "../../convex/_eventBroadcastInputs";

const current = { slotKey: "set-a", sourceId: "dj", startAt: 0, endAt: 100_000, available: true };
const next = { slotKey: "set-b", sourceId: "dj", startAt: 100_000, endAt: 200_000, available: true };
function input(overrides = {}) {
  return { scheduleNow: 100_000, observationNow: 5_000, mode: "automatic", sessionDeadline: 999_000,
    current, next, policy: {}, evidence: { slotKey: "set-a", sourceId: "dj", observedAt: 5_000, progressing: true, analysisActive: true },
    nextReadiness: { slotKey: "set-b", sourceId: "dj", observedAt: 5_000, ready: true }, ...overrides };
}
const failed = { slotKey: "set-a", sourceId: "dj", observedAt: 5_000, progressing: false, analysisActive: false, failureSince: 4_000 };
const cases = [
  ["healthy overrun", {}, { kind: "stay" }],
  ["999ms failure", { evidence: { ...failed, failureSince: 4_001 } }, { kind: "stay" }],
  ["confirmed failure and duplicate performer appearance", { evidence: failed }, { kind: "switch", slotKey: "set-b", reason: "media-failure" }],
  ["no early automatic switch", { scheduleNow: 99_999, evidence: failed }, { kind: "hold", reason: "media-failure" }],
  ["gap", { next: { ...next, startAt: 150_000 }, evidence: failed }, { kind: "hold", reason: "media-failure" }],
  ["overlap waits current boundary", { next: { ...next, startAt: 90_000 }, scheduleNow: 95_000, evidence: failed }, { kind: "hold", reason: "media-failure" }],
  ["stale evidence", { evidence: { ...failed, observedAt: 2_999 } }, { kind: "stay" }],
  ["polling cannot extend failure duration", { observationNow: 5_999, evidence: { ...failed, failureSince: 4_500 } }, { kind: "stay" }],
  ["future evidence", { evidence: { ...failed, observedAt: 5_001 } }, { kind: "stay" }],
  ["wrong slot evidence", { evidence: { ...failed, slotKey: "previous-appearance" } }, { kind: "stay" }],
  ["wrong source evidence", { evidence: { ...failed, sourceId: "old-link" } }, { kind: "stay" }],
  ["revoked successor", { evidence: failed, next: { ...next, available: false } }, { kind: "hold", reason: "media-failure" }],
  ["revoked current", { current: { ...current, available: false } }, { kind: "switch", slotKey: "set-b", reason: "source-unavailable" }],
  ["stale next readiness", { evidence: failed, nextReadiness: { slotKey: "set-b", sourceId: "dj", ready: true, observedAt: 2_999 } }, { kind: "hold", reason: "media-failure", prepare: { slotKey: "set-b" } }],
  ["manual hold", { mode: "hold", evidence: failed }, { kind: "hold", reason: "manual-hold" }],
  ["manual selection suspends following", { mode: "manual", evidence: failed }, { kind: "hold", reason: "media-failure" }],
  ["manual healthy selection", { mode: "manual" }, { kind: "stay" }],
  ["final healthy slot", { next: undefined }, { kind: "stay" }],
  ["final failed slot", { next: undefined, evidence: failed }, { kind: "hold", reason: "media-failure" }],
  ["explicit deadline", { scheduleNow: 999_000, mode: "hold" }, { kind: "stop", reason: "session-deadline" }],
  ["cutoff missing next", { policy: { maxOverrunMs: 0 }, next: undefined }, { kind: "hold", reason: "maximum-overrun" }],
  ["cutoff ready next", { policy: { maxOverrunMs: 0 } }, { kind: "switch", slotKey: "set-b", reason: "maximum-overrun" }],
  ["prepare two minutes", { scheduleNow: -20_000, nextReadiness: undefined }, { kind: "prepare", slotKey: "set-b" }],
  ["do not prepare earlier", { scheduleNow: -20_001, nextReadiness: undefined }, { kind: "stay" }],
  ["silence disabled", { evidence: { ...failed, progressing: true, failureSince: undefined, silenceSince: 0, analysisActive: true, audioLevelDb: -70 } }, { kind: "stay" }],
  ["missing analyzer", { policy: { silence: { thresholdDb: -60, durationMs: 1_000 } }, evidence: { ...failed, progressing: true, failureSince: undefined, silenceSince: 0, audioLevelDb: -70 } }, { kind: "stay" }],
  ["calibrated silence", { policy: { silence: { thresholdDb: -60, durationMs: 1_000 } }, evidence: { ...failed, progressing: true, failureSince: undefined, silenceSince: 0, analysisActive: true, audioLevelDb: -70 } }, { kind: "switch", slotKey: "set-b", reason: "silence" }],
] as const;
for (const [name, overrides, expected] of cases) test(name, () => assert.deepEqual(decideHandoff(input(overrides)), expected));
test("silence retains progressing current when successor is unavailable", () => {
  assert.deepEqual(decideHandoff(input({ next: { ...next, available: false }, policy: { silence: { thresholdDb: -60, durationMs: 1_000 } }, evidence: { ...failed, progressing: true, failureSince: undefined, silenceSince: 0, analysisActive: true, audioLevelDb: -70 } })), { kind: "stay" });
});
test("policy validation defaults and bounds", () => {
  assert.deepEqual(validateBroadcastPolicy({}), {});
  assert.deepEqual(validateBroadcastPolicy({ maxOverrunMs: 0 }), { maxOverrunMs: 0 });
  for (const value of [{ maxOverrunMs: -1 }, { maxOverrunMs: Infinity }, { silence: { thresholdDb: -60, durationMs: 999 } }, { silence: { thresholdDb: 1, durationMs: 1_000 } }]) {
    assert.throws(() => validateBroadcastPolicy(value));
  }
});

for (const scenario of [
  { name: "missing", current: undefined, evidence: undefined, reason: "no-current-source" },
  { name: "failed", current, evidence: failed, reason: "media-failure" },
  { name: "revoked", current: { ...current, available: false }, evidence: undefined, reason: "source-unavailable" },
]) {
  test(`${scenario.name} current holds while preparing successor through boundary`, () => {
    const base = { current: scenario.current, evidence: scenario.evidence, nextReadiness: undefined };
    assert.deepEqual(decideHandoff(input({ ...base, scheduleNow: -20_001 })), { kind: "hold", reason: scenario.reason });
    for (const scheduleNow of [-20_000, 99_999, 100_000]) {
      assert.deepEqual(decideHandoff(input({ ...base, scheduleNow })), { kind: "hold", reason: scenario.reason, prepare: { slotKey: "set-b" } });
    }
    const nextReadiness = { slotKey: "set-b", sourceId: "dj", observedAt: 5_000, ready: true };
    assert.deepEqual(decideHandoff(input({ ...base, scheduleNow: 99_999, nextReadiness })), { kind: "hold", reason: scenario.reason });
    assert.deepEqual(decideHandoff(input({ ...base, scheduleNow: 100_000, nextReadiness })), { kind: "switch", slotKey: "set-b", reason: scenario.name === "failed" ? "media-failure" : "source-unavailable" });
  });
}
test("manual hold never prepares a missing current's successor", () => {
  assert.deepEqual(decideHandoff(input({ mode: "hold", current: undefined, nextReadiness: undefined })), { kind: "hold", reason: "manual-hold" });
});

test('same-key source replacement is distinct but cannot promote before its boundary', () => {
  const revoked = { slotKey: 'same', sourceId: 'old', startAt: 0, available: false };
  const replacement = { slotKey: 'same', sourceId: 'new', startAt: 10000, endAt: 20000, available: true };
  const candidate = { current: revoked, next: replacement, evidence: undefined, nextReadiness: { slotKey: 'same', sourceId: 'new', observedAt: 5000, ready: true } };
  assert.deepEqual(decideHandoff(input({ ...candidate, scheduleNow: 9999 })), { kind: 'hold', reason: 'source-unavailable' });
  assert.deepEqual(decideHandoff(input({ ...candidate, scheduleNow: 10000 })), { kind: 'switch', slotKey: 'same', reason: 'source-unavailable' });
});
test('same slot and source pair is not its own automatic successor', () => {
  assert.deepEqual(decideHandoff(input({ next: current, evidence: failed, nextReadiness: { slotKey: current.slotKey, sourceId: current.sourceId, observedAt: 5000, ready: true } })), { kind: 'hold', reason: 'media-failure' });
});
