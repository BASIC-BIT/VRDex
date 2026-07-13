import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldRefreshBulkPrivateLookup } from "../../apps/web/src/app/_components/lookup-private-refresh";

describe("private bulk lookup refresh", () => {
  it("replays a populated lineup once when the private lookup flag becomes ready", () => {
    const input = { bulkEntryCount: 2, flagEnabled: true, lineCount: 2 };
    assert.equal(shouldRefreshBulkPrivateLookup({ ...input, refreshAttempted: false }), true);
    assert.equal(shouldRefreshBulkPrivateLookup({ ...input, refreshAttempted: true }), false);
  });

  it("waits for both rendered bulk results and an enabled flag", () => {
    assert.equal(shouldRefreshBulkPrivateLookup({
      bulkEntryCount: 0,
      flagEnabled: true,
      lineCount: 2,
      refreshAttempted: false,
    }), false);
    assert.equal(shouldRefreshBulkPrivateLookup({
      bulkEntryCount: 2,
      flagEnabled: false,
      lineCount: 2,
      refreshAttempted: false,
    }), false);
  });
});
