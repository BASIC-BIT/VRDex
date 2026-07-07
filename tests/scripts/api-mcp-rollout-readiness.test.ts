import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

function runRolloutCheck(args: string[] = []) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-api-mcp-rollout-readiness.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

describe("API/MCP rollout readiness checker", () => {
  it("summarizes the full current OpenAPI surface and recorder scripts", () => {
    const result = runRolloutCheck();

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Generated OpenAPI contract \| yes \| pass \| 30 required API paths are present/);
    assert.match(result.stdout, /Rollout verification scripts \| yes \| pass \| 12 required scripts are defined/);
  });

  it("keeps external readiness failing while required MCP client rows are pending", () => {
    const result = runRolloutCheck(["--require-ready"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API\/MCP rollout is not externally ready/);
    assert.match(result.stderr, /Major MCP client matrix/);
  });

  it("tracks late-slice API and matrix-recorder requirements in the aggregate gate", async () => {
    const source = await readFile("scripts/check-api-mcp-rollout-readiness.ts", "utf8");

    assert.match(source, /\/api\/v0\/profile-assets\/upload-intents\/\{intentId\}/);
    assert.match(source, /record:mcp-client-smoke/);
  });
});
