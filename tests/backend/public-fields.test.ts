import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { firstSafeHttpsUrl, safeHttpsUrl } from "../../convex/_publicFields";

describe("public HTTPS fields", () => {
  it("keeps ordinary HTTPS URLs", () => {
    assert.equal(safeHttpsUrl("https://example.com/path?q=public"), "https://example.com/path?q=public");
  });

  it("rejects embedded credentials and non-HTTPS protocols", () => {
    assert.equal(safeHttpsUrl("https://user:secret@example.com/path"), undefined);
    assert.equal(safeHttpsUrl("http://example.com/path"), undefined);
  });

  it("skips unsafe candidates when selecting a fallback", () => {
    assert.equal(
      firstSafeHttpsUrl("https://user:secret@example.com/path", "https://example.com/safe"),
      "https://example.com/safe",
    );
  });
});
