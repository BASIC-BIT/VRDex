import assert from "node:assert/strict";
import { it } from "node:test";
import { labelForEditedDestination } from "../../apps/web/src/lib/profile-link-label";

const original = { type: "website" as const, url: "https://example.com/sets", label: "My sets" };
it("restores the stored label after a URL edit is undone", () => {
  const changed = labelForEditedDestination(original, "https://another.example", original.label, false);
  assert.equal(changed, "");
  assert.equal(labelForEditedDestination(original, original.url, changed, false), "My sets");
});
it("preserves intentional label changes including an explicit clear when restoring the URL", () => {
  for (const label of ["New label", ""]) {
    const changed = labelForEditedDestination(original, "https://another.example", label, true);
    assert.equal(labelForEditedDestination(original, original.url, changed, true), label);
  }
});
it("keeps the original label for cosmetically equivalent destinations", () => {
  assert.equal(labelForEditedDestination(original, "https://EXAMPLE.com/sets", "", false), "My sets");
});
