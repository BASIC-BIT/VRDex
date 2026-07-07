import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runSessionPack(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-mcp-client-smoke-session.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

describe("MCP client smoke session pack", () => {
  it("writes disposable VS Code-family MCP configs and recorder guidance", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "vrdex-mcp-client-session-"));

    try {
      const result = runSessionPack([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--output-dir",
        outputDir,
        "--target-environment",
        "staging https://staging.vrdex.net/mcp",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /MCP client smoke session pack/);

      const readme = await readFile(join(outputDir, "README.md"), "utf8");

      assert.match(readme, /## VS Code/);
      assert.match(readme, /## Cursor/);
      assert.match(readme, /## Windsurf/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client vscode --check local-stdio/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client cursor --check hosted-anonymous-read/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client devin-windsurf --check hosted-oauth/);
      assert.match(readme, /Get-Content -Raw/);

      const localConfig = JSON.parse(
        await readFile(join(outputDir, "configs", "vscode-local-stdio.add-mcp.json"), "utf8"),
      ) as {
        args?: string[];
        env?: Record<string, string>;
        name?: string;
      };

      assert.equal(localConfig.name, "vrdex");
      assert.equal(localConfig.env?.VRDEX_API_BASE_URL, "https://staging.vrdex.net");
      assert.deepEqual(localConfig.args?.slice(-3), ["exec", "tsx", "packages/vrdex-mcp/src/stdio.ts"]);

      const hostedTokenConfig = JSON.parse(
        await readFile(join(outputDir, "configs", "windsurf-hosted-token.add-mcp.json"), "utf8"),
      ) as {
        headers?: Record<string, string>;
        type?: string;
        url?: string;
      };

      assert.equal(hostedTokenConfig.type, "http");
      assert.equal(hostedTokenConfig.url, "https://staging.vrdex.net/mcp");
      assert.equal(hostedTokenConfig.headers?.Authorization, "Bearer <mcp-resource-token>");
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });
});
