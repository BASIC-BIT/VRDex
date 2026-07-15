import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ClientId = "cursor" | "vscode" | "windsurf";
type ConfigId = "hosted-anonymous-read" | "hosted-token-fallback" | "local-stdio";

type Client = {
  cli: string;
  envPrefix: string;
  id: ClientId;
  name: string;
};

type CommandSpec = {
  argsPrefix: string[];
  command: string;
  env?: Record<string, string>;
};

type Options = {
  clients?: Set<ClientId>;
  configs?: Set<ConfigId>;
  hostedUrl?: string;
  outputDir: string;
  repoRoot: string;
  requireInstalled: boolean;
};

type PreflightResult = {
  client: string;
  config: ConfigId;
  details: string;
  status: "fail" | "pass" | "skip";
};

const clients: Client[] = [
  {
    cli: process.platform === "win32" ? "code.cmd" : "code",
    envPrefix: "VSCODE",
    id: "vscode",
    name: "VS Code",
  },
  {
    cli: process.platform === "win32" ? "cursor.cmd" : "cursor",
    envPrefix: "CURSOR",
    id: "cursor",
    name: "Cursor",
  },
  {
    cli: process.platform === "win32" ? "windsurf.cmd" : "windsurf",
    envPrefix: "WINDSURF",
    id: "windsurf",
    name: "Windsurf",
  },
];

