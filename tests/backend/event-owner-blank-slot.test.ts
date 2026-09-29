import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeEventSlotInputs } from "../../convex/_eventSlots";
test("owner can save a timed slot without manufacturing a performer name", () => {
  assert.equal(sanitizeEventSlotInputs([{ displayLabel: "", startAt: 1000 }], "Community")[0]?.displayLabel, "");
});
