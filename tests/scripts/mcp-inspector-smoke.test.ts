import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertInspectorDataBackedSearch } from "../../scripts/smoke-mcp-inspector-client";

describe("MCP Inspector smoke harness", () => {
  const search = { limit: 1, query: "club", type: "all" as const };

  it("accepts a non-empty hosted data-backed search result", () => {
    assert.doesNotThrow(() => {
      assertInspectorDataBackedSearch(
        {
          query: "club",
          results: [{ slug: "club-night" }],
          type: "all",
        },
        search,
      );
    });
  });

  it("rejects an empty hosted search result as non-data-backed", () => {
    assert.throws(
      () => assertInspectorDataBackedSearch({ query: "club", results: [], type: "all" }, search),
      /returned no public results/,
    );
  });
});
