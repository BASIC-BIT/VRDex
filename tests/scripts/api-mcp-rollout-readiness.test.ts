import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runRolloutCheck(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-api-mcp-rollout-readiness.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

async function writeMatrixCopy(name: string, mutate: (matrix: any) => void) {
  const directory = await mkdtemp(join(tmpdir(), `vrdex-api-mcp-rollout-${name}-`));
  const matrix = JSON.parse(await readFile("docs/developers/mcp-client-smoke-results.json", "utf8"));
  const path = join(directory, "matrix.json");

  mutate(matrix);
  await writeFile(path, `${JSON.stringify(matrix, null, 2)}\n`);

  return { directory, path };
}

describe("API/MCP rollout readiness checker", () => {
  it("summarizes the full current OpenAPI surface and recorder scripts", () => {
    const result = runRolloutCheck();

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Generated OpenAPI contract \| yes \| pass \| 30 required API paths and JSON\/YAML artifacts are present/,
    );
    assert.match(result.stdout, /Rollout verification scripts \| yes \| pass \| 20 required scripts are defined/);
    assert.match(result.stdout, /Major MCP client matrix \| yes \| fail \| .*Gemini CLI\/local-stdio: fail/);
  });

  it("keeps external readiness failing while required MCP client rows are not pass", () => {
    const result = runRolloutCheck(["--require-ready"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API\/MCP rollout is not externally ready/);
    assert.match(result.stderr, /Major MCP client matrix/);
    assert.match(result.stderr, /Gemini CLI\/local-stdio: fail/);
    assert.match(result.stderr, /Gemini CLI\/hosted-anonymous-read: fail/);
  });

  it("rejects token-shaped manual matrix evidence", async () => {
    const { directory, path } = await writeMatrixCopy("sensitive-client-evidence", (matrix) => {
      const client = matrix.clients.find((entry: { id: string }) => entry.id === "mcp-inspector");
      const check = client?.checks.find((entry: { id: string }) => entry.id === "hosted-anonymous-read");

      assert.ok(check);
      check.manualEvidence = "curl output included Authorization: Bearer vrdx_mcp_token_abcdefghijklmnopqrstuvwxyz";
    });

    try {
      const result = runRolloutCheck([], { VRDEX_MCP_CLIENT_MATRIX_PATH: path });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /MCP Inspector\/hosted-anonymous-read manualEvidence appears to contain a token/i);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects token-shaped hosted readiness evidence", async () => {
    const { directory, path } = await writeMatrixCopy("sensitive-hosted-evidence", (matrix) => {
      const check = matrix.hostedReadiness?.checks.find(
        (entry: { id: string }) => entry.id === "hosted-data-backed-anonymous-read",
      );

      assert.ok(check);
      check.evidence = "workflow transcript included client_secret=abcdefghijklmnopqrstuvwxyz";
    });

    try {
      const result = runRolloutCheck([], { VRDEX_MCP_CLIENT_MATRIX_PATH: path });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /hostedReadiness\/hosted-data-backed-anonymous-read evidence appears to contain a token/i);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("tracks late-slice API and matrix-recorder requirements in the aggregate gate", async () => {
    const source = await readFile("scripts/check-api-mcp-rollout-readiness.ts", "utf8");

    assert.match(source, /\/api\/v0\/profile-assets\/upload-intents\/\{intentId\}/);
    assert.match(source, /record:mcp-client-smoke/);
    assert.match(source, /ops:mcp-client-session-pack/);
    assert.match(source, /ops:mcp-add-mcp-preflight/);
    assert.match(source, /ops:mcp-oauth-smoke-credentials/);
    assert.match(source, /ops:mcp-hosted-oauth-prereqs/);
    assert.match(source, /ops:api-platform-observability/);
    assert.match(source, /smoke:mcp-gemini-cli/);
    assert.match(source, /hasFailedRequiredRow/);

    const installedClientsSource = await readFile("scripts/check-installed-mcp-clients.ts", "utf8");

    assert.match(installedClientsSource, /current process environment/);
    assert.match(installedClientsSource, /ops:mcp-hosted-oauth-prereqs/);
    assert.match(installedClientsSource, /CLI Automation Surface Notes/);
    assert.match(installedClientsSource, /Desktop And Hosted Product Preconditions/);
    assert.match(installedClientsSource, /Model Provider Credential Preconditions/);
    assert.match(installedClientsSource, /OPENAI_API_KEY/);
    assert.match(installedClientsSource, /GEMINI_API_KEY/);
    assert.match(installedClientsSource, /Claude Desktop/);
    assert.match(installedClientsSource, /stdout transcript/);
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

  it("keeps rollout checklist terminology aligned with open matrix rows", async () => {
    const checklist = await readFile("docs/developers/api-mcp-rollout-checklist.md", "utf8");

    assert.match(checklist, /Open Blocker Summary/);
    assert.doesNotMatch(checklist, /Pending Blocker Summary/);
  });
});
