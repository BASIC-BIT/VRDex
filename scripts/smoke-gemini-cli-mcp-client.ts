import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { startVrdexMcpApiFixture } from "../packages/vrdex-mcp/tests/api-fixture";
import {
  fetchMcpOAuthClientCredentialsToken,
  hasAnyMcpOAuthClientCredentials,
  mcpOAuthClientCredentialsFromEnv,
} from "./mcp-oauth-client-credentials";

type SmokeMode = "hosted-http" | "local-stdio";
type HostedSearchType = "all" | "community" | "event" | "person" | "profile" | "world";

type HostedSearchArgs = {
  limit: number;
  query: string;
  type: HostedSearchType;
};

type GeminiOptions = {
  geminiCommand: string;
  geminiPackage?: string;
  hostedDataPublicReads: boolean;
  hostedOAuthClientId?: string;
  hostedOAuthClientSecret?: string;
  hostedOAuthToken?: string;
  hostedSearch: HostedSearchArgs;
  hostedUrl?: string;
  mode: SmokeMode;
  model?: string;
  timeoutMs: number;
};

type RunResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

type RemoveProjectDir = (
  projectDir: string,
  options: { force: boolean; maxRetries: number; recursive: boolean; retryDelay: number },
) => Promise<void>;

type TerminationDependencies = {
  forceWaitMs?: number;
  graceMs?: number;
  platform?: NodeJS.Platform;
  sendSignal?: (pid: number, signal: NodeJS.Signals | 0) => void;
  spawnProcess?: typeof spawn;
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

function parseTimeout(value: string | undefined) {
  const normalized = nonEmpty(value) ?? "180000";
  const parsed = Number.parseInt(normalized, 10);

  assert(Number.isSafeInteger(parsed), "Timeout must be an integer.");
  assert(parsed >= 30_000, "Timeout must be at least 30000ms.");

  return parsed;
}

function defaultGeminiCommand() {
  return process.platform === "win32" ? "gemini.cmd" : "gemini";
}

function parseArgs(argv: string[]): GeminiOptions {
  const oauthClientCredentials = mcpOAuthClientCredentialsFromEnv(process.env, "GEMINI_CLI");
  const options: GeminiOptions = {
    geminiCommand: nonEmpty(process.env.VRDEX_GEMINI_CLI_COMMAND) ?? defaultGeminiCommand(),
    geminiPackage: nonEmpty(process.env.VRDEX_GEMINI_CLI_PACKAGE),
    hostedDataPublicReads: envFlag("VRDEX_GEMINI_CLI_HOSTED_DATA"),
    hostedOAuthClientId: oauthClientCredentials.clientId,
    hostedOAuthClientSecret: oauthClientCredentials.clientSecret,
    hostedOAuthToken: nonEmpty(process.env.VRDEX_GEMINI_CLI_OAUTH_TOKEN),
    hostedSearch: {
      limit: parseHostedSearchLimit(process.env.VRDEX_GEMINI_CLI_HOSTED_LIMIT),
      query: process.env.VRDEX_GEMINI_CLI_HOSTED_QUERY?.trim() ?? "",
      type: parseHostedSearchType(process.env.VRDEX_GEMINI_CLI_HOSTED_TYPE),
    },
    hostedUrl: nonEmpty(process.env.VRDEX_GEMINI_CLI_HOSTED_URL),
    mode: "local-stdio",
    model: nonEmpty(process.env.VRDEX_GEMINI_CLI_MODEL),
    timeoutMs: parseTimeout(process.env.VRDEX_GEMINI_CLI_TIMEOUT_MS),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    switch (arg) {
      case "--":
        break;
      case "--gemini-command":
        options.geminiCommand = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--gemini-package":
        options.geminiPackage = takeValue(argv, index, arg);
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
      case "--oauth-client-id":
        options.hostedOAuthClientId = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--oauth-client-secret-env": {
        const envName = takeValue(argv, index, arg);
        const secret = nonEmpty(process.env[envName]);

        assert.ok(secret, `${arg} ${envName} did not resolve to a non-empty environment variable.`);
        options.hostedOAuthClientSecret = secret;
        index += 1;
        break;
      }
      case "--timeout-ms":
        options.timeoutMs = parseTimeout(takeValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.hostedDataPublicReads && !options.hostedSearch.query) {
    options.hostedSearch.query = "club";
  }
  assert.notEqual(options.geminiCommand.trim(), "", "--gemini-command must not be empty.");
  if (options.geminiPackage !== undefined) {
    assert.notEqual(options.geminiPackage.trim(), "", "--gemini-package must not be empty.");
  }
  if (options.mode === "hosted-http") {
    assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_GEMINI_CLI_HOSTED_URL is required for hosted-http.");
    if (options.hostedDataPublicReads) {
      assert.notEqual(options.hostedSearch.query, "", "--hosted-data requires a non-empty hosted search query.");
    }
  }

  return options;
}

export function geminiSpawnForPlatform(args: {
  comSpec?: string;
  geminiCommand: string;
  geminiPackage?: string;
  platform: NodeJS.Platform;
  promptArgs: string[];
}) {
  const base = args.geminiPackage === undefined
    ? {
        args: args.promptArgs,
        command: args.geminiCommand,
      }
    : {
        args: ["--yes", args.geminiPackage, ...args.promptArgs],
        command: args.platform === "win32" ? "npx.cmd" : "npx",
      };

  if (args.platform === "win32") {
    return {
      args: ["/d", "/s", "/c", base.command, ...base.args],
      command: args.comSpec ?? "cmd.exe",
    };
  }

  return base;
}

function isMissingProcess(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      child.off("exit", finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);

    child.once("exit", finish);
  });
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
  sendSignal: (pid: number, signal: NodeJS.Signals | 0) => void,
) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      sendSignal(-pid, 0);
    } catch (error) {
      if (isMissingProcess(error)) {
        return;
      }

      throw error;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Gemini process group ${pid} did not terminate after SIGKILL.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function terminateWindowsProcessTree(child: ChildProcess, spawnProcess: typeof spawn) {
  return new Promise<void>((resolve, reject) => {
    const pid = child.pid;

    assert.ok(pid !== undefined, "Cannot terminate a Gemini process tree without a pid.");
    let killer: ChildProcess;

    try {
      killer = spawnProcess("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      child.kill("SIGBREAK");
      reject(new Error("Failed to start taskkill.exe for the Gemini process tree.", { cause: error }));
      return;
    }

    let finished = false;
    const finish = (error?: Error) => {
      if (finished) {
        return;
      }

      finished = true;
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };

    killer.once("error", (error) => {
      child.kill("SIGBREAK");
      finish(new Error("Failed to start taskkill.exe for the Gemini process tree.", { cause: error }));
    });
    killer.once("close", (code) => {
      if (code === 0) {
        finish();

        return;
      }

      child.kill("SIGBREAK");
      finish(new Error(`taskkill.exe exited with code ${code ?? "unknown"}.`));
    });
  });
}

export async function terminateGeminiProcessTree(
  child: ChildProcess,
  dependencies: TerminationDependencies = {},
) {
  const platform = dependencies.platform ?? process.platform;
  const pid = child.pid;

  if (pid === undefined) {
    child.kill();
    return;
  }

  if (platform === "win32") {
    await terminateWindowsProcessTree(child, dependencies.spawnProcess ?? spawn);
    return;
  }

  const sendSignal = dependencies.sendSignal ?? process.kill;
  const graceMs = dependencies.graceMs ?? 250;
  const forceWaitMs = dependencies.forceWaitMs ?? 1_000;

  try {
    sendSignal(-pid, "SIGTERM");
  } catch (error) {
    if (isMissingProcess(error)) {
      return;
    }

    throw error;
  }

  await waitForChildExit(child, graceMs);

  try {
    sendSignal(-pid, 0);
  } catch (error) {
    if (isMissingProcess(error)) {
      return;
    }

    throw error;
  }

  sendSignal(-pid, "SIGKILL");
  await waitForProcessGroupExit(pid, forceWaitMs, sendSignal);
}

function geminiSpawn(options: GeminiOptions, args: string[]) {
  return geminiSpawnForPlatform({
    comSpec: process.env.ComSpec,
    geminiCommand: options.geminiCommand,
    geminiPackage: options.geminiPackage,
    platform: process.platform,
    promptArgs: args,
  });
}

export function runGemini(options: GeminiOptions, args: string[], cwd: string) {
  return new Promise<RunResult>((resolve, reject) => {
    const command = geminiSpawn(options, args);
    const child = spawn(command.command, command.args, {
      cwd,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let timeoutError: Error | undefined;
    let timeoutGrace: NodeJS.Timeout | undefined;
    let settled = false;
    const clearTimers = () => {
      clearTimeout(timeout);
      if (timeoutGrace !== undefined) {
        clearTimeout(timeoutGrace);
      }
    };
    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      reject(error);
    };
    const timeout = setTimeout(() => {
      timeoutError = new Error(`${[command.command, ...command.args].join(" ")} timed out after ${options.timeoutMs}ms.`);
      timeoutGrace = setTimeout(() => {
        settleReject(timeoutError!);
      }, 5_000);
      void terminateGeminiProcessTree(child)
        .then(() => settleReject(timeoutError!))
        .catch((error: unknown) => {
          settleReject(new Error(`${timeoutError!.message} Process-tree termination failed.`, {
            cause: error,
          }));
        });
    }, options.timeoutMs);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      settleReject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      if (timeoutError !== undefined) {
        settleReject(timeoutError);
        return;
      }

      settled = true;
      clearTimers();
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

function isTransientCleanupError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EBUSY" || error.code === "ENOTEMPTY" || error.code === "EPERM")
  );
}

export async function removeGeminiProjectDir(
  projectDir: string,
  dependencies: { remove?: RemoveProjectDir; warn?: (message: string) => void } = {},
) {
  const remove = dependencies.remove ?? rm;
  const warn = dependencies.warn ?? console.error;

  try {
    await remove(projectDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 250 });
  } catch (error) {
    if (!isTransientCleanupError(error)) {
      throw error;
    }

    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
    warn(`Warning: Gemini CLI temporary project cleanup skipped after transient ${code} lock: ${projectDir}`);
  }
}

function redactSensitiveOutput(text: string, options: GeminiOptions) {
  let redacted = text.replace(/Authorization:\s*Bearer\s+[^\s"'\\]+/gi, "Authorization: Bearer [REDACTED]");

  if (options.hostedOAuthToken !== undefined) {
    redacted = redacted.replaceAll(options.hostedOAuthToken, "[REDACTED]");
  }
  if (options.hostedOAuthClientSecret !== undefined) {
    redacted = redacted.replaceAll(options.hostedOAuthClientSecret, "[REDACTED_CLIENT_SECRET]");
  }

  return redacted;
}

function settingsPath(projectDir: string) {
  return path.join(projectDir, ".gemini", "settings.json");
}

async function writeGeminiSettings(projectDir: string, config: unknown) {
  const geminiDir = path.join(projectDir, ".gemini");

  await mkdir(geminiDir, { recursive: true });
  await writeFile(settingsPath(projectDir), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function localStdioSettings(repoRoot: string, apiBaseUrl: string) {
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
        timeout: 120_000,
        trust: true,
      },
    },
  };
}

function hostedHttpSettings(hostedUrl: string, hostedOAuthToken: string | undefined) {
  const serverConfig: {
    headers?: Record<string, string>;
    httpUrl: string;
    timeout: number;
    trust: boolean;
  } = {
    httpUrl: hostedUrl,
    timeout: 120_000,
    trust: true,
  };

  if (hostedOAuthToken !== undefined) {
    serverConfig.headers = {
      Authorization: `Bearer ${hostedOAuthToken}`,
    };
  }

  return {
    mcpServers: {
      vrdex: serverConfig,
    },
  };
}

function buildGeminiPromptArgs(options: GeminiOptions, prompt: string) {
  const args = [
    "--skip-trust",
    "--approval-mode",
    "yolo",
    "--allowed-mcp-server-names",
    "vrdex",
    "--output-format",
    "stream-json",
    "--prompt",
    prompt,
  ];

  if (options.model !== undefined) {
    args.splice(0, 0, "--model", options.model);
  }

  return args;
}

function parseJsonLines(stdout: string) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function jsonText(events: unknown[]) {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

export function geminiProviderQuotaMessage(stderr: string) {
  if (!/\b(TerminalQuotaError|quota exceeded|exhausted your .*quota)\b/i.test(stderr)) {
    return undefined;
  }

  const retryLine = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Please retry in\b/i.test(line));
  const retrySuffix = retryLine === undefined ? "" : ` ${retryLine}`;

  return `Gemini CLI reached the Gemini API quota before any MCP smoke evidence could be recorded.${retrySuffix}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertGeminiOutput(result: RunResult, options: GeminiOptions, label: string) {
  const quotaMessage = geminiProviderQuotaMessage(result.stderr);

  if (result.code !== 0 && quotaMessage !== undefined) {
    throw new Error(quotaMessage);
  }

  assert.equal(
    result.code,
    0,
    redactSensitiveOutput(result.stderr, options) || `${label} exited with ${result.code}.`,
  );

  try {
    return jsonText(parseJsonLines(result.stdout));
  } catch {
    throw new Error(`${label} did not return stream-json output: ${result.stdout.slice(0, 500)}`);
  }
}

function assertHostedToolUse(output: string, search: HostedSearchArgs) {
  assert.match(output, /vrdex_search/, "Gemini CLI did not emit a vrdex_search tool call in stream-json output.");
  assert.match(output, new RegExp(escapeRegExp(search.query)), "Gemini CLI output did not include the expected query.");
  assert.match(output, new RegExp(escapeRegExp(search.type)), "Gemini CLI output did not include the expected search type.");
  assert.match(output, new RegExp(escapeRegExp(String(search.limit))), "Gemini CLI output did not include the expected limit.");
  assert.match(output, /results/, "Gemini CLI output did not include structured search results.");
  assert.match(output, /hosted-ok/, "Gemini CLI did not finish with the expected hosted-ok marker.");
}

async function hostedOAuthToken(options: GeminiOptions) {
  if (options.hostedOAuthToken !== undefined) {
    return options.hostedOAuthToken;
  }

  if (!hasAnyMcpOAuthClientCredentials(options)) {
    return undefined;
  }

  const hostedUrl = options.hostedUrl;

  assert.ok(hostedUrl, "Hosted URL is required for OAuth client-credentials token acquisition.");
  const result = await fetchMcpOAuthClientCredentialsToken({
    clientId: options.hostedOAuthClientId,
    clientSecret: options.hostedOAuthClientSecret,
    hostedUrl,
  });

  options.hostedOAuthToken = result.accessToken;

  return result.accessToken;
}

async function geminiVersion(options: GeminiOptions, cwd: string) {
  const result = await runGemini(options, ["--version"], cwd);

  assert.equal(result.code, 0, result.stderr || `Gemini CLI version check exited with ${result.code}.`);

  return result.stdout.trim().split(/\r?\n/)[0] ?? "installed";
}

async function smokeLocalStdio(projectDir: string, options: GeminiOptions, repoRoot: string) {
  const fixture = await startVrdexMcpApiFixture();

  try {
    await writeGeminiSettings(projectDir, localStdioSettings(repoRoot, fixture.origin));

    const prompt = [
      "Use the VRDex MCP server named vrdex.",
      "Call vrdex_search exactly once with query \"club\", type \"event\", and limit 1.",
      "After the tool returns, respond exactly club-night and no other text.",
    ].join(" ");
    const result = await runGemini(options, buildGeminiPromptArgs(options, prompt), projectDir);
    const output = assertGeminiOutput(result, options, "Gemini CLI local stdio MCP");

    assert.match(output, /vrdex_search/, "Gemini CLI did not emit a vrdex_search tool call in stream-json output.");
    assert.match(output, /club-night/, "Gemini CLI did not finish with the expected club-night marker.");

    const searchRequest = fixture.captured.find((request) => request.pathname.endsWith("/api/v0/search"));

    assert.ok(searchRequest, "Gemini CLI did not call the VRDex search API through the MCP server.");
    assert.equal(searchRequest.searchParams.get("q"), "club");
    assert.equal(searchRequest.searchParams.get("type"), "event");
    assert.equal(searchRequest.searchParams.get("limit"), "1");

    console.log(
      [
        "| Smoke target | Status | Details |",
        "| --- | --- | --- |",
        "| Gemini CLI local stdio MCP | pass | vrdex_search returned club-night and fixture captured /api/v0/search?q=club&type=event&limit=1 |",
      ].join("\n"),
    );
  } finally {
    await fixture.close();
  }
}

async function smokeHostedHttp(projectDir: string, options: GeminiOptions) {
  const hostedUrl = options.hostedUrl;

  assert.ok(hostedUrl, "Hosted URL is required.");
  await writeGeminiSettings(projectDir, hostedHttpSettings(hostedUrl, await hostedOAuthToken(options)));

  const hostedSearch = options.hostedSearch;
  const prompt = [
    "Use the VRDex MCP server named vrdex.",
    "Call vrdex_search exactly once before answering.",
    `Use these exact input fields: query is ${JSON.stringify(hostedSearch.query)}, type is ${JSON.stringify(hostedSearch.type)}, and limit is ${hostedSearch.limit}.`,
    "After the tool returns, respond exactly hosted-ok and no other text.",
  ].join(" ");
  const result = await runGemini(options, buildGeminiPromptArgs(options, prompt), projectDir);
  const output = assertGeminiOutput(result, options, "Gemini CLI hosted HTTP MCP");

  assertHostedToolUse(output, hostedSearch);

  const row =
    options.hostedOAuthToken === undefined
      ? `| Gemini CLI hosted anonymous HTTP MCP | pass | vrdex_search returned structured content for ${hostedUrl} with query=${JSON.stringify(hostedSearch.query)}, type=${hostedSearch.type}, limit=${hostedSearch.limit} |`
      : `| Gemini CLI hosted OAuth HTTP MCP | pass | acquired or supplied MCP-resource OAuth token completed vrdex_search for ${hostedUrl} with query=${JSON.stringify(hostedSearch.query)}, type=${hostedSearch.type}, limit=${hostedSearch.limit} without exposing the token or client secret |`;

  console.log(
    [
      "| Smoke target | Status | Details |",
      "| --- | --- | --- |",
      row,
      options.hostedOAuthToken === undefined
        ? "| Gemini CLI hosted OAuth HTTP MCP | skip | set VRDEX_MCP_OAUTH_CLIENT_ID / VRDEX_MCP_OAUTH_CLIENT_SECRET or VRDEX_GEMINI_CLI_OAUTH_TOKEN for hosted OAuth evidence |"
        : undefined,
    ].filter(Boolean).join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const projectDir = await mkdtemp(path.join(tmpdir(), "vrdex-gemini-cli-mcp-"));

  try {
    const version = await geminiVersion(options, projectDir);

    console.error(`Gemini CLI version: ${version}`);
    if (options.mode === "hosted-http") {
      await smokeHostedHttp(projectDir, options);
    } else {
      await smokeLocalStdio(projectDir, options, repoRoot);
    }
  } finally {
    await removeGeminiProjectDir(projectDir);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
