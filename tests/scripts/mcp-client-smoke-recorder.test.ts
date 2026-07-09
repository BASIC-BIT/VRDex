import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

type SmokeMatrix = {
  targetEnvironment: string | null;
};

const matrixPath = "docs/developers/mcp-client-smoke-results.json";

function runRecorder(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/record-mcp-client-smoke.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

async function writeMatrixCopy(name: string) {
  const directory = await mkdtemp(join(tmpdir(), `vrdex-mcp-client-recorder-${name}-`));
  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as SmokeMatrix;
  const path = join(directory, "matrix.json");

  await writeFile(path, `${JSON.stringify(matrix, null, 2)}\n`);

  return { directory, path };
}

describe("MCP client smoke recorder", () => {
  it("records a completed generated evidence worksheet", async () => {
    const { directory, path } = await writeMatrixCopy("evidence-file");
    const evidencePath = join(directory, "vscode-hosted-anonymous-read.md");

    await writeFile(
      evidencePath,
      [
        "# VS Code hosted-anonymous-read MCP Smoke Evidence",
        "",
        "Status: pass",
        "",
        "Matrix row: vscode/hosted-anonymous-read",
        "Environment: Windows / VS Code 1.127.0 / isolated user-data / https://staging.vrdex.net/mcp",
        "Target environment: staging https://staging.vrdex.net/mcp",
        "",
        "## Sanitized Evidence Summary",
        "",
        "Sanitized screenshot artifact .tmp-gh-artifacts/vscode-hosted-anonymous.png shows tools/list and one vrdex_search query=club type=all limit=1 returning slug club-night.",
        "",
      ].join("\n"),
    );

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--evidence-file",
        evidencePath,
        "--dry-run",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Recorded VS Code \/ hosted-anonymous-read: pass/);
      assert.match(result.stdout, /"manualStatus": "pass"/);
      assert.match(result.stdout, /"targetEnvironment": "staging https:\/\/staging\.vrdex\.net\/mcp"/);
      assert.match(result.stdout, /vscode-hosted-anonymous\.png shows tools\/list/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("records a failed generated evidence worksheet", async () => {
    const { directory, path } = await writeMatrixCopy("failed-evidence-file");
    const evidencePath = join(directory, "gemini-cli-local-stdio.md");

    await writeFile(
      evidencePath,
      [
        "# Gemini CLI local-stdio MCP Smoke Evidence",
        "",
        "Status: fail",
        "",
        "Matrix row: gemini-cli/local-stdio",
        "Environment: Windows / Gemini CLI 0.50.0 / disposable package / local stdio",
        "Target environment: not applicable for local stdio",
        "",
        "## Sanitized Evidence Summary",
        "",
        "Gemini CLI reached provider quota before any MCP tool call, so no tools/list or vrdex_search evidence was produced.",
        "",
      ].join("\n"),
    );

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--evidence-file",
        evidencePath,
        "--dry-run",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Recorded Gemini CLI \/ local-stdio: fail/);
      assert.match(result.stdout, /"manualStatus": "fail"/);
      assert.match(result.stdout, /provider quota before any MCP tool call/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a generated evidence worksheet that is still pending", async () => {
    const { directory, path } = await writeMatrixCopy("pending-evidence-file");
    const evidencePath = join(directory, "vscode-local-stdio.md");

    await writeFile(
      evidencePath,
      [
        "# VS Code local-stdio MCP Smoke Evidence",
        "",
        "Status: pending until a real client session lists tools and calls `vrdex_search`.",
        "",
        "Matrix row: vscode/local-stdio",
        "Environment: Windows / VS Code / isolated user-data / local stdio",
        "Target environment: not applicable for local stdio",
        "",
        "## Sanitized Evidence Summary",
        "",
        "Replace this paragraph with the sanitized screenshot path, transcript path, or PR artifact URL before running the recorder command.",
        "",
      ].join("\n"),
    );

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--evidence-file",
        evidencePath,
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /is still pending/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a completed worksheet when its evidence summary still has placeholder text", async () => {
    const { directory, path } = await writeMatrixCopy("placeholder-evidence-file");
    const evidencePath = join(directory, "vscode-local-stdio.md");

    await writeFile(
      evidencePath,
      [
        "# VS Code local-stdio MCP Smoke Evidence",
        "",
        "Status: pass",
        "",
        "Matrix row: vscode/local-stdio",
        "Environment: Windows / VS Code / isolated user-data / local stdio",
        "Target environment: not applicable for local stdio",
        "",
        "## Sanitized Evidence Summary",
        "",
        "Replace this paragraph with the sanitized screenshot path, transcript path, or PR artifact URL before running the recorder command.",
        "",
      ].join("\n"),
    );

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--evidence-file",
        evidencePath,
        "--evidence",
        "manual evidence override should not hide an untouched worksheet summary",
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /placeholder text/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects placeholder evidence for pass rows", async () => {
    const { directory, path } = await writeMatrixCopy("placeholder-evidence");

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--client",
        "mcp-inspector",
        "--check",
        "hosted-anonymous-read",
        "--status",
        "pass",
        "--target-environment",
        "staging https://staging.vrdex.net/mcp",
        "--environment",
        "Windows / MCP Inspector CLI / staging",
        "--evidence",
        "<sanitized evidence link>",
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--evidence must be concrete/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects placeholder hosted target environments for pass rows", async () => {
    const { directory, path } = await writeMatrixCopy("placeholder-target");

    try {
      const result = runRecorder([
        "--matrix",
        path,
        "--client",
        "mcp-inspector",
        "--check",
        "hosted-anonymous-read",
        "--status",
        "pass",
        "--target-environment",
        "<same-branch Convex preview / staging / production-like target>",
        "--environment",
        "Windows / MCP Inspector CLI / staging",
        "--evidence",
        "corepack pnpm smoke:mcp-inspector passed hosted data-backed search",
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /--target-environment must be concrete/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
