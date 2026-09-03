import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertExpectedHostedToolNames,
  assertInspectorDataBackedSearch,
} from "../../scripts/smoke-mcp-inspector-client";

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

  it("accepts the expected hosted tool set regardless of registration order", () => {
    assert.doesNotThrow(() => {
      assertExpectedHostedToolNames([
        "search",
        "fetch",
        "vrdex_search",
        "vrdex_get_profile",
        "vrdex_list_my_profiles",
        "vrdex_list_my_media_submissions",
        "vrdex_get_event",
        "vrdex_list_upcoming_events",
        "vrdex_get_world",
        "vrdex_list_active_worlds",
        "vrdex_event_create",
        "vrdex_event_update",
        "vrdex_profile_update",
        "vrdex_profile_submit",
        "vrdex_profile_media_submit",
        "vrdex_profile_media_manage",
      ]);
    });
  });

  it("rejects a hosted tool list with a missing or duplicate tool", () => {
    assert.throws(
      () => assertExpectedHostedToolNames([
        "search",
        "search",
      ]),
      /unexpected tool set/,
    );
  });
});
