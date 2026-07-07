import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runPreflight(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-mcp-client-add-mcp-preflight.ts", "--", ...args],
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

async function writeFakeCli(directory: string, body: string) {
  const scriptPath = join(directory, "fake-client.mjs");

  await writeFile(scriptPath, body, "utf8");

  return JSON.stringify([process.execPath, scriptPath]);
}

describe("VS Code-family MCP add preflight", () => {
  it("passes when a client accepts the generated add-mcp JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-add-preflight-"));
    const outputDir = join(directory, "out");
    const commandOverride = await writeFakeCli(
      directory,
      [
        "const args = process.argv.slice(2);",
        "const userData = args[args.indexOf('--user-data-dir') + 1];",
        "const payload = args[args.indexOf('--add-mcp') + 1];",
        "const config = JSON.parse(payload);",
        "if (!userData || !userData.includes('vscode')) process.exit(11);",
        "if (config.name !== 'vrdex' || config.type !== 'http') process.exit(12);",
        "if (config.url !== 'https://staging.vrdex.net/mcp') process.exit(13);",
        "console.log('Added MCP servers: vrdex');",
      ].join("\n"),
    );

    try {
      const result = runPreflight(
        [
          "--client",
          "vscode",
          "--config",
          "hosted-anonymous-read",
          "--hosted-url",
          "https://staging.vrdex.net/mcp",
          "--output-dir",
          outputDir,
        ],
        {
          VRDEX_MCP_ADD_MCP_VSCODE_COMMAND: commandOverride,
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /VS Code/);
      assert.match(result.stdout, /hosted-anonymous-read/);
      assert.match(result.stdout, /pass/);
      assert.match(result.stdout, /Added MCP servers: vrdex/);

      const config = JSON.parse(
        await readFile(join(outputDir, "configs", "vscode-hosted-anonymous-read.add-mcp.json"), "utf8"),
      ) as {
        type?: string;
        url?: string;
      };

      assert.equal(config.type, "http");
      assert.equal(config.url, "https://staging.vrdex.net/mcp");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("fails when an installed client rejects the generated add-mcp JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-add-preflight-"));
    const commandOverride = await writeFakeCli(
      directory,
      [
        "console.error('invalid add-mcp payload');",
        "process.exit(9);",
      ].join("\n"),
    );

    try {
      const result = runPreflight(
        [
          "--client",
          "cursor",
          "--config",
          "local-stdio",
          "--hosted-url",
          "https://staging.vrdex.net/mcp",
          "--output-dir",
          join(directory, "out"),
        ],
        {
          VRDEX_MCP_ADD_MCP_CURSOR_COMMAND: commandOverride,
        },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /Cursor/);
      assert.match(result.stdout, /local-stdio/);
      assert.match(result.stdout, /fail/);
      assert.match(result.stdout, /invalid add-mcp payload/);
      assert.match(result.stderr, /MCP add preflight failed: Cursor\/local-stdio/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("can treat a missing selected client as a required failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-add-preflight-"));

    try {
      const result = runPreflight(
        [
          "--client",
          "windsurf",
          "--config",
          "hosted-anonymous-read",
          "--hosted-url",
          "https://staging.vrdex.net/mcp",
          "--output-dir",
          join(directory, "out"),
          "--require-installed",
        ],
        {
          VRDEX_MCP_ADD_MCP_WINDSURF_COMMAND: JSON.stringify(["definitely-not-real-vrdex-mcp-client"]),
        },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /Windsurf/);
      assert.match(result.stdout, /fail/);
      assert.match(result.stdout, /not installed or not on PATH/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("redacts bearer tokens from client command output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vrdex-mcp-add-preflight-"));
    const token = "vrdex-test-token-abc123";
    const commandOverride = await writeFakeCli(
      directory,
      [
        "const args = process.argv.slice(2);",
        "const payload = args[args.indexOf('--add-mcp') + 1];",
        "console.log(payload);",
      ].join("\n"),
    );

    try {
      const result = runPreflight(
        [
          "--client",
          "vscode",
          "--config",
          "hosted-token-fallback",
          "--hosted-url",
          "https://staging.vrdex.net/mcp",
          "--mcp-bearer-token-env",
          "VRDEX_TEST_MCP_ADD_TOKEN",
          "--output-dir",
          join(directory, "out"),
        ],
        {
          VRDEX_MCP_ADD_MCP_VSCODE_COMMAND: commandOverride,
          VRDEX_TEST_MCP_ADD_TOKEN: token,
        },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout, new RegExp(token));
      assert.match(result.stdout, /Bearer \[REDACTED\]/);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