const configIds: ConfigId[] = ["local-stdio", "hosted-anonymous-read", "hosted-token-fallback"];

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value.`);

  return value;
}

function parseCsvSet<T extends string>(value: string, allowed: readonly T[], label: string) {
  const parsed = new Set<T>();

  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();

    assert.notEqual(entry, "", `${label} must not contain empty entries.`);
    assert.ok((allowed as readonly string[]).includes(entry), `Unknown ${label}: ${entry}`);
    parsed.add(entry as T);
  }

  return parsed;
}

function addCsvSet<T extends string>(
  existing: Set<T> | undefined,
  value: string,
  allowed: readonly T[],
  label: string,
) {
  const next = existing ?? new Set<T>();

  for (const entry of parseCsvSet(value, allowed, label)) {
    next.add(entry);
  }

  return next;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    hostedUrl: nonEmpty(process.env.VRDEX_MCP_SMOKE_URL),
    outputDir:
      process.env.VRDEX_MCP_ADD_MCP_PREFLIGHT_DIR?.trim()
      || path.join(".tmp-gh-artifacts", "mcp-client-add-mcp-preflight", `run-${Date.now()}`),
    repoRoot: process.cwd(),
    requireInstalled: envFlag("VRDEX_MCP_ADD_MCP_REQUIRE_INSTALLED"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--client":
        options.clients = addCsvSet(
          options.clients,
          takeValue(argv, index, arg),
          clients.map((client) => client.id),
          "client",
        );
        index += 1;
        break;
      case "--config":
        options.configs = addCsvSet(options.configs, takeValue(argv, index, arg), configIds, "config");
        index += 1;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--repo-root":
        options.repoRoot = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--require-installed":
        options.requireInstalled = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_MCP_SMOKE_URL is required.");
  assert.notEqual(options.outputDir.trim(), "", "--output-dir must not be empty.");
  assert.notEqual(options.repoRoot.trim(), "", "--repo-root must not be empty.");

  return options;
}

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function hostedMcpUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  const pathname = trimTrailingSlashes(url.pathname);

  url.pathname = pathname.endsWith("/mcp") ? pathname : `${pathname}/mcp`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function hostedOrigin(rawUrl: string) {
  const url = new URL(hostedMcpUrl(rawUrl));

  url.pathname = trimTrailingSlashes(url.pathname).replace(/\/mcp$/, "") || "/";

  return url.toString().replace(/\/$/, "");
}

function trimTrailingSlashes(value: string) {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

function localStdioDefinition(options: Options) {
  return {
    args: [
      "pnpm",
      "--silent",
      "--dir",
      path.resolve(options.repoRoot).replaceAll("\\", "/"),
      "exec",
      "tsx",
      "packages/vrdex-mcp/src/stdio.ts",
    ],
    command: process.platform === "win32" ? "corepack.cmd" : "corepack",
    env: {
      VRDEX_API_BASE_URL: hostedOrigin(options.hostedUrl!),
      VRDEX_MCP_OUTPUT_MODE: "compact",
    },
    name: "vrdex",
  };
}

function hostedDefinition(options: Options, tokenPlaceholder = false) {
  return {
    ...(tokenPlaceholder
      ? {
          headers: {
            Authorization: "Bearer <mcp-resource-token>",
          },
        }
      : {}),
    name: "vrdex",
    type: "http",
    url: hostedMcpUrl(options.hostedUrl!),
  };
}

function psSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function addMcpDefinition(options: Options, configId: ConfigId) {
  switch (configId) {
    case "hosted-anonymous-read":
      return hostedDefinition(options);
    case "hosted-token-fallback":
      return hostedDefinition(options, true);
    case "local-stdio":
      return localStdioDefinition(options);
    default:
      assert.fail(`Unhandled add-MCP config: ${configId satisfies never}`);
  }
}

function commandSpec(client: Client): CommandSpec {
  const envValue = nonEmpty(process.env[`VRDEX_MCP_ADD_MCP_${client.envPrefix}_COMMAND`]);

  if (envValue === undefined) {
    const resolved = resolveWindowsCodeFamilyShim(client.cli);

    if (resolved !== undefined) {
      return resolved;
    }

    return {
      argsPrefix: [],
      command: client.cli,
    };
  }

  const parsed = JSON.parse(envValue) as unknown;

  assert.ok(Array.isArray(parsed), `${client.envPrefix} command override must be a JSON string array.`);
  assert.ok(parsed.length > 0, `${client.envPrefix} command override must include a command.`);
  assert.equal(
    parsed.every((entry) => typeof entry === "string" && entry.trim() !== ""),
    true,
    `${client.envPrefix} command override entries must be non-empty strings.`,
  );

  return {
    argsPrefix: parsed.slice(1) as string[],
    command: parsed[0] as string,
  };
}

function resolveWindowsCodeFamilyShim(command: string): CommandSpec | undefined {
  if (process.platform !== "win32" || !command.toLowerCase().endsWith(".cmd")) {
    return undefined;
  }

  const located = spawnSync("where.exe", [command], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  const cmdPath = located.stdout
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!cmdPath) {
    return undefined;
  }

  const cmdBody = readFileSync(cmdPath, "utf8");
  const match = /"([^"]+\.exe)"\s+"([^"]+cli\.js)"/i.exec(cmdBody);

  if (match === null) {
    return undefined;
  }

  const cmdDir = `${path.dirname(cmdPath)}${path.sep}`;
  const expand = (value: string) =>
    path.resolve(value.replaceAll(/%~dp0/gi, cmdDir));

  return {
    argsPrefix: [expand(match[2])],
    command: expand(match[1]),
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_DEV: "",
    },
  };
}

function redactSensitiveOutput(text: string) {
  return text
    .replace(/(Authorization\\?":\\?"Bearer\s+)[^"'\\\s}]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*Bearer\s+)[^\s"'\\]+/gi, "$1[REDACTED]");
}

function summarizeOutput(stdout: string, stderr: string) {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => redactSensitiveOutput(line))
    .slice(0, 6)
    .join("; ");
}

function isMissingCommandOutput(value: string) {
  return /(?:not recognized|is not recognized|not found|The term '.+' is not recognized)/i.test(value);
}

function addMcpInvocation(spec: CommandSpec, config: unknown, userDataDir: string, repoRoot: string) {
  const addMcpJson = JSON.stringify(config);

  if (process.platform === "win32" && spec.command.toLowerCase().endsWith(".cmd")) {
    const escapedJson = addMcpJson.replaceAll('"', '\\"');
    const script = [
      "&",
      psSingleQuote(spec.command),
      "--user-data-dir",
      psSingleQuote(userDataDir),
      "--add-mcp",
      psSingleQuote(escapedJson),
      psSingleQuote(repoRoot),
    ].join(" ");

    return {
      args: ["-NoProfile", "-Command", script],
      command: "powershell.exe",
    };
  }

  return {
    args: [
      ...spec.argsPrefix,
      "--user-data-dir",
      userDataDir,
      "--add-mcp",
      addMcpJson,
      repoRoot,
    ],
    command: spec.command,
  };
}

async function runAddMcp(client: Client, configId: ConfigId, options: Options): Promise<PreflightResult> {
  const outputDir = path.resolve(options.outputDir);
  const config = addMcpDefinition(options, configId);
  const configDir = path.join(outputDir, "configs");
  const userDataDir = path.join(outputDir, "user-data", client.id, configId);
  const configPath = path.join(configDir, `${client.id}-${configId}.add-mcp.json`);

  await mkdir(configDir, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");

  const spec = commandSpec(client);
  const invocation = addMcpInvocation(spec, config, userDataDir, path.resolve(options.repoRoot));
  const childEnv = { ...process.env };

  delete childEnv.VRDEX_MCP_ADD_MCP_BEARER_TOKEN;

  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    env: {
      ...childEnv,
      ...spec.env,
    },
    shell: false,
    windowsHide: true,
  });
  const combinedOutput = summarizeOutput(result.stdout ?? "", result.stderr ?? "");

  if (result.error !== undefined && "code" in result.error && result.error.code === "ENOENT") {
    return {
      client: client.name,
      config: configId,
      details: options.requireInstalled
        ? `${client.cli} is not installed or not on PATH`
        : `${client.cli} not found; skipped optional local preflight`,
      status: options.requireInstalled ? "fail" : "skip",
    };
  }

  if (result.error !== undefined) {
    return {
      client: client.name,
      config: configId,
      details: result.error.message,
      status: "fail",
    };
  }

  if (result.status !== 0) {
    if (process.platform === "win32" && spec.command.toLowerCase().endsWith(".cmd") && isMissingCommandOutput(combinedOutput)) {
      return {
        client: client.name,
        config: configId,
        details: options.requireInstalled
          ? `${client.cli} is not installed or not on PATH`
          : `${client.cli} not found; skipped optional local preflight`,
        status: options.requireInstalled ? "fail" : "skip",
      };
    }

    return {
      client: client.name,
      config: configId,
      details: combinedOutput || `${client.cli} exited with ${result.status}`,
      status: "fail",
    };
  }

  return {
    client: client.name,
    config: configId,
    details: combinedOutput || `accepted ${configPath}`,
    status: "pass",
  };
}

function markdownCell(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .trim();
}

function printResults(results: PreflightResult[], options: Options) {
  console.log("# VS Code-Family MCP Add Preflight");
  console.log("");
  console.log(`Output directory: ${path.resolve(options.outputDir)}`);
  console.log("");
  console.log("| Client | Config | Status | Details |");
  console.log("| --- | --- | --- | --- |");

  for (const result of results) {
    console.log(
      `| ${[
        markdownCell(result.client),
        markdownCell(result.config),
        result.status,
        markdownCell(result.details),
      ].join(" | ")} |`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedClientIds = options.clients ?? new Set(clients.map((client) => client.id));
  const selectedConfigIds = options.configs ?? new Set(configIds);
  const selectedClients = clients.filter((client) => selectedClientIds.has(client.id));
  const selectedConfigs = configIds.filter((config) => selectedConfigIds.has(config));
  const results: PreflightResult[] = [];

  for (const client of selectedClients) {
    for (const config of selectedConfigs) {
      results.push(await runAddMcp(client, config, options));
    }
  }

  printResults(results, options);

  const failures = results.filter((result) => result.status === "fail");

  if (failures.length > 0) {
    throw new Error(
      `MCP add preflight failed: ${failures.map((result) => `${result.client}/${result.config}`).join(", ")}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
