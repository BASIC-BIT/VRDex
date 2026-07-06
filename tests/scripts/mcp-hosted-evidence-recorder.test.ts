import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

type HostedReadinessCheck = {
  environment?: string;
  evidence?: string;
  id: string;
  lastRunAt?: string;
  status: "fail" | "pass" | "pending";
};

type SmokeMatrix = {
  hostedReadiness: {
    checks: HostedReadinessCheck[];
  };
  targetEnvironment: string | null;
};

const matrixPath = "docs/developers/mcp-client-smoke-results.json";

function runRecorder(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/record-hosted-mcp-evidence.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

async function writeMatrixCopy(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `vrdex-mcp-hosted-evidence-${name}-`));
  const raw = await readFile(matrixPath, "utf8");
  const path = join(directory, "matrix.json");

  await writeFile(path, raw);

  return { directory, path };
}

describe("hosted MCP evidence recorder", () => {
  it("records a production-like hosted readiness pass with required evidence", async () => {
    const { directory, path } = await writeMatrixCopy("record-pass");

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--check",
        "hosted-data-backed-anonymous-read",
        "--status",
        "pass",
        "--target-environment",
        "production-like staging https://staging.vrdex.net/mcp",
        "--environment",
        "GitHub Actions / hosted MCP smoke",
        "--evidence",
        "https://github.com/BASIC-BIT/VRDex/actions/runs/example",
        "--last-run-at",
        "2026-07-06",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Recorded hosted MCP evidence hosted-data-backed-anonymous-read: pass/);

      const matrix = JSON.parse(await readFile(path, "utf8")) as SmokeMatrix;
      const check = matrix.hostedReadiness.checks.find((entry) => entry.id === "hosted-data-backed-anonymous-read");

      assert.equal(matrix.targetEnvironment, "production-like staging https://staging.vrdex.net/mcp");
      assert.equal(check?.status, "pass");
      assert.equal(check?.environment, "GitHub Actions / hosted MCP smoke");
      assert.equal(check?.evidence, "https://github.com/BASIC-BIT/VRDex/actions/runs/example");
      assert.equal(check?.lastRunAt, "2026-07-06");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects hosted readiness passes that still describe unavailable backend evidence", async () => {
    const { directory, path } = await writeMatrixCopy("reject-pending-target");

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--check",
        "hosted-dynamic-client-registration",
        "--status",
        "pass",
        "--target-environment",
        "same-branch preview unavailable because Convex deployment was skipped",
        "--environment",
        "GitHub Actions / hosted MCP smoke",
        "--evidence",
        "https://github.com/BASIC-BIT/VRDex/actions/runs/example",
      ]);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /target-environment for a hosted pass must not describe pending, skipped, unavailable, or non-data-backed evidence/i,
      );

      const matrix = JSON.parse(await readFile(path, "utf8")) as SmokeMatrix;
      const check = matrix.hostedReadiness.checks.find((entry) => entry.id === "hosted-dynamic-client-registration");

      assert.equal(check?.status, "pending");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
