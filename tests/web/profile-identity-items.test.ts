import assert from "node:assert/strict";
import { it } from "node:test";
import { uniqueProfileIdentityItems } from "../../apps/web/src/lib/profile-identity-items";
it("shows repeated identity labels only once while preserving owner spelling", () => {
  assert.deepEqual(uniqueProfileIdentityItems(["DJ", "dj", " DJ ", undefined, "Producer"]), ["DJ", "Producer"]);
});
