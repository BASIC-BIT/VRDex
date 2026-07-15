import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeMcpToolFailure } from "../../scripts/lib/mcp-smoke-diagnostics";

describe("MCP smoke diagnostics", () => {
  it("summarizes tool-error content and structured content", () => {
    const summary = summarizeMcpToolFailure({
      result: {
        content: [
          {
            text: "Search backend unavailable for q=club",
            type: "text",
          },
        ],
        isError: true,
        structuredContent: {
          code: "backend_unavailable",
          query: "club",
        },
      },
    });

    assert.match(summary, /isError=true/);
    assert.match(summary, /Search backend unavailable/);
    assert.match(summary, /backend_unavailable/);
  });

  it("redacts common credential shapes", () => {
    const summary = summarizeMcpToolFailure({
      error: {
        data: {
          access_token: "vrdx_access_secret",
          authorization: "Bearer secret-token",
          client_secret: "vrdx_client_secret",
          refresh_token: "vrdx_refresh_secret",
        },
        message: "Bearer another-secret-token failed",
      },
    });

    assert.doesNotMatch(summary, /secret-token/);
    assert.doesNotMatch(summary, /vrdx_access_secret/);
    assert.doesNotMatch(summary, /vrdx_client_secret/);
    assert.doesNotMatch(summary, /vrdx_refresh_secret/);
    assert.match(summary, /Bearer <redacted>/);
    assert.match(summary, /"access_token":"<redacted>"/);
    assert.match(summary, /"client_secret":"<redacted>"/);
    assert.match(summary, /"refresh_token":"<redacted>"/);
  });

  it("reports empty tool-error text instead of hiding the response shape", () => {
    const summary = summarizeMcpToolFailure({
      id: 4,
      jsonrpc: "2.0",
      result: {
        content: [{ text: "", type: "text" }],
        isError: true,
      },
    });

    assert.match(summary, /isError=true/);
    assert.match(summary, /<empty text content>/);
  });
});
