import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startVrdexMcpApiFixture } from "../packages/vrdex-mcp/tests/api-fixture";

type ClaudeJsonResult = {
  is_error?: boolean;
  result?: string;
  subtype?: string;
  type?: string;
};

type SmokeOptions = {
  claudeCommand: string;
  maxBudgetUsd: string;
  model?: string;
};

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function defaultClaudeCommand() {
  if (process.platform !== "win32") {
    return "claude";
  }

  const bundledExe = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );

  return existsSync(bundledExe) ? bundledExe : "claude.cmd";
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    claudeCommand: nonEmpty(process.env.VRDEX_CLAUDE_CODE_COMMAND) ?? defaultClaudeCommand(),
    maxBudgetUsd: nonEmpty(process.env.VRDEX_CLAUDE_CODE_MAX_BUDGET_USD) ?? "0.25",
    model: nonEmpty(process.env.VRDEX_CLAUDE_CODE_MODEL),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--":
        break;
      case "--claude-command":
        assert(next !== undefined && !next.startsWith("--"), "--claude-command requires a value.");
        options.claudeCommand = next;
        index += 1;
        break;
      case "--max-budget-usd":
        assert(next !== undefined && !next.startsWith("--"), "--max-budget-usd requires a value.");
        options.maxBudgetUsd = next;
        index += 1;
        break;
      case "--model":
        assert(next !== undefined && !next.startsWith("--"), "--model requires a value.");
        options.model = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.notEqual(options.claudeCommand.trim(), "", "--claude-command must not be empty.");
  assert.notEqual(options.maxBudgetUsd.trim(), "", "--max-budget-usd must not be empty.");

  return options;
}

function run(command: string, args: string[], options: { cwd: string; timeoutMs: number }) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const fixture = await startVrdexMcpApiFixture();
  const tempDir = await mkdtemp(path.join(tmpdir(), "vrdex-claude-code-mcp-"));
  const configPath = path.join(tempDir, "mcp.json");

  try {
    const mcpConfig = {
      mcpServers: {
        vrdex: {
          args: [
            "pnpm",
            "--silent",
            "--dir",
            repoRoot.replaceAll("\\", "/"),
            "exec",
            "tsx",
            "packages/vrdex-mcp/src/stdio.ts",
          ],
          command: process.platform === "win32" ? "corepack.cmd" : "corepack",
          env: {
            VRDEX_API_BASE_URL: fixture.origin,
            VRDEX_MCP_OUTPUT_MODE: "compact",
          },
          type: "stdio",
        },
      },
    };

    await writeFile(configPath, `${JSON.stringify(mcpConfig)}\n`, "utf8");

    const args = [
      "-p",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      configPath,
      "--allowedTools",
      "mcp__vrdex__vrdex_search",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "json",
      "--debug",
      "mcp",
      "--max-budget-usd",
      options.maxBudgetUsd,
    ];

    if (options.model !== undefined) {
      args.push("--model", options.model);
    }

    args.push(
      [
        "You must call the VRDex MCP tool named mcp__vrdex__vrdex_search exactly once before answering.",
        "Call it with query \"club\", type \"event\", and limit 1.",
        "Do not describe the tool name or arguments.",
        "Return exactly the first result slug and no other text.",
      ].join(" "),
    );

    const result = await run(options.claudeCommand, args, { cwd: repoRoot, timeoutMs: 180_000 });

    assert.equal(result.code, 0, result.stderr || `${options.claudeCommand} exited with ${result.code}.`);

    const parsed = JSON.parse(result.stdout) as ClaudeJsonResult;

    assert.equal(parsed.type, "result", "Claude Code did not return a result payload.");
    assert.equal(parsed.is_error, false, "Claude Code reported an error result.");
    assert.equal(
      parsed.result?.trim(),
      "club-night",
      [
        `Expected Claude Code to return club-night, got: ${parsed.result}`,
        result.stderr.trim() ? `Claude Code stderr:\n${result.stderr.trim()}` : undefined,
      ].filter(Boolean).join("\n\n"),
    );

    const searchRequest = fixture.captured.find((request) => request.pathname.endsWith("/api/v0/search"));

    assert.ok(searchRequest, "Claude Code did not call the VRDex search API through the MCP server.");
    assert.equal(searchRequest.searchParams.get("q"), "club");
    assert.equal(searchRequest.searchParams.get("type"), "event");
    assert.equal(searchRequest.searchParams.get("limit"), "1");

    console.log(
      [
        "| Smoke target | Status | Details |",
        "| --- | --- | --- |",
        "| Claude Code local stdio MCP | pass | vrdex_search returned club-night and fixture captured /api/v0/search?q=club&type=event&limit=1 |",
      ].join("\n"),
    );
  } finally {
    await fixture.close();
    await rm(tempDir, { force: true, recursive: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
