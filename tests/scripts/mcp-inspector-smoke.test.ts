import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertExpectedHostedToolNames,
  assertInspectorDataBackedSearch,
} from "../../scripts/smoke-mcp-inspector-client";
import { assertHostedContributionSchemas, assertHostedToolSecuritySchemes, hostedExpectedToolNames } from "../../scripts/smoke-vrdex-mcp-compat";

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
    for (const name of [
      "vrdex_contribution_batch_append",
      "vrdex_media_review_decide",
      "vrdex_media_contribution_get",
      "vrdex_media_contribution_manage",
      "vrdex_media_contribution_place",
      "vrdex_media_contribution_propose_placement",
      "vrdex_event_intake_publish",
    ]) {
      assert.ok(hostedExpectedToolNames.includes(name));
    }
    assert.ok(!hostedExpectedToolNames.includes("vrdex_media_submission_declare"));
    assert.doesNotThrow(() => {
      assertExpectedHostedToolNames([...hostedExpectedToolNames].reverse());
    });
  });

  it("rejects a hosted tool list with a missing or duplicate tool", () => {
    assert.throws(
      () => assertExpectedHostedToolNames(hostedExpectedToolNames.slice(1)),
      /unexpected tool set/,
    );
    assert.throws(
      () => assertExpectedHostedToolNames([...hostedExpectedToolNames, hostedExpectedToolNames[0]]),
      /unexpected tool set/,
    );
  });

  it("requires strict contribution command and detail schemas", () => {
    const schema = { type: "object", additionalProperties: false, required: ["submissionId", "expectedContributionVersion", "idempotencyKey", "action"], properties: { submissionId: { type: "string" }, expectedContributionVersion: { type: "string" }, idempotencyKey: { type: "string" }, action: { enum: ["select_primary", "clear_primary"] } } };
    const tool = { name: "vrdex_media_contribution_place", inputSchema: schema, outputSchema: { type: "object", required: ["operationId", "operationState"] } };
    assert.doesNotThrow(() => assertHostedContributionSchemas(tool));
    assert.throws(() => assertHostedContributionSchemas({ ...tool, inputSchema: { ...schema, additionalProperties: true } }), /strict/);
    assert.throws(() => assertHostedContributionSchemas({ ...tool, outputSchema: {} }), /receipt/);
    assert.throws(() => assertHostedContributionSchemas({ ...tool, inputSchema: { ...schema, properties: { ...schema.properties, action: { enum: ["select_primary"] } } } }), /placement/);
  });

  it("checks multi-scope contribution tool metadata", () => {
    assert.doesNotThrow(() => assertHostedToolSecuritySchemes({
      name: "vrdex_contribution_batch_append",
      _meta: { securitySchemes: [
        { scopes: ["mcp:write", "profile:contribute"], type: "oauth2" },
        { scopes: ["mcp:write", "assets:contribute"], type: "oauth2" },
        { scopes: ["mcp:write", "assets:contribute", "profile:contribute"], type: "oauth2" },
      ] },
    }));
    assert.throws(() => assertHostedToolSecuritySchemes({
      name: "vrdex_contribution_batch_append",
      _meta: { securitySchemes: [{ scopes: ["mcp:write", "assets:contribute"], type: "oauth2" }] },
    }), /missing write auth metadata/);
  });
});
