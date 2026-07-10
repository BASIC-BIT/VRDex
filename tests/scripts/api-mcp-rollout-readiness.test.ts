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
      /Generated OpenAPI contract \| yes \| pass \| 32 required API paths and JSON\/YAML artifacts are present/,
    );
    assert.match(result.stdout, /Rollout verification scripts \| yes \| pass \| 22 required scripts are defined/);
    assert.match(result.stdout, /External readiness workflow \| yes \| pass/);
    assert.match(result.stdout, /Major MCP client matrix \| yes \| pending \| .*Gemini CLI\/hosted-oauth: pending/);
    assert.doesNotMatch(result.stdout, /Gemini CLI\/hosted-anonymous-read/);
    assert.match(
      result.stdout,
      /Production-like hosted MCP evidence \| yes \| fail \| readinessMode=staging-current-evidence-failed-client-smokes-open/,
    );
  });

  it("keeps external readiness failing while required MCP client rows are not pass", () => {
    const result = runRolloutCheck(["--require-ready"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API\/MCP rollout is not externally ready/);
    assert.match(result.stderr, /Major MCP client matrix/);
    assert.match(result.stderr, /Gemini CLI\/hosted-oauth: pending/);
    assert.doesNotMatch(result.stderr, /Gemini CLI\/hosted-anonymous-read/);
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

  it("rejects stale hosted data-backed readiness pass evidence", async () => {
    const { directory, path } = await writeMatrixCopy("stale-hosted-data-evidence", (matrix) => {
      matrix.readinessMode = "repo-protocol-smoked-hosted-staging-data-backed-client-smokes-open";
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      const check = matrix.hostedReadiness?.checks.find(
        (entry: { id: string }) => entry.id === "hosted-data-backed-anonymous-read",
      );

      assert.ok(check);
      check.status = "pass";
      check.evidence = "corepack pnpm smoke:mcp-compat passed hosted data-backed anonymous vrdex_search and search only";
    });

    try {
      const result = runRolloutCheck([], { VRDEX_MCP_CLIENT_MATRIX_PATH: path });

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /hostedReadiness\/hosted-data-backed-anonymous-read evidence must mention fetch evidence/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("tracks late-slice API and matrix-recorder requirements in the aggregate gate", async () => {
    const source = await readFile("scripts/check-api-mcp-rollout-readiness.ts", "utf8");

    assert.match(source, /\/api\/v0\/profile-assets\/upload-intents\/\{intentId\}/);
    assert.match(source, /\/api\/v0\/profile-assets\/upload-intents\/probe/);
    assert.match(source, /test:web/);
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
    assert.match(installedClientsSource, /--hosted-query <known-public-query>/);
    assert.match(installedClientsSource, /--query <known-public-query>/);
  });

  it("keeps hosted MCP OAuth workflow wired to temporary smoke credential generation", async () => {
    const workflow = await readFile(".github/workflows/deployed-health.yml", "utf8");

    assert.match(workflow, /generate_oauth_credentials/);
    assert.match(workflow, /ops:mcp-oauth-smoke-credentials/);
    assert.match(workflow, /VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS/);
    assert.match(workflow, /mcp-oauth-smoke-env\.sh/);
  });

  it("moves strict readiness and session artifacts out of per-PR baseline checks", async () => {
    const baseline = await readFile(".github/workflows/baseline-checks.yml", "utf8");
    const workflow = await readFile(".github/workflows/external-api-mcp-readiness.yml", "utf8");

    assert.doesNotMatch(baseline, /ops:mcp-client-session-pack/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /verify:api-mcp-rollout:external/);
    assert.match(workflow, /smoke:mcp-compat/);
    assert.match(workflow, /VRDEX_API_MCP_EXPECT_TARGET/);
    assert.match(workflow, /VRDEX_API_MCP_EXPECT_REVISION/);
    assert.match(workflow, /ops:mcp-client-session-pack/);
    assert.match(workflow, /actions\/upload-artifact@v7/);
    assert.match(workflow, /if: always\(\)/);
  });

  it("requires external evidence to match the selected hosted target and revision", async () => {
    const { directory, path } = await writeMatrixCopy("target-revision", (matrix) => {
      matrix.readinessMode = "staging-hosted-data-dcr-cimd-pass-client-smokes-open";

      for (const check of matrix.hostedReadiness.checks) {
        check.status = "pass";
      }

      matrix.hostedReadiness.checks.find(
        (entry: { id: string }) => entry.id === "hosted-data-backed-anonymous-read",
      ).evidence = "Hosted data smoke passed vrdex_search, search, and fetch with non-empty document text.";
      matrix.hostedReadiness.checks.find(
        (entry: { id: string }) => entry.id === "hosted-dynamic-client-registration",
      ).evidence = "Dynamic Client Registration returned HTTP 201 for a constrained public MCP client with mcp:read.";
      matrix.hostedReadiness.checks.find(
        (entry: { id: string }) => entry.id === "hosted-client-id-metadata-document",
      ).evidence = "Client ID Metadata Document authorization accepted public metadata and redirected to sign-in.";
    });

    try {
      const result = runRolloutCheck([], {
        VRDEX_API_MCP_EXPECT_TARGET: "https://staging.vrdex.net/mcp",
        VRDEX_API_MCP_EXPECT_REVISION: "0123456789abcdef",
        VRDEX_MCP_CLIENT_MATRIX_PATH: path,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        /Production-like hosted MCP evidence \| yes \| pending \| .*targetEnvironment does not name selected revision 0123456789abcdef/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps rollout checklist terminology aligned with open matrix rows", async () => {
    const checklist = await readFile("docs/developers/api-mcp-rollout-checklist.md", "utf8");

    assert.match(checklist, /Open Blocker Summary/);
    assert.doesNotMatch(checklist, /Pending Blocker\s+Summary/);
  });
});
