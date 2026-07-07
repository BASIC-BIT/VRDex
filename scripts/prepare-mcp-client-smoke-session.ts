import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Client = {
  cli: string;
  id: "cursor" | "vscode" | "windsurf";
  matrixClient: "cursor" | "devin-windsurf" | "vscode";
  name: string;
};

type Options = {
  hostedUrl?: string;
  outputDir: string;
  repoRoot: string;
  targetEnvironment: string;
};

const clients: Client[] = [
  {
    cli: "code",
    id: "vscode",
    matrixClient: "vscode",
    name: "VS Code",
  },
  {
    cli: "cursor",
    id: "cursor",
    matrixClient: "cursor",
    name: "Cursor",
  },
  {
    cli: "windsurf",
    id: "windsurf",
    matrixClient: "devin-windsurf",
    name: "Windsurf",
  },
];

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value.`);

  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    hostedUrl: nonEmpty(process.env.VRDEX_MCP_SMOKE_URL),
    outputDir: process.env.VRDEX_MCP_CLIENT_SESSION_DIR?.trim() || ".tmp-gh-artifacts/mcp-client-smoke-session",
    repoRoot: process.cwd(),
    targetEnvironment: process.env.VRDEX_MCP_TARGET_ENVIRONMENT?.trim() || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
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
      case "--target-environment":
        options.targetEnvironment = takeValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_MCP_SMOKE_URL is required.");
  if (!nonEmpty(options.targetEnvironment)) {
    options.targetEnvironment = `staging ${hostedMcpUrl(options.hostedUrl!)}`;
  }
  assert.notEqual(options.outputDir.trim(), "", "--output-dir must not be empty.");
  assert.notEqual(options.repoRoot.trim(), "", "--repo-root must not be empty.");
  assert.notEqual(options.targetEnvironment.trim(), "", "--target-environment must not be empty.");

  return options;
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
      options.repoRoot.replaceAll("\\", "/"),
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

function installCommand(client: Client, outputDir: string, configFile: string, repoRoot: string) {
  const userDataDir = path.join(outputDir, "user-data", client.id);

  return [
    client.cli,
    "--user-data-dir",
    psSingleQuote(userDataDir),
    "--profile",
    "vrdex-mcp-smoke",
    "--add-mcp",
    `(Get-Content -Raw ${psSingleQuote(configFile)})`,
    psSingleQuote(repoRoot),
  ].join(" ");
}

function recorderCommand(args: {
  check: "hosted-anonymous-read" | "hosted-oauth" | "local-stdio";
  client: Client;
  environment: string;
  hosted: boolean;
  targetEnvironment: string;
}) {
  return [
    "pnpm record:mcp-client-smoke --",
    `--client ${args.client.matrixClient}`,
    `--check ${args.check}`,
    "--status pass",
    `--environment ${JSON.stringify(args.environment)}`,
    '--evidence "<sanitized screenshot or transcript showing tools/list and vrdex_search>"',
    args.hosted ? `--target-environment ${JSON.stringify(args.targetEnvironment)}` : undefined,
  ].filter(Boolean).join(" ");
}

function smokePrompt(mode: "hosted-anonymous-read" | "hosted-oauth" | "local-stdio") {
  const authPhrase =
    mode === "hosted-oauth"
      ? "If the client prompts for OAuth, complete the login before calling the tool."
      : "Do not add an Authorization header or token for this row.";

  return [
    "Use the VRDex MCP server named vrdex.",
    "List the available VRDex tools.",
    "Call vrdex_search exactly once with query \"club\", type \"all\", and limit 1.",
    authPhrase,
    "Record whether the client displayed the tool call, whether the call succeeded, and the first returned result slug.",
  ].join(" ");
}

async function writeJson(pathname: string, value: unknown) {
  await writeFile(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeSessionPack(options: Options) {
  const outputDir = path.resolve(options.outputDir);
  const repoRoot = path.resolve(options.repoRoot);
  const configsDir = path.join(outputDir, "configs");

  await mkdir(configsDir, { recursive: true });

  const rows: string[] = [];
  const readmeSections: string[] = [
    "# MCP Client Smoke Session Pack",
    "",
    "Generated disposable setup files for installed VS Code-family MCP clients.",
    "These files are operator aids, not matrix evidence. Record a row only after the real client lists tools and calls `vrdex_search`.",
    "",
    `Hosted MCP URL: \`${hostedMcpUrl(options.hostedUrl!)}\``,
    `Local stdio API base URL: \`${hostedOrigin(options.hostedUrl!)}\``,
    "",
    "## Shared Smoke Prompt",
    "",
    "Use this prompt after installing each config:",
    "",
    "```txt",
    smokePrompt("hosted-anonymous-read"),
    "```",
    "",
    "For hosted OAuth rows, allow the client to complete OAuth when prompted, or use the token-header fallback config only as documented fallback evidence.",
    "",
  ];

  for (const client of clients) {
    const localConfig = path.join(configsDir, `${client.id}-local-stdio.add-mcp.json`);
    const hostedConfig = path.join(configsDir, `${client.id}-hosted-http.add-mcp.json`);
    const hostedTokenConfig = path.join(configsDir, `${client.id}-hosted-token.add-mcp.json`);

    await writeJson(localConfig, localStdioDefinition({ ...options, repoRoot }));
    await writeJson(hostedConfig, hostedDefinition(options));
    await writeJson(hostedTokenConfig, hostedDefinition(options, true));

    const localEnvironment = `Windows / ${client.name} / profile vrdex-mcp-smoke / local stdio`;
    const hostedEnvironment = `Windows / ${client.name} / profile vrdex-mcp-smoke / ${hostedMcpUrl(options.hostedUrl!)}`;
    const commands = {
      hostedAnonymous: installCommand(client, outputDir, hostedConfig, repoRoot),
      hostedOauthFallback: installCommand(client, outputDir, hostedTokenConfig, repoRoot),
      local: installCommand(client, outputDir, localConfig, repoRoot),
    };

    rows.push(
      `| ${client.name} | ${client.matrixClient} | \`${localConfig}\` | \`${hostedConfig}\` | \`${hostedTokenConfig}\` |`,
    );

    readmeSections.push(
      `## ${client.name}`,
      "",
      "### Local Stdio Row",
      "",
      "```powershell",
      commands.local,
      "```",
      "",
      "Prompt:",
      "",
      "```txt",
      smokePrompt("local-stdio"),
      "```",
      "",
      "Recorder:",
      "",
      "```powershell",
      recorderCommand({
        check: "local-stdio",
        client,
        environment: localEnvironment,
        hosted: false,
        targetEnvironment: options.targetEnvironment,
      }),
      "```",
      "",
      "### Hosted Anonymous-Read Row",
      "",
      "```powershell",
      commands.hostedAnonymous,
      "```",
      "",
      "Prompt:",
      "",
      "```txt",
      smokePrompt("hosted-anonymous-read"),
      "```",
      "",
      "Recorder:",
      "",
      "```powershell",
      recorderCommand({
        check: "hosted-anonymous-read",
        client,
        environment: hostedEnvironment,
        hosted: true,
        targetEnvironment: options.targetEnvironment,
      }),
      "```",
      "",
      "### Hosted OAuth Row",
      "",
      "Prefer the client's native OAuth flow first. Use the token-header config only if the current client release cannot complete hosted OAuth but can prove authenticated MCP access with a short-lived MCP-resource token.",
      "",
      "Token-header fallback install:",
      "",
      "```powershell",
      commands.hostedOauthFallback,
      "```",
      "",
      "Prompt:",
      "",
      "```txt",
      smokePrompt("hosted-oauth"),
      "```",
      "",
      "Recorder:",
      "",
      "```powershell",
      recorderCommand({
        check: "hosted-oauth",
        client,
        environment: `${hostedEnvironment} / hosted OAuth`,
        hosted: true,
        targetEnvironment: options.targetEnvironment,
      }),
      "```",
      "",
    );
  }

  const readme = [
    ...readmeSections,
    "## Generated Config Files",
    "",
    "| Client | Matrix client id | Local stdio | Hosted HTTP | Hosted token fallback |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

  const readmePath = path.join(outputDir, "README.md");

  await writeFile(readmePath, readme, "utf8");

  console.log("| Artifact | Path |");
  console.log("| --- | --- |");
  console.log(`| MCP client smoke session pack | ${readmePath} |`);
  console.log(`| Config directory | ${configsDir} |`);
  console.log(`| Hosted MCP URL | ${hostedMcpUrl(options.hostedUrl!)} |`);
}

async function main() {
  await writeSessionPack(parseArgs(process.argv.slice(2)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
