import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

function runOpenAiSmoke(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/smoke-openai-mcp-client.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        ...env,
      },
    },
  );
}

describe("OpenAI Responses API MCP smoke harness", () => {
  it("fails closed when no OpenAI API key is available", () => {
    const result = runOpenAiSmoke([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--hosted-data",
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /OPENAI_API_KEY is required/);
    assert.doesNotMatch(result.stderr, /Bearer /);
  });

  it("accepts a fixture-backed MCP tool call response for tests", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-openai-mcp-test-"));
    const fixturePath = path.join(tempDir, "responses.json");

    try {
      writeFileSync(
        fixturePath,
        JSON.stringify({
          output: [
            {
              arguments: JSON.stringify({ query: "club" }),
              name: "search",
              output: JSON.stringify({
                results: [{ id: "event:club-night", title: "Club Night", url: "https://staging.vrdex.net/e/club-night" }],
              }),
              type: "mcp_call",
            },
            {
              arguments: JSON.stringify({ id: "event:club-night" }),
              name: "fetch",
              output: JSON.stringify({
                id: "event:club-night",
                metadata: { entityType: "event", slug: "club-night" },
                text: "Title: Club Night\\nEntity type: event",
                title: "Club Night",
                url: "https://staging.vrdex.net/e/club-night",
              }),
              type: "mcp_call",
            },
            {
              content: [{ text: "openai-mcp-ok", type: "output_text" }],
              role: "assistant",
              type: "message",
            },
          ],
          output_text: "openai-mcp-ok",
        }),
        "utf8",
      );

      const result = runOpenAiSmoke([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--hosted-data",
        "--fixture",
        fixturePath,
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /OpenAI Responses API hosted anonymous MCP \| pass/);
      assert.match(result.stdout, /ChatGPT app hosted MCP \| skip/);
      assert.match(result.stdout, /query="club", type=all, limit=1/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("reports assertion failures without a process abort", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-openai-mcp-test-"));
    const fixturePath = path.join(tempDir, "responses.json");

    try {
      writeFileSync(
        fixturePath,
        JSON.stringify({
          output: [
            {
              content: [{ text: "not-ok", type: "output_text" }],
              role: "assistant",
              type: "message",
            },
          ],
        }),
        "utf8",
      );

      const result = runOpenAiSmoke([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--hosted-data",
        "--fixture",
        fixturePath,
      ]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /OpenAI response did not include a search MCP tool call/);
      assert.doesNotMatch(result.stderr, /Assertion failed/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
