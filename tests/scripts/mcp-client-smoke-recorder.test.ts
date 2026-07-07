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
