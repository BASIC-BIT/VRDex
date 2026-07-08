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
              arguments: JSON.stringify({ limit: 1, query: "club", type: "all" }),
              name: "vrdex_search",
              output: JSON.stringify({
                query: "club",
                results: [{ slug: "club-night" }],
                type: "all",
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
});
