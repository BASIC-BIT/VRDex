import assert from "node:assert/strict";
import { it } from "node:test";
import { calculateSessionCls, type LayoutShift } from "../../apps/web/e2e/home-polish-cls";

const shift = (at: number, value = 0.125, recentInput = false): LayoutShift => ({ at, value, recentInput });
const longSession = [0, 900, 1800, 2700, 3600, 4500].map(at => shift(at));

// Literal expectations catch lifetime sums, recent-input inclusion/bridging,
// and inclusive comparisons at either session-window boundary.
const cases: { name: string; shifts: LayoutShift[]; expected: number }[] = [
  { name: "returns zero without shifts", shifts: [], expected: 0 },
  { name: "returns zero when every shift follows recent input", shifts: [shift(0, 0.5, true)], expected: 0 },
  { name: "adds shifts in one session", shifts: [shift(0), shift(500, 0.25)], expected: 0.375 },
  { name: "keeps the largest earlier session instead of a lifetime sum", shifts: [shift(0, 0.25), shift(500, 0.25), shift(2000)], expected: 0.5 },
  { name: "selects a larger later session", shifts: [shift(0), shift(2000, 0.25), shift(2400, 0.25)], expected: 0.5 },
  { name: "excludes recent-input values within a session", shifts: [shift(0), shift(500, 0.5, true), shift(900, 0.25)], expected: 0.375 },
  { name: "does not let recent-input shifts bridge sessions", shifts: [shift(0), shift(900, 0.5, true), shift(1500, 0.25)], expected: 0.25 },
  { name: "joins shifts just below a one-second gap", shifts: [shift(0), shift(999, 0.25)], expected: 0.375 },
  { name: "starts a new session at a one-second gap", shifts: [shift(0), shift(1000, 0.25)], expected: 0.25 },
  { name: "starts a new session above a one-second gap", shifts: [shift(0), shift(1001, 0.25)], expected: 0.25 },
  { name: "joins shifts just below five seconds from the session start", shifts: [...longSession, shift(4999, 0.25)], expected: 1 },
  { name: "measures five seconds from the first eligible shift at a nonzero timestamp", shifts: [shift(50, 0.5, true), ...longSession.map(item => ({ ...item, at: item.at + 100 })), shift(5099, 0.25)], expected: 1 },
  { name: "starts a new session at five seconds despite a short preceding gap", shifts: [...longSession, shift(5000, 0.5)], expected: 0.75 },
  { name: "starts a new session above five seconds despite a short preceding gap", shifts: [...longSession, shift(5001, 0.5)], expected: 0.75 },
];

for (const { name, shifts, expected } of cases) {
  it(name, () => {
    assert.equal(calculateSessionCls(shifts), expected);
  });
}
