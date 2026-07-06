import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

function runSmoke(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/smoke-vrdex-mcp-compat.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );
}

describe("MCP compatibility smoke CLI", () => {
  it("can run hosted-only without local stdio profiles", () => {
    const result = runSmoke(["--hosted-only"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Hosted Streamable HTTP MCP/);
    assert.match(result.stdout, /skip/);
    assert.doesNotMatch(result.stdout, /Local stdio MCP/);
  });

  it("exits cleanly when a hosted-only target is unreachable", () => {
    const result = runSmoke(["--hosted-only", "--hosted-url", "http://127.0.0.1:9/mcp"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /fetch failed|bad port|ECONNREFUSED/i);
    assert.doesNotMatch(result.stderr, /Assertion failed/);
  });
});
