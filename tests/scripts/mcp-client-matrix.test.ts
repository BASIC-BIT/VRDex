import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
type HostedReadinessStatus = "fail" | "pass" | "pending";
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

type HostedReadinessCheck = {
  environment?: string;
  evidence?: string;
  id: string;
  lastRunAt?: string;
  notes?: string;
  requiredForExternalReadiness: boolean;
  status: HostedReadinessStatus;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  hostedReadiness?: {
    checks: HostedReadinessCheck[];
  };
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

const matrixPath = "docs/developers/mcp-client-smoke-results.json";

function runMatrixCheck(path: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-mcp-client-matrix.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        VRDEX_MCP_CLIENT_MATRIX_PATH: path,
        ...env,
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

function markHostedReadinessPass(matrix: SmokeMatrix, checkId: string) {
  const check = matrix.hostedReadiness?.checks.find((entry) => entry.id === checkId);

  assert.ok(check, `${checkId} hosted readiness row must exist`);

  check.status = "pass";
  check.environment = "GitHub Actions / deployed hosted MCP smoke";
  check.evidence = "sanitized hosted smoke evidence: vrdex_search returned data, search returned an id, and fetch returned document text";
  check.lastRunAt = "2026-07-06";
}

function resetHostedClientPasses(matrix: SmokeMatrix) {
  for (const client of matrix.clients) {
    for (const check of client.checks) {
      if (check.surface.startsWith("hosted_http") && check.manualStatus === "pass") {
        check.manualStatus = "pending";
        delete check.environment;
        delete check.manualEvidence;
        delete check.lastRunAt;
      }
    }
  }
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

  it("rejects hosted readiness pass rows when the target still describes pending preview evidence", async () => {
    const { directory, path } = await writeMatrixCopy("pending-hosted-readiness-target", (matrix) => {
      matrix.targetEnvironment = "same-branch preview transport smoke; Convex preview backend unavailable";
      resetHostedClientPasses(matrix);
      markHostedReadinessPass(matrix, "hosted-data-backed-anonymous-read");
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /hostedReadiness\/hosted-data-backed-anonymous-read pass targetEnvironment must not describe pending/i,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects placeholder client-row evidence in hand-edited matrix JSON", async () => {
    const { directory, path } = await writeMatrixCopy("placeholder-client-evidence", (matrix) => {
      markHostedInspectorPass(matrix);
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      const client = matrix.clients.find((entry) => entry.id === "mcp-inspector");
      const check = client?.checks.find((entry) => entry.id === "hosted-anonymous-read");

      assert.ok(check);
      check.manualEvidence = "<sanitized evidence link>";
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /mcp-inspector\/hosted-anonymous-read manualEvidence must be concrete/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects placeholder hosted-readiness evidence in hand-edited matrix JSON", async () => {
    const { directory, path } = await writeMatrixCopy("placeholder-hosted-evidence", (matrix) => {
      resetHostedClientPasses(matrix);
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      markHostedReadinessPass(matrix, "hosted-data-backed-anonymous-read");
      const check = matrix.hostedReadiness?.checks.find((entry) => entry.id === "hosted-data-backed-anonymous-read");

      assert.ok(check);
      check.evidence = "<sanitized workflow link or command output>";
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /hostedReadiness\/hosted-data-backed-anonymous-read evidence must be concrete/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects stale hosted data-backed readiness passes without search and fetch evidence", async () => {
    const { directory, path } = await writeMatrixCopy("stale-hosted-data-evidence", (matrix) => {
      resetHostedClientPasses(matrix);
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      markHostedReadinessPass(matrix, "hosted-data-backed-anonymous-read");
      const check = matrix.hostedReadiness?.checks.find((entry) => entry.id === "hosted-data-backed-anonymous-read");

      assert.ok(check);
      check.evidence = "corepack pnpm smoke:mcp-compat passed hosted data-backed anonymous vrdex_search and search only";
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /hostedReadiness\/hosted-data-backed-anonymous-read evidence must mention fetch evidence/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects token-shaped client-row evidence in hand-edited matrix JSON", async () => {
    const { directory, path } = await writeMatrixCopy("sensitive-client-evidence", (matrix) => {
      markHostedInspectorPass(matrix);
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      const client = matrix.clients.find((entry) => entry.id === "mcp-inspector");
      const check = client?.checks.find((entry) => entry.id === "hosted-anonymous-read");

      assert.ok(check);
      check.manualEvidence = "curl output included Authorization: Bearer vrdx_mcp_token_abcdefghijklmnopqrstuvwxyz";
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /mcp-inspector\/hosted-anonymous-read manualEvidence appears to contain a token/i);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects token-shaped hosted-readiness evidence in hand-edited matrix JSON", async () => {
    const { directory, path } = await writeMatrixCopy("sensitive-hosted-evidence", (matrix) => {
      resetHostedClientPasses(matrix);
      matrix.targetEnvironment = "production-like staging https://staging.vrdex.net/mcp";
      markHostedReadinessPass(matrix, "hosted-data-backed-anonymous-read");
      const check = matrix.hostedReadiness?.checks.find((entry) => entry.id === "hosted-data-backed-anonymous-read");

      assert.ok(check);
      check.evidence = "workflow transcript included client_secret=abcdefghijklmnopqrstuvwxyz";
    });

    try {
      const result = runMatrixCheck(path);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /hostedReadiness\/hosted-data-backed-anonymous-read evidence appears to contain a token/i);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a stale compatibility doc review date", async () => {
    const { directory, path } = await writeMatrixCopy("stale-compatibility-doc", () => {});
    const docPath = join(directory, "mcp-client-compatibility.md");

    await writeFile(
      docPath,
      [
        "# MCP Client Compatibility Matrix",
        "",
        "Last reviewed: 2026-07-08.",
        "",
      ].join("\n"),
    );

    try {
      const result = runMatrixCheck(path, {
        VRDEX_MCP_CLIENT_COMPATIBILITY_DOC_PATH: docPath,
      });

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /MCP client compatibility doc Last reviewed date must match matrix lastReviewed \(2026-07-12\)/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
