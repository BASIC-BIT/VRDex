import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
type SmokeSurface =
  | "hosted_http_anonymous"
  | "hosted_http_diagnostic"
  | "hosted_http_oauth"
  | "local_stdio";

type SmokeCheck = {
  environment?: string;
  id: string;
  lastRunAt?: string;
  manualEvidence?: string;
  manualStatus: ManualStatus;
  notes?: string;
  repoEvidence?: string;
  requiredForExternalReadiness: boolean;
  surface: SmokeSurface;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

const matrixPath = "docs/developers/mcp-client-smoke-results.json";

function runMatrixCheck(path: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-mcp-client-matrix.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VRDEX_MCP_CLIENT_MATRIX_PATH: path,
      },
    },
  );
}

async function writeMatrixCopy(name: string, transform: (matrix: SmokeMatrix) => void) {
  const directory = await mkdtemp(join(tmpdir(), `vrdex-mcp-matrix-${name}-`));

  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as SmokeMatrix;
  transform(matrix);

  const path = join(directory, "matrix.json");
  await writeFile(path, `${JSON.stringify(matrix, null, 2)}\n`);

  return { directory, path };
}

function markHostedInspectorPass(matrix: SmokeMatrix) {
  const client = matrix.clients.find((entry) => entry.id === "mcp-inspector");
  assert.ok(client, "mcp-inspector client row must exist");

  const check = client.checks.find((entry) => entry.id === "hosted-anonymous-read");
  assert.ok(check, "mcp-inspector hosted-anonymous-read row must exist");

  check.manualStatus = "pass";
  check.environment = "Windows / MCP Inspector CLI / hosted HTTP";
  check.manualEvidence = "sanitized hosted data-backed search evidence";
  check.lastRunAt = "2026-07-06";
}

describe("MCP client matrix verifier", () => {
  it("rejects hosted pass rows when the target still describes pending preview evidence", async () => {
    const { directory, path } = await writeMatrixCopy("pending-hosted-target", (matrix) => {
      matrix.targetEnvironment = "PR preview transport smoke; same-branch backend pending";
      markHostedInspectorPass(matrix);
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /hosted pass targetEnvironment must not describe pending/i,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("accepts hosted pass rows when the target names production-like backing evidence", async () => {
    const { directory, path } = await writeMatrixCopy("production-like-hosted-target", (matrix) => {
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      markHostedInspectorPass(matrix);
    });

    try {
      const result = runMatrixCheck(path);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /MCP Inspector/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
