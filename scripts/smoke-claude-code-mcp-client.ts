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

type ClaudeStreamEvent = {
  message?: {
    content?: Array<{
      content?: unknown;
      id?: string;
      input?: unknown;
      is_error?: boolean;
      name?: string;
      text?: string;
      tool_use_id?: string;
      type?: string;
    }>;
  };
  result?: string;
  tool_use_result?: unknown;
  type?: string;
};

type SmokeMode = "hosted-http" | "local-stdio";
type HostedSearchType = "all" | "community" | "event" | "person" | "profile" | "world";

type HostedSearchArgs = {
  limit: number;
  query: string;
  type: HostedSearchType;
};

type SmokeOptions = {
  claudeCommand: string;
  hostedDataPublicReads: boolean;
  hostedOAuthToken?: string;
  hostedSearch: HostedSearchArgs;
  hostedUrl?: string;
  maxBudgetUsd: string;
  mode: SmokeMode;
  model?: string;
};

const hostedSearchTypes = new Set<HostedSearchType>(["all", "community", "event", "person", "profile", "world"]);

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value.`);

  return value;
}

function parseHostedSearchType(value: string | undefined): HostedSearchType {
  const normalized = nonEmpty(value) ?? "all";

  assert(
    hostedSearchTypes.has(normalized as HostedSearchType),
    `Hosted search type must be one of ${[...hostedSearchTypes].join(", ")}.`,
  );

  return normalized as HostedSearchType;
}

function parseHostedSearchLimit(value: string | undefined) {
  const normalized = nonEmpty(value) ?? "1";
  const parsed = Number.parseInt(normalized, 10);

  assert(Number.isSafeInteger(parsed), "Hosted search limit must be an integer.");
  assert(parsed >= 1 && parsed <= 50, "Hosted search limit must be between 1 and 50.");

  return parsed;
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
    hostedDataPublicReads: envFlag("VRDEX_CLAUDE_CODE_HOSTED_DATA"),
    hostedOAuthToken: nonEmpty(process.env.VRDEX_CLAUDE_CODE_OAUTH_TOKEN),
    hostedSearch: {
      limit: parseHostedSearchLimit(process.env.VRDEX_CLAUDE_CODE_HOSTED_LIMIT),
      query: process.env.VRDEX_CLAUDE_CODE_HOSTED_QUERY?.trim() ?? "",
      type: parseHostedSearchType(process.env.VRDEX_CLAUDE_CODE_HOSTED_TYPE),
    },
    hostedUrl: nonEmpty(process.env.VRDEX_CLAUDE_CODE_HOSTED_URL),
    maxBudgetUsd: nonEmpty(process.env.VRDEX_CLAUDE_CODE_MAX_BUDGET_USD) ?? "0.25",
    mode: "local-stdio",
    model: nonEmpty(process.env.VRDEX_CLAUDE_CODE_MODEL),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--":
        break;
      case "--claude-command":
        options.claudeCommand = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--hosted-data":
      case "--hosted-data-public-reads":
        options.hostedDataPublicReads = true;
        break;
      case "--hosted-limit":
        options.hostedSearch.limit = parseHostedSearchLimit(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--hosted-query":
        options.hostedSearch.query = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--hosted-type":
        options.hostedSearch.type = parseHostedSearchType(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--max-budget-usd":
        options.maxBudgetUsd = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--mode":
        assert(next === "hosted-http" || next === "local-stdio", "--mode must be hosted-http or local-stdio.");
        options.mode = next;
        index += 1;
        break;
      case "--model":
        options.model = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--oauth-token":
        options.hostedOAuthToken = nonEmpty(takeValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.hostedDataPublicReads && !options.hostedSearch.query) {
    options.hostedSearch.query = "club";
  }
  assert.notEqual(options.claudeCommand.trim(), "", "--claude-command must not be empty.");
  assert.notEqual(options.maxBudgetUsd.trim(), "", "--max-budget-usd must not be empty.");
  if (options.mode === "hosted-http") {
    assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_CLAUDE_CODE_HOSTED_URL is required for hosted-http.");
    if (options.hostedDataPublicReads) {
      assert.notEqual(options.hostedSearch.query, "", "--hosted-data requires a non-empty hosted search query.");
    }
  }

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

function redactSensitiveOutput(text: string, options: SmokeOptions) {
  let redacted = text.replace(/Authorization:\s*Bearer\s+[^\s"'\\]+/gi, "Authorization: Bearer [REDACTED]");

  if (options.hostedOAuthToken !== undefined) {
    redacted = redacted.replaceAll(options.hostedOAuthToken, "[REDACTED]");
  }

  return redacted;
}

function buildBaseClaudeArgs(configPath: string, options: SmokeOptions, outputFormat: "json" | "stream-json") {
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
    outputFormat,
    "--max-budget-usd",
    options.maxBudgetUsd,
  ];

  if (options.hostedOAuthToken === undefined) {
    args.push("--debug", "mcp");
  }

  if (options.model !== undefined) {
    args.push("--model", options.model);
  }

  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }

  return args;
}

async function writeLocalStdioConfig(configPath: string, repoRoot: string, apiBaseUrl: string) {
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
          VRDEX_API_BASE_URL: apiBaseUrl,
          VRDEX_MCP_OUTPUT_MODE: "compact",
        },
        type: "stdio",
      },
    },
  };

  await writeFile(configPath, `${JSON.stringify(mcpConfig)}\n`, "utf8");
}

async function writeHostedHttpConfig(configPath: string, hostedUrl: string, hostedOAuthToken: string | undefined) {
  const serverConfig: {
    headers?: Record<string, string>;
    type: "http";
    url: string;
  } = {
    type: "http",
    url: hostedUrl,
  };

  if (hostedOAuthToken !== undefined) {
    serverConfig.headers = {
      Authorization: `Bearer ${hostedOAuthToken}`,
    };
  }

  const mcpConfig = {
    mcpServers: {
      vrdex: serverConfig,
    },
  };

  await writeFile(configPath, `${JSON.stringify(mcpConfig)}\n`, "utf8");
}

async function smokeLocalStdio(configPath: string, options: SmokeOptions, repoRoot: string) {
  const fixture = await startVrdexMcpApiFixture();

  try {
    await writeLocalStdioConfig(configPath, repoRoot, fixture.origin);

    const args = buildBaseClaudeArgs(configPath, options, "json");
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
  }
}

function parseStreamEvents(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ClaudeStreamEvent);
}

function textFromToolResult(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (entry !== null && typeof entry === "object" && "text" in entry && typeof entry.text === "string") {
          return entry.text;
        }

        return JSON.stringify(entry);
      })
      .join("\n");
  }

  return content === undefined ? "" : JSON.stringify(content);
}

function parseToolResultText(text: string | undefined) {
  assert.ok(text !== undefined, "Hosted vrdex_search did not return text content.");

  try {
    return JSON.parse(text) as {
      query?: unknown;
      results?: unknown;
      type?: unknown;
    };
  } catch {
    throw new Error(`Hosted vrdex_search did not return JSON text content: ${text.slice(0, 300)}`);
  }
}

function assertHostedToolUse(events: ClaudeStreamEvent[], expectedSearch: HostedSearchArgs) {
  let toolUseId: string | undefined;
  let toolResultText: string | undefined;
  let toolResultError: boolean | undefined;

  for (const event of events) {
    for (const content of event.message?.content ?? []) {
      if (content.type === "tool_use" && content.name === "mcp__vrdex__vrdex_search") {
        assert.equal(toolUseId, undefined, "Claude Code called vrdex_search more than once.");
        toolUseId = content.id;

        const input = content.input as { limit?: unknown; query?: unknown; type?: unknown };

        assert.equal(input.query, expectedSearch.query);
        assert.equal(input.type, expectedSearch.type);
        assert.equal(input.limit, expectedSearch.limit);
      }

      if (content.type === "tool_result" && content.tool_use_id === toolUseId) {
        toolResultError = content.is_error;
        toolResultText = textFromToolResult(content.content);
      }
    }
  }

  assert.ok(toolUseId, "Claude Code did not call mcp__vrdex__vrdex_search.");
  assert.notEqual(toolResultError, true, `Hosted vrdex_search failed: ${toolResultText}`);
  const parsed = parseToolResultText(toolResultText);

  assert.equal(parsed.query, expectedSearch.query);
  assert.equal(parsed.type, expectedSearch.type);
  assert.equal(Array.isArray(parsed.results), true);

  const finalResult = events.findLast((event) => event.type === "result")?.result?.trim();

  assert.equal(finalResult, "hosted-ok", `Expected Claude Code to return hosted-ok, got: ${finalResult}`);
}

async function smokeHostedHttp(configPath: string, options: SmokeOptions, repoRoot: string) {
  const hostedUrl = options.hostedUrl;

  assert.ok(hostedUrl, "Hosted URL is required.");
  await writeHostedHttpConfig(configPath, hostedUrl, options.hostedOAuthToken);
  const hostedSearch = options.hostedSearch;

  const args = buildBaseClaudeArgs(configPath, options, "stream-json");
  args.push(
    [
      "You must call the VRDex MCP tool named mcp__vrdex__vrdex_search exactly once before answering.",
      `Use these exact input fields: query is ${JSON.stringify(hostedSearch.query)}, type is ${JSON.stringify(hostedSearch.type)}, and limit is ${hostedSearch.limit}.`,
      "After the tool returns, respond exactly hosted-ok and no other text.",
    ].join(" "),
  );

  const result = await run(options.claudeCommand, args, { cwd: repoRoot, timeoutMs: 180_000 });

  assert.equal(
    result.code,
    0,
    redactSensitiveOutput(result.stderr, options) || `${options.claudeCommand} exited with ${result.code}.`,
  );
  assertHostedToolUse(parseStreamEvents(result.stdout), hostedSearch);

  const row =
    options.hostedOAuthToken === undefined
      ? `| Claude Code hosted anonymous HTTP MCP | pass | vrdex_search returned structured content for ${hostedUrl} with query=${JSON.stringify(hostedSearch.query)}, type=${hostedSearch.type}, limit=${hostedSearch.limit} |`
      : `| Claude Code hosted OAuth HTTP MCP | pass | supplied MCP-resource OAuth token completed vrdex_search for ${hostedUrl} with query=${JSON.stringify(hostedSearch.query)}, type=${hostedSearch.type}, limit=${hostedSearch.limit} without exposing the token value |`;

  console.log(
    [
      "| Smoke target | Status | Details |",
      "| --- | --- | --- |",
      row,
      options.hostedOAuthToken === undefined
        ? "| Claude Code hosted OAuth HTTP MCP | skip | set VRDEX_CLAUDE_CODE_OAUTH_TOKEN to an MCP-resource token with mcp:read |"
        : undefined,
    ].filter(Boolean).join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const tempDir = await mkdtemp(path.join(tmpdir(), "vrdex-claude-code-mcp-"));
  const configPath = path.join(tempDir, "mcp.json");

  try {
    if (options.mode === "hosted-http") {
      await smokeHostedHttp(configPath, options, repoRoot);
    } else {
      await smokeLocalStdio(configPath, options, repoRoot);
    }
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
