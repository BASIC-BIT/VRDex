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
    assert.match(result.stdout, /Rollout verification scripts \| yes \| pass \| 16 required scripts are defined/);
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
    assert.match(source, /ops:mcp-client-session-pack/);
    assert.match(source, /ops:mcp-add-mcp-preflight/);
    assert.match(source, /ops:mcp-oauth-smoke-credentials/);
    assert.match(source, /ops:mcp-hosted-oauth-prereqs/);

    const installedClientsSource = await readFile("scripts/check-installed-mcp-clients.ts", "utf8");

    assert.match(installedClientsSource, /current process environment/);
    assert.match(installedClientsSource, /ops:mcp-hosted-oauth-prereqs/);
  });

  it("keeps hosted MCP OAuth workflow wired to temporary smoke credential generation", async () => {
    const workflow = await readFile(".github/workflows/deployed-health.yml", "utf8");

    assert.match(workflow, /generate_oauth_credentials/);
    assert.match(workflow, /ops:mcp-oauth-smoke-credentials/);
    assert.match(workflow, /VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS/);
    assert.match(workflow, /mcp-oauth-smoke-env\.sh/);
  });

  it("uploads the MCP client session pack from PR baseline checks", async () => {
    const workflow = await readFile(".github/workflows/baseline-checks.yml", "utf8");

    assert.match(workflow, /ops:mcp-client-session-pack/);
    assert.match(workflow, /mcp-client-session-pack/);
    assert.match(workflow, /actions\/upload-artifact@v7/);
    assert.match(workflow, /docs\/developers\/mcp-client-smoke-results\.json/);
  });
});
