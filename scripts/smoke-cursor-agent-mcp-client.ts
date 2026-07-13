import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { startVrdexMcpApiFixture } from "../packages/vrdex-mcp/tests/api-fixture";

type SmokeMode = "hosted-http" | "local-stdio";
type HostedSearchType = "all" | "community" | "event" | "person" | "profile" | "world";

type RunResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

type CursorAgentOptions = {
  command?: string;
  hostedDataPublicReads: boolean;
  hostedSearch: {
    limit: number;
    query: string;
    type: HostedSearchType;
  };
  hostedUrl?: string;
  mode: SmokeMode;
  model?: string;
  timeoutMs: number;
};

type CommandProbe = {
  command: string;
  help: RunResult;
  mcpHelp: RunResult;
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

function parseInteger(value: string | undefined, fallback: string, label: string) {
  const parsed = Number.parseInt(nonEmpty(value) ?? fallback, 10);

  assert(Number.isSafeInteger(parsed), `${label} must be an integer.`);

  return parsed;
}

function parseArgs(argv: string[]): CursorAgentOptions {
  const options: CursorAgentOptions = {
    command: nonEmpty(process.env.VRDEX_CURSOR_AGENT_COMMAND),
    hostedDataPublicReads: envFlag("VRDEX_CURSOR_AGENT_HOSTED_DATA"),
    hostedSearch: {
      limit: parseInteger(process.env.VRDEX_CURSOR_AGENT_HOSTED_LIMIT, "1", "Hosted search limit"),
      query: process.env.VRDEX_CURSOR_AGENT_HOSTED_QUERY?.trim() ?? "",
      type: parseHostedSearchType(process.env.VRDEX_CURSOR_AGENT_HOSTED_TYPE),
    },
    hostedUrl: nonEmpty(process.env.VRDEX_CURSOR_AGENT_HOSTED_URL),
    mode: "local-stdio",
    model: nonEmpty(process.env.VRDEX_CURSOR_AGENT_MODEL),
    timeoutMs: parseInteger(process.env.VRDEX_CURSOR_AGENT_TIMEOUT_MS, "180000", "Timeout"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--":
        break;
      case "--cursor-agent-command":
        options.command = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--hosted-data":
      case "--hosted-data-public-reads":
        options.hostedDataPublicReads = true;
        break;
      case "--hosted-limit":
        options.hostedSearch.limit = parseInteger(takeValue(argv, index, arg), "1", "Hosted search limit");
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
      case "--timeout-ms":
        options.timeoutMs = parseInteger(takeValue(argv, index, arg), "180000", "Timeout");
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert(options.timeoutMs >= 30_000, "Timeout must be at least 30000ms.");
  assert(options.hostedSearch.limit >= 1 && options.hostedSearch.limit <= 50, "Hosted search limit must be between 1 and 50.");
  if (options.hostedDataPublicReads && !options.hostedSearch.query) {
    options.hostedSearch.query = "club";
  }
  if (options.mode === "hosted-http") {
    assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_CURSOR_AGENT_HOSTED_URL is required for hosted-http.");
    assert.ok(options.hostedDataPublicReads, "Cursor Agent hosted HTTP smoke requires --hosted-data.");
  }

  return options;
}

export function cursorAgentSpawnForPlatform(args: {
  command: string;
  commandArgs: string[];
  comSpec?: string;
  platform: NodeJS.Platform;
}) {
  if (args.platform !== "win32") {
    return { args: args.commandArgs, command: args.command };
  }

  return {
    args: ["/d", "/s", "/c", args.command, ...args.commandArgs],
    command: args.comSpec ?? "cmd.exe",
  };
}

export function runCursorAgent(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
) {
  const launch = cursorAgentSpawnForPlatform({
    command,
    commandArgs: args,
    comSpec: process.env.ComSpec,
    platform: process.platform,
  });

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateCursorAgentProcessTree(child);
      reject(new Error(`${command} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        return;
      }
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

function terminateCursorAgentProcessTree(child: ChildProcess) {
  if (child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export function isCursorAgentCapabilityProbe(probe: CommandProbe) {
  const help = `${probe.help.stdout}\n${probe.help.stderr}`;
  const mcpHelp = `${probe.mcpHelp.stdout}\n${probe.mcpHelp.stderr}`;

  return probe.help.code === 0
    && probe.mcpHelp.code === 0
    && /(?:^|\s)(?:-p,\s*)?--print\b/m.test(help)
    && /--output-format\b/.test(help)
    && /stream-json/i.test(help)
    && /\bmcp\b/i.test(help)
    && /list-tools/i.test(mcpHelp);
}

export function selectCursorAgentCommand(probes: CommandProbe[]) {
  return probes.find(isCursorAgentCapabilityProbe)?.command;
}

async function resolveCursorAgentCommand(options: CursorAgentOptions, cwd: string) {
  const candidates = options.command === undefined ? ["agent", "cursor-agent"] : [options.command];
  const probes: CommandProbe[] = [];

  for (const command of candidates) {
    try {
      probes.push({
        command,
        help: await runCursorAgent(command, ["--help"], cwd, 30_000),
        mcpHelp: await runCursorAgent(command, ["mcp", "--help"], cwd, 30_000),
      });
    } catch {
      continue;
    }
  }

  const command = selectCursorAgentCommand(probes);

  assert.ok(
    command,
    "Cursor Agent CLI was not found. Install the current Agent CLI and ensure agent or cursor-agent exposes --print, stream-json, and mcp list-tools.",
  );

  return command;
}

async function writeCursorMcpConfig(projectDir: string, config: unknown) {
  const cursorDir = path.join(projectDir, ".cursor");

  await mkdir(cursorDir, { recursive: true });
  await writeFile(path.join(cursorDir, "mcp.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function localStdioConfig(repoRoot: string, apiBaseUrl: string) {
  return {
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
      },
    },
  };
}

function hostedHttpConfig(hostedUrl: string) {
  return {
    mcpServers: {
      vrdex: {
        type: "http",
        url: hostedUrl,
      },
    },
  };
}

export function parseCursorAgentStream(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

export function redactCursorAgentOutput(text: string) {
  let redacted = text.replace(/Authorization:\s*Bearer\s+[^\s"'\\]+/gi, "Authorization: Bearer [REDACTED]");
  const apiKey = nonEmpty(process.env.CURSOR_API_KEY);

  if (apiKey !== undefined) {
    redacted = redacted.replaceAll(apiKey, "[REDACTED_CURSOR_API_KEY]");
  }

  return redacted;
}

function hasNonEmptyResults(value: unknown, depth = 0): boolean {
  if (depth > 12) {
    return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
      return false;
    }
    try {
      return hasNonEmptyResults(JSON.parse(trimmed), depth + 1);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasNonEmptyResults(entry, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.results) && record.results.length > 0) {
      return true;
    }
    return Object.values(record).some((entry) => hasNonEmptyResults(entry, depth + 1));
  }

  return false;
}

function hasExpectedSearchArgs(
  value: unknown,
  expected: { limit: number; query: string; type: HostedSearchType },
  depth = 0,
): boolean {
  if (depth > 12 || value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasExpectedSearchArgs(entry, expected, depth + 1));
  }

  const record = value as Record<string, unknown>;

  if (record.query === expected.query && record.type === expected.type && record.limit === expected.limit) {
    return true;
  }

  return Object.values(record).some((entry) => hasExpectedSearchArgs(entry, expected, depth + 1));
}

export function assertCursorAgentToolEvidence(
  events: unknown[],
  options: {
    expectedSearch: { limit: number; query: string; type: HostedSearchType };
    marker: string;
    requireNonEmptyResults: boolean;
  },
) {
  const records = events.filter(
    (event): event is Record<string, unknown> => event !== null && typeof event === "object" && !Array.isArray(event),
  );
  const completedToolEvents = records.filter(
    (event) => event.type === "tool_call" && event.subtype === "completed",
  );
  const searchEvent = completedToolEvents.find((event) => /vrdex_search/i.test(JSON.stringify(event)));

  assert.ok(searchEvent, "Cursor Agent did not emit a completed vrdex_search MCP tool event.");
  assert.ok(
    hasExpectedSearchArgs(searchEvent, options.expectedSearch),
    "Cursor Agent vrdex_search did not use the expected query, type, and limit.",
  );
  if (options.requireNonEmptyResults) {
    assert.ok(hasNonEmptyResults(searchEvent), "Cursor Agent vrdex_search returned no public results.");
  }

  const terminal = records.find(
    (event) => event.type === "result" && event.subtype === "success" && event.is_error !== true,
  );

  assert.ok(terminal, "Cursor Agent did not emit a terminal success event.");
  assert.match(JSON.stringify(terminal), new RegExp(options.marker, "i"), `Cursor Agent did not finish with ${options.marker}.`);
}

async function assertCursorMcpTools(command: string, projectDir: string, timeoutMs: number) {
  const result = await runCursorAgent(command, ["mcp", "list-tools", "vrdex"], projectDir, timeoutMs);

  assert.equal(
    result.code,
    0,
    redactCursorAgentOutput(result.stderr) || `Cursor Agent mcp list-tools exited with ${result.code}.`,
  );
  assert.match(`${result.stdout}\n${result.stderr}`, /vrdex_search/i, "Cursor Agent did not list vrdex_search.");
}

function promptArgs(options: CursorAgentOptions, prompt: string) {
  const args = ["--print", "--output-format", "stream-json", prompt];

  if (options.model !== undefined) {
    args.splice(0, 0, "--model", options.model);
  }

  return args;
}

async function runPrompt(
  command: string,
  projectDir: string,
  options: CursorAgentOptions,
  prompt: string,
  label: string,
) {
  const result = await runCursorAgent(command, promptArgs(options, prompt), projectDir, options.timeoutMs);

  assert.equal(result.code, 0, redactCursorAgentOutput(result.stderr) || `${label} exited with ${result.code}.`);
  try {
    return parseCursorAgentStream(result.stdout);
  } catch {
    throw new Error(`${label} did not return stream-json output: ${result.stdout.slice(0, 500)}`);
  }
}

async function smokeLocalStdio(
  command: string,
  projectDir: string,
  options: CursorAgentOptions,
  repoRoot: string,
) {
  const fixture = await startVrdexMcpApiFixture();

  try {
    await writeCursorMcpConfig(projectDir, localStdioConfig(repoRoot, fixture.origin));
    await assertCursorMcpTools(command, projectDir, options.timeoutMs);
    const events = await runPrompt(
      command,
      projectDir,
      options,
      [
        "Use only the VRDex MCP server named vrdex.",
        "Call vrdex_search exactly once with query club, type event, and limit 1.",
        "Do not use shell or file tools and do not edit any files.",
        "After the tool returns, respond exactly club-night and no other text.",
      ].join(" "),
      "Cursor Agent local stdio MCP",
    );

    assertCursorAgentToolEvidence(events, {
      expectedSearch: { limit: 1, query: "club", type: "event" },
      marker: "club-night",
      requireNonEmptyResults: true,
    });
    const searchRequest = fixture.captured.find((request) => request.pathname.endsWith("/api/v0/search"));

    assert.ok(searchRequest, "Cursor Agent did not call the VRDex search API through the MCP server.");
    assert.equal(searchRequest.searchParams.get("q"), "club");
    assert.equal(searchRequest.searchParams.get("type"), "event");
    assert.equal(searchRequest.searchParams.get("limit"), "1");
    console.log("| Cursor Agent local stdio MCP | pass | completed vrdex_search and fixture captured the expected API request |");
  } finally {
    await fixture.close();
  }
}

async function smokeHostedHttp(
  command: string,
  projectDir: string,
  options: CursorAgentOptions,
) {
  const hostedUrl = options.hostedUrl;

  assert.ok(hostedUrl, "Hosted URL is required.");
  await writeCursorMcpConfig(projectDir, hostedHttpConfig(hostedUrl));
  await assertCursorMcpTools(command, projectDir, options.timeoutMs);
  const search = options.hostedSearch;
  const events = await runPrompt(
    command,
    projectDir,
    options,
    [
      "Use only the VRDex MCP server named vrdex.",
      `Call vrdex_search exactly once with query ${JSON.stringify(search.query)}, type ${JSON.stringify(search.type)}, and limit ${search.limit}.`,
      "Do not use shell or file tools and do not edit any files.",
      "After the tool returns, respond exactly hosted-ok and no other text.",
    ].join(" "),
    "Cursor Agent hosted anonymous HTTP MCP",
  );

  assertCursorAgentToolEvidence(events, {
    expectedSearch: search,
    marker: "hosted-ok",
    requireNonEmptyResults: true,
  });
  console.log(`| Cursor Agent hosted anonymous HTTP MCP | pass | completed data-backed vrdex_search against ${hostedUrl} |`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const projectDir = await mkdtemp(path.join(tmpdir(), "vrdex-cursor-agent-mcp-"));

  try {
    const command = await resolveCursorAgentCommand(options, projectDir);
    const version = await runCursorAgent(command, ["--version"], projectDir, 30_000);

    assert.equal(
      version.code,
      0,
      redactCursorAgentOutput(version.stderr) || `Cursor Agent version check exited with ${version.code}.`,
    );
    console.error(`Cursor Agent version: ${version.stdout.trim().split(/\r?\n/)[0] ?? "installed"}`);
    if (options.mode === "hosted-http") {
      await smokeHostedHttp(command, projectDir, options);
    } else {
      await smokeLocalStdio(command, projectDir, options, repoRoot);
    }
  } finally {
    await rm(projectDir, { force: true, recursive: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
