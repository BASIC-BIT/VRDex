import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertClaudeDataBackedSearch } from "../../scripts/smoke-claude-code-mcp-client";

describe("Claude Code MCP smoke harness", () => {
  const search = { limit: 1, query: "club", type: "all" as const };

  it("accepts a non-empty hosted data-backed search result", () => {
    assert.doesNotThrow(() => {
      assertClaudeDataBackedSearch(
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
      () => assertClaudeDataBackedSearch({ query: "club", results: [], type: "all" }, search),
      /returned no public results/,
    );
  });
});
