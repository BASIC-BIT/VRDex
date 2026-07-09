import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Client = {
  cli: string;
  id: "cursor" | "vscode" | "windsurf";
  matrixClient: "cursor" | "devin-windsurf" | "vscode";
  name: string;
};

type Options = {
  hostedUrl?: string;
  matrixPath: string;
  outputDir: string;
  repoRoot: string;
  targetEnvironment: string;
};

type CheckId = "hosted-anonymous-read" | "hosted-oauth" | "local-stdio";

type EvidenceTemplate = {
  check: CheckId;
  clientName: string;
  environment: string;
  hosted: boolean;
  matrixClient: string;
  prompt: string;
  recorder: string;
  setup: string;
  setupLanguage?: "powershell" | "txt";
  targetEnvironment: string;
};

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";

type SmokeCheck = {
  id: string;
  manualStatus: ManualStatus;
  requiredForExternalReadiness: boolean;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  schemaVersion: 1;
};

type OpenMatrixRow = {
  checkId: string;
  clientId: string;
  clientName: string;
};

type PendingBlocker = {
  label: string;
  nextAction: string;
  rows: string[];
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
const installedAppClientIds = new Set(["cursor", "devin-windsurf", "vscode"]);
const blockerOrder = [
  "oauth-smoke-credentials",
  "missing-client-install",
  "installed-app-tool-call",
  "installed-app-oauth",
  "desktop-custom-connector",
  "hosted-product-surface",
  "manual-client-evidence",
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
    matrixPath: process.env.VRDEX_MCP_CLIENT_MATRIX_PATH?.trim()
      || "docs/developers/mcp-client-smoke-results.json",
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
      case "--matrix":
        options.matrixPath = takeValue(argv, index, arg);
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
  assert.notEqual(options.matrixPath.trim(), "", "--matrix or VRDEX_MCP_CLIENT_MATRIX_PATH must not be empty.");
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

function geminiLocalSettings(options: Options) {
  const local = localStdioDefinition(options);

  return {
    mcp: {
      allowed: ["vrdex"],
    },
    mcpServers: {
      vrdex: {
        args: local.args,
        command: local.command,
        env: local.env,
        timeout: 600_000,
        trust: false,
      },
    },
  };
}

function geminiHostedSettings(options: Options, tokenPlaceholder = false) {
  return {
    mcp: {
      allowed: ["vrdex"],
    },
    mcpServers: {
      vrdex: {
        ...(tokenPlaceholder
          ? {
              headers: {
                Authorization: "Bearer <mcp-resource-token>",
              },
            }
          : {}),
        httpUrl: hostedMcpUrl(options.hostedUrl!),
        timeout: 600_000,
        trust: false,
      },
    },
  };
}

function psSingleQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function installCommand(client: Client, outputDir: string, configFile: string, repoRoot: string, userDataKey: string) {
  const userDataDir = path.join(outputDir, "user-data", client.id, userDataKey);

  return [
    `$mcpJson = (Get-Content -Raw ${psSingleQuote(configFile)}).Trim().Replace('"', '\\"')`,
    [
      client.cli,
      "--user-data-dir",
      psSingleQuote(userDataDir),
      "--add-mcp",
      "$mcpJson",
      psSingleQuote(repoRoot),
    ].join(" "),
  ].join("\n");
}

function recorderCommand(args: {
  check: CheckId;
  client: Client;
  environment: string;
  hosted: boolean;
  targetEnvironment: string;
}) {
  return recorderCommandForMatrixClient({
    ...args,
    matrixClient: args.client.matrixClient,
  });
}

function recorderCommandForMatrixClient(args: {
  check: CheckId;
  environment: string;
  hosted: boolean;
  matrixClient: string;
  targetEnvironment: string;
}) {
  return [
    "pnpm record:mcp-client-smoke --",
    `--client ${args.matrixClient}`,
    `--check ${args.check}`,
    "--status pass",
    `--environment ${JSON.stringify(args.environment)}`,
    '--evidence "<sanitized screenshot or transcript showing tools/list and vrdex_search>"',
    args.hosted ? `--target-environment ${JSON.stringify(args.targetEnvironment)}` : undefined,
  ].filter(Boolean).join(" ");
}

function smokePrompt(mode: CheckId) {
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

function matrixRowKey(clientId: string, checkId: string) {
  return `${clientId}/${checkId}`;
}

async function openRequiredMatrixRows(matrixPath: string) {
  const matrix = JSON.parse(await readFile(matrixPath, "utf8")) as SmokeMatrix;

  assert.equal(matrix.schemaVersion, 1, "MCP client smoke matrix schemaVersion must be 1.");
  assert.equal(Array.isArray(matrix.clients), true, "MCP client smoke matrix clients must be an array.");

  const rows: OpenMatrixRow[] = [];

  for (const client of matrix.clients) {
    assert.equal(typeof client.id, "string", "MCP client smoke matrix client id must be a string.");
    assert.equal(typeof client.name, "string", `${client.id} client name must be a string.`);
    assert.equal(Array.isArray(client.checks), true, `${client.id} checks must be an array.`);

    for (const check of client.checks) {
      assert.equal(typeof check.id, "string", `${client.id} check id must be a string.`);
      assert.equal(
        typeof check.requiredForExternalReadiness,
        "boolean",
        `${client.id}/${check.id} requiredForExternalReadiness must be a boolean.`,
      );

      if (check.requiredForExternalReadiness && check.manualStatus !== "pass") {
        rows.push({
          checkId: check.id,
          clientId: client.id,
          clientName: client.name,
        });
      }
    }
  }

  return rows;
}

function blockerForOpenRow(row: OpenMatrixRow): { id: string } & Omit<PendingBlocker, "rows"> {
  if (row.clientId === "gemini-cli") {
    if (row.checkId === "hosted-oauth") {
      return {
        id: "missing-client-install",
        label: "Missing client install or account setup",
        nextAction: "Run the Gemini CLI real-client smoke with Google auth and native OAuth or a reviewed-token fallback; use --gemini-package @google/gemini-cli@latest if Gemini CLI is not installed.",
      };
    }

    return {
      id: "missing-client-install",
      label: "Missing client install or account setup",
      nextAction: "Run the Gemini CLI real-client smoke with Google auth, or apply the generated settings snippet and capture an interactive /mcp tool-call session; use --gemini-package @google/gemini-cli@latest if Gemini CLI is not installed.",
    };
  }

  if (row.checkId === "hosted-oauth" && (row.clientId === "claude-code" || row.clientId === "mcp-inspector")) {
    return {
      id: "oauth-smoke-credentials",
      label: "OAuth smoke credentials",
      nextAction: "Provide reviewed OAuth smoke secrets or explicitly enable the temporary hosted credential-generation gate before running authenticated client smokes.",
    };
  }

  if (row.clientId === "claude-desktop") {
    return {
      id: "desktop-custom-connector",
      label: "Desktop or custom connector session",
      nextAction: "Run Claude Desktop or its current Custom Connector path and capture a real tools/list plus vrdex_search result.",
    };
  }

  if (row.clientId === "openai-chatgpt") {
    return {
      id: "hosted-product-surface",
      label: "OpenAI API key or hosted product surface access",
      nextAction: "Run pnpm smoke:mcp-openai with an OpenAI API key against a target that includes hosted search/fetch aliases, and separately verify ChatGPT Apps/Connectors UI plus OAuth behavior before launch snippets.",
    };
  }

  if (installedAppClientIds.has(row.clientId) && row.checkId === "hosted-oauth") {
    return {
      id: "installed-app-oauth",
      label: "Installed app OAuth session",
      nextAction: "Use the generated app setup and capture the current client's hosted OAuth behavior, falling back to a short-lived token only when documented.",
    };
  }

  if (installedAppClientIds.has(row.clientId)) {
    return {
      id: "installed-app-tool-call",
      label: "Installed app tool-call session",
      nextAction: "Open the installed app with the generated session pack, list VRDex tools, call vrdex_search, and record sanitized evidence.",
    };
  }

  return {
    id: "manual-client-evidence",
    label: "Manual client evidence",
    nextAction: "Run the real client session from the generated worksheet and record sanitized tools/list plus vrdex_search evidence.",
  };
}

function addPendingBlocker(
  blockers: Map<string, PendingBlocker>,
  blocker: { id: string } & Omit<PendingBlocker, "rows">,
  row: OpenMatrixRow,
) {
  const rowKey = matrixRowKey(row.clientId, row.checkId);
  const existing = blockers.get(blocker.id);

  if (existing !== undefined) {
    existing.rows.push(rowKey);

    return;
  }

  blockers.set(blocker.id, {
    label: blocker.label,
    nextAction: blocker.nextAction,
    rows: [rowKey],
  });
}

function pendingBlockerSummary(openRows: OpenMatrixRow[]) {
  const blockers = new Map<string, PendingBlocker>();

  for (const row of openRows) {
    addPendingBlocker(blockers, blockerForOpenRow(row), row);
  }

  return blockerOrder
    .map((id) => blockers.get(id))
    .filter((blocker): blocker is PendingBlocker => blocker !== undefined);
}

function pendingBlockerSummarySection(openRows: OpenMatrixRow[]) {
  const blockers = pendingBlockerSummary(openRows);

  if (blockers.length === 0) {
    return [
      "## Open Blocker Summary",
      "",
      "All required rows are pass in the source matrix.",
      "",
    ];
  }

  return [
    "## Open Blocker Summary",
    "",
    "Generated from required rows that are not pass in the source matrix. Use this section to choose the next manual smoke batch before filling individual evidence worksheets.",
    "",
    "| Blocker | Open rows | Next action |",
    "| --- | --- | --- |",
    ...blockers.map((blocker) =>
      `| ${blocker.label} | ${blocker.rows.map((row) => `\`${row}\``).join(", ")} | ${blocker.nextAction} |`,
    ),
    "",
  ];
}

async function verifyOpenWorksheetCoverage(matrixPath: string, generatedKeys: Set<string>) {
  const openRows = await openRequiredMatrixRows(matrixPath);
  const missingRows = openRows.filter((row) => !generatedKeys.has(matrixRowKey(row.clientId, row.checkId)));

  assert.deepEqual(
    missingRows.map((row) => matrixRowKey(row.clientId, row.checkId)),
    [],
    "MCP client session pack is missing evidence worksheets for open required matrix rows.",
  );

  return openRows;
}

function manualEvidenceTemplates(options: Options): EvidenceTemplate[] {
  const hostedUrl = hostedMcpUrl(options.hostedUrl!);
  const origin = hostedOrigin(options.hostedUrl!);
  const targetEnvironment = options.targetEnvironment;
  const desktopLocal = localStdioDefinition({
    ...options,
    repoRoot: path.resolve(options.repoRoot),
  });
  const localDefinition = JSON.stringify({
    args: desktopLocal.args,
    command: desktopLocal.command,
    env: desktopLocal.env,
  });

  return [
    {
      check: "local-stdio",
      clientName: "Claude Desktop",
      environment: "Claude Desktop / local stdio / current desktop app",
      hosted: false,
      matrixClient: "claude-desktop",
      prompt: smokePrompt("local-stdio"),
      recorder: recorderCommandForMatrixClient({
        check: "local-stdio",
        environment: "Claude Desktop / local stdio / current desktop app",
        hosted: false,
        matrixClient: "claude-desktop",
        targetEnvironment,
      }),
      setup: `Add mcpServers.vrdex using this local stdio definition, then restart Claude Desktop if required: ${localDefinition}`,
      setupLanguage: "txt",
      targetEnvironment,
    },
    {
      check: "hosted-anonymous-read",
      clientName: "Claude Desktop",
      environment: `Claude Desktop / Custom Connector / ${hostedUrl}`,
      hosted: true,
      matrixClient: "claude-desktop",
      prompt: smokePrompt("hosted-anonymous-read"),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-anonymous-read",
        environment: `Claude Desktop / Custom Connector / ${hostedUrl}`,
        hosted: true,
        matrixClient: "claude-desktop",
        targetEnvironment,
      }),
      setup: `Use Claude Desktop Custom Connector or the current remote MCP setup path for ${hostedUrl}. Verify anonymous public-read tools before starting OAuth.`,
      setupLanguage: "txt",
      targetEnvironment,
    },
    {
      check: "hosted-oauth",
      clientName: "Claude Desktop",
      environment: `Claude Desktop / Custom Connector / ${hostedUrl} / hosted OAuth`,
      hosted: true,
      matrixClient: "claude-desktop",
      prompt: smokePrompt("hosted-oauth"),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-oauth",
        environment: `Claude Desktop / Custom Connector / ${hostedUrl} / hosted OAuth`,
        hosted: true,
        matrixClient: "claude-desktop",
        targetEnvironment,
      }),
      setup: `Use Claude Desktop Custom Connector or the current remote MCP setup path for ${hostedUrl}. Complete hosted OAuth when prompted and verify an mcp:read tool call.`,
      setupLanguage: "txt",
      targetEnvironment,
    },
    {
      check: "hosted-oauth",
      clientName: "Claude Code",
      environment: `Windows / Claude Code / ${hostedUrl} / hosted OAuth`,
      hosted: true,
      matrixClient: "claude-code",
      prompt: smokePrompt("hosted-oauth"),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-oauth",
        environment: `Windows / Claude Code / ${hostedUrl} / hosted OAuth`,
        hosted: true,
        matrixClient: "claude-code",
        targetEnvironment,
      }),
      setup: [
        "$env:VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID='<reviewed-client-id>'",
        "$env:VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET='<client-secret>'",
        `pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${hostedUrl} --hosted-data`,
        "# Or use claude mcp login vrdex against the same hosted target and capture sanitized client output.",
      ].join("\n"),
      targetEnvironment,
    },
    {
      check: "hosted-anonymous-read",
      clientName: "OpenAI Responses API and ChatGPT MCP-capable surfaces",
      environment: `OpenAI Responses API or ChatGPT hosted MCP surface / ${hostedUrl}`,
      hosted: true,
      matrixClient: "openai-chatgpt",
      prompt: [
        "Run the OpenAI Responses API smoke or configure the relevant ChatGPT MCP-capable surface for the VRDex hosted MCP endpoint.",
        "Verify the public read tools appear as anonymous/no-auth tools when the product surface exposes per-tool auth metadata.",
        "Call search with query \"club\", then call fetch for the first returned result id.",
        "Record whether the connector forced login before a safe public read.",
      ].join(" "),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-anonymous-read",
        environment: `OpenAI Responses API or ChatGPT hosted MCP surface / ${hostedUrl}`,
        hosted: true,
        matrixClient: "openai-chatgpt",
        targetEnvironment,
      }),
      setup: [
        "# If OPENAI_API_KEY is present in repo-root .env.local, no shell export is required.",
        "# Optional one-off override: $env:OPENAI_API_KEY='<api-key>'",
        `pnpm smoke:mcp-openai -- --hosted-url ${hostedUrl} --hosted-data`,
        `# For ChatGPT Apps/Connectors UI evidence, configure the current product surface for ${hostedUrl}. Use ${origin} only when the product asks for an origin separate from the MCP endpoint.`,
      ].join("\n"),
      targetEnvironment,
    },
    {
      check: "hosted-oauth",
      clientName: "OpenAI and ChatGPT MCP-capable surfaces",
      environment: `OpenAI or ChatGPT hosted MCP surface / ${hostedUrl} / hosted OAuth`,
      hosted: true,
      matrixClient: "openai-chatgpt",
      prompt: [
        "Configure the relevant OpenAI or ChatGPT MCP-capable surface for hosted VRDex OAuth.",
        "Record whether the surface accepts public-client Client ID Metadata Documents, uses Dynamic Client Registration, or requires an app review path.",
        "Complete an mcp:read OAuth session if the surface allows it and call search plus fetch.",
      ].join(" "),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-oauth",
        environment: `OpenAI or ChatGPT hosted MCP surface / ${hostedUrl} / hosted OAuth`,
        hosted: true,
        matrixClient: "openai-chatgpt",
        targetEnvironment,
      }),
      setup: `Configure the current OpenAI or ChatGPT connector surface for ${hostedUrl}. Prefer the public-client Client ID Metadata Document flow when the surface supports it; record any product review requirement instead of marking pass if setup cannot complete.`,
      setupLanguage: "txt",
      targetEnvironment,
    },
    {
      check: "hosted-oauth",
      clientName: "MCP Inspector",
      environment: `Windows / MCP Inspector CLI / ${hostedUrl} / hosted OAuth`,
      hosted: true,
      matrixClient: "mcp-inspector",
      prompt: smokePrompt("hosted-oauth"),
      recorder: recorderCommandForMatrixClient({
        check: "hosted-oauth",
        environment: `Windows / MCP Inspector CLI / ${hostedUrl} / hosted OAuth`,
        hosted: true,
        matrixClient: "mcp-inspector",
        targetEnvironment,
      }),
      setup: [
        "$env:VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_ID='<reviewed-client-id>'",
        "$env:VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_SECRET='<client-secret>'",
        `pnpm smoke:mcp-inspector -- --hosted-url ${hostedUrl} --hosted-data`,
      ].join("\n"),
      targetEnvironment,
    },
  ];
}

async function writeJson(pathname: string, value: unknown) {
  await writeFile(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

function evidenceStatusLine(template: EvidenceTemplate) {
  return template.matrixClient === "openai-chatgpt"
    ? "Status: pending until a real client session lists tools and calls `search` plus `fetch`."
    : "Status: pending until a real client session lists tools and calls `vrdex_search`.";
}

function evidenceToolChecklist(template: EvidenceTemplate) {
  return template.matrixClient === "openai-chatgpt"
    ? [
        "- [ ] Client calls `search` with query `club`.",
        "- [ ] Client calls `fetch` with the first returned result id.",
        "- [ ] Client returns a non-error structured result and the first result id is recorded.",
      ]
    : [
        "- [ ] Client calls `vrdex_search` exactly once with query `club`, type `all`, and limit `1`.",
        "- [ ] Client returns a non-error structured result and the first result slug is recorded.",
      ];
}

function evidencePassGuidance(template: EvidenceTemplate) {
  return template.matrixClient === "openai-chatgpt"
    ? "For `pass`, include the tool list, the `search` and `fetch` calls, and the first returned id. For `fail`, include the exact failed step, client-visible error, client version, auth mode, and any upstream issue link without including credentials."
    : "For `pass`, include the tool list, the `vrdex_search` call, and the first returned slug. For `fail`, include the exact failed step, client-visible error, client version, auth mode, and any upstream issue link without including credentials.";
}

async function writeEvidenceTemplate(outputPath: string, template: EvidenceTemplate) {
  const targetLine = template.hosted
    ? `Target environment: ${template.targetEnvironment}`
    : "Target environment: not applicable for local stdio";
  const evidenceFileRecorder = `pnpm record:mcp-client-smoke -- --evidence-file ${psSingleQuote(outputPath)}`;
  const hostedOAuthPrereqSection = template.check === "hosted-oauth"
    ? [
        "## Hosted OAuth Prerequisite Audit",
        "",
        "Run this before attempting the hosted OAuth session:",
        "",
        "```powershell",
        "pnpm ops:mcp-hosted-oauth-prereqs",
        "```",
        "",
        "Use `pnpm ops:mcp-hosted-oauth-prereqs -- --require-ready` when this row must fail closed until reviewed OAuth secrets or temporary credential generation are configured.",
        "",
      ]
    : [];
  const content = [
    `# ${template.clientName} ${template.check} MCP Smoke Evidence`,
    "",
    evidenceStatusLine(template),
    "",
    `Matrix row: ${template.matrixClient}/${template.check}`,
    `Environment: ${template.environment}`,
    targetLine,
    "",
    ...hostedOAuthPrereqSection,
    "## Setup",
    "",
    `\`\`\`${template.setupLanguage ?? "powershell"}`,
    template.setup,
    "```",
    "",
    "## Smoke Prompt",
    "",
    "```txt",
    template.prompt,
    "```",
    "",
    "## Evidence Checklist",
    "",
    "- [ ] Client session shows the VRDex MCP server named `vrdex`.",
    "- [ ] Client lists the expected VRDex tools.",
    ...evidenceToolChecklist(template),
    template.check === "hosted-oauth"
      ? "- [ ] Hosted OAuth prerequisites are ready, or the exact reviewed-secret / temporary-credential blocker is recorded."
      : undefined,
    template.check === "hosted-anonymous-read"
      ? "- [ ] The client does not force login before the anonymous public-read call, or that login requirement is recorded as the failure."
      : undefined,
    "- [ ] Screenshot or transcript is sanitized before the row is recorded.",
    "- [ ] No bearer tokens, OAuth client secrets, full authorization headers, or private account details are captured.",
    "",
    evidencePassGuidance(template),
    "",
    "## Sanitized Evidence Summary",
    "",
    "Replace this paragraph with the sanitized screenshot path, transcript path, PR artifact URL, or failure summary before running the recorder command. Keep tokens, OAuth client secrets, full authorization headers, and private account details out of this section.",
    "",
    "## Recorder Command",
    "",
    "After the client session is complete, change the `Status:` line above to `pass` or `fail`, replace the sanitized evidence summary, then run:",
    "",
    "```powershell",
    evidenceFileRecorder,
    "```",
    "",
    "Expanded recorder command, for reference:",
    "",
    "```powershell",
    template.recorder,
    "```",
    "",
  ].filter((line) => line !== undefined).join("\n");

  await writeFile(outputPath, content, "utf8");
}

async function writeSessionPack(options: Options) {
  const outputDir = path.resolve(options.outputDir);
  const repoRoot = path.resolve(options.repoRoot);
  const configsDir = path.join(outputDir, "configs");
  const evidenceDir = path.join(outputDir, "evidence");

  await mkdir(configsDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  const evidenceRows: string[] = [];
  const generatedEvidenceKeys = new Set<string>();
  const rows: string[] = [];
  const readmeSections: string[] = [
    "# MCP Client Smoke Session Pack",
    "",
    "Generated disposable setup files for installed VS Code-family MCP clients and Gemini CLI, plus recordable worksheets for manual-only MCP client rows.",
    "These files are operator aids, not matrix evidence. Record a pass only after the real client lists tools and calls the expected public read tool (`vrdex_search`, or `search` plus `fetch` for OpenAI/ChatGPT surfaces); record a fail only with sanitized evidence of the exact client-side blocker.",
    "Evidence templates are pending worksheets until they are filled with sanitized real-client output or sanitized failure evidence.",
    "Each VS Code-family row uses its own isolated user-data directory so local, hosted anonymous, and hosted token-fallback configs cannot overwrite each other.",
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
    "Before starting any hosted OAuth row, run `pnpm ops:mcp-hosted-oauth-prereqs` and keep the result with the smoke notes so missing reviewed secrets or temporary credential-generation gates are visible.",
    "",
  ];

  for (const client of clients) {
    const localConfig = path.join(configsDir, `${client.id}-local-stdio.add-mcp.json`);
    const hostedConfig = path.join(configsDir, `${client.id}-hosted-http.add-mcp.json`);
    const hostedTokenConfig = path.join(configsDir, `${client.id}-hosted-token.add-mcp.json`);

    await writeJson(localConfig, localStdioDefinition({ ...options, repoRoot }));
    await writeJson(hostedConfig, hostedDefinition(options));
    await writeJson(hostedTokenConfig, hostedDefinition(options, true));

    const localEnvironment = `Windows / ${client.name} / isolated user-data / local stdio`;
    const hostedEnvironment = `Windows / ${client.name} / isolated user-data / ${hostedMcpUrl(options.hostedUrl!)}`;
    const commands = {
      hostedAnonymous: installCommand(
        client,
        outputDir,
        hostedConfig,
        repoRoot,
        "hosted-anonymous-read",
      ),
      hostedOauthFallback: installCommand(
        client,
        outputDir,
        hostedTokenConfig,
        repoRoot,
        "hosted-oauth-token-fallback",
      ),
      local: installCommand(client, outputDir, localConfig, repoRoot, "local-stdio"),
    };
    const localRecorder = recorderCommand({
      check: "local-stdio",
      client,
      environment: localEnvironment,
      hosted: false,
      targetEnvironment: options.targetEnvironment,
    });
    const hostedAnonymousRecorder = recorderCommand({
      check: "hosted-anonymous-read",
      client,
      environment: hostedEnvironment,
      hosted: true,
      targetEnvironment: options.targetEnvironment,
    });
    const hostedOauthRecorder = recorderCommand({
      check: "hosted-oauth",
      client,
      environment: `${hostedEnvironment} / hosted OAuth`,
      hosted: true,
      targetEnvironment: options.targetEnvironment,
    });
    const evidenceTemplates = [
      {
        check: "local-stdio" as const,
        environment: localEnvironment,
        hosted: false,
        prompt: smokePrompt("local-stdio"),
        recorder: localRecorder,
        setup: commands.local,
      },
      {
        check: "hosted-anonymous-read" as const,
        environment: hostedEnvironment,
        hosted: true,
        prompt: smokePrompt("hosted-anonymous-read"),
        recorder: hostedAnonymousRecorder,
        setup: commands.hostedAnonymous,
      },
      {
        check: "hosted-oauth" as const,
        environment: `${hostedEnvironment} / hosted OAuth`,
        hosted: true,
        prompt: smokePrompt("hosted-oauth"),
        recorder: hostedOauthRecorder,
        setup: commands.hostedOauthFallback,
      },
    ];

    for (const template of evidenceTemplates) {
      const evidencePath = path.join(evidenceDir, `${client.matrixClient}-${template.check}.md`);

      await writeEvidenceTemplate(evidencePath, {
        ...template,
        clientName: client.name,
        matrixClient: client.matrixClient,
        targetEnvironment: options.targetEnvironment,
      });
      generatedEvidenceKeys.add(matrixRowKey(client.matrixClient, template.check));
      evidenceRows.push(`| ${client.name} | ${template.check} | \`${evidencePath}\` |`);
    }

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
      localRecorder,
      "```",
      "",
      `Evidence template: \`${path.join(evidenceDir, `${client.matrixClient}-local-stdio.md`)}\``,
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
      hostedAnonymousRecorder,
      "```",
      "",
      `Evidence template: \`${path.join(evidenceDir, `${client.matrixClient}-hosted-anonymous-read.md`)}\``,
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
      hostedOauthRecorder,
      "```",
      "",
      `Evidence template: \`${path.join(evidenceDir, `${client.matrixClient}-hosted-oauth.md`)}\``,
      "",
    );
  }

  const geminiLocalConfig = path.join(configsDir, "gemini-cli-local-stdio.settings.json");
  const geminiHostedConfig = path.join(configsDir, "gemini-cli-hosted-http.settings.json");
  const geminiHostedTokenConfig = path.join(configsDir, "gemini-cli-hosted-token.settings.json");
  const geminiLocalEnvironment = "Windows / Gemini CLI / settings.json local stdio";
  const geminiHostedEnvironment = `Windows / Gemini CLI / settings.json / ${hostedMcpUrl(options.hostedUrl!)}`;

  await writeJson(geminiLocalConfig, geminiLocalSettings({ ...options, repoRoot }));
  await writeJson(geminiHostedConfig, geminiHostedSettings(options));
  await writeJson(geminiHostedTokenConfig, geminiHostedSettings(options, true));

  const geminiLocalRecorder = recorderCommandForMatrixClient({
    check: "local-stdio",
    environment: geminiLocalEnvironment,
    hosted: false,
    matrixClient: "gemini-cli",
    targetEnvironment: options.targetEnvironment,
  });
  const geminiHostedAnonymousRecorder = recorderCommandForMatrixClient({
    check: "hosted-anonymous-read",
    environment: geminiHostedEnvironment,
    hosted: true,
    matrixClient: "gemini-cli",
    targetEnvironment: options.targetEnvironment,
  });
  const geminiHostedOauthRecorder = recorderCommandForMatrixClient({
    check: "hosted-oauth",
    environment: `${geminiHostedEnvironment} / hosted OAuth`,
    hosted: true,
    matrixClient: "gemini-cli",
    targetEnvironment: options.targetEnvironment,
  });
  const geminiEvidenceTemplates = [
    {
      check: "local-stdio" as const,
      environment: geminiLocalEnvironment,
      hosted: false,
      prompt: smokePrompt("local-stdio"),
      recorder: geminiLocalRecorder,
      setup: `Prefer pnpm smoke:mcp-gemini-cli for repeatable evidence. Interactive fallback: merge settings snippet ${psSingleQuote(geminiLocalConfig)} into Gemini CLI settings.json.`,
    },
    {
      check: "hosted-anonymous-read" as const,
      environment: geminiHostedEnvironment,
      hosted: true,
      prompt: smokePrompt("hosted-anonymous-read"),
      recorder: geminiHostedAnonymousRecorder,
      setup: `Prefer pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${hostedMcpUrl(options.hostedUrl!)} --hosted-data for repeatable evidence. Interactive fallback: merge settings snippet ${psSingleQuote(geminiHostedConfig)} into Gemini CLI settings.json.`,
    },
    {
      check: "hosted-oauth" as const,
      environment: `${geminiHostedEnvironment} / hosted OAuth`,
      hosted: true,
      prompt: smokePrompt("hosted-oauth"),
      recorder: geminiHostedOauthRecorder,
      setup: `Prefer Gemini CLI native OAuth discovery first. For repeatable fallback evidence, set VRDEX_GEMINI_CLI_OAUTH_TOKEN or reviewed OAuth client credentials, then run pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${hostedMcpUrl(options.hostedUrl!)} --hosted-data. Interactive fallback: merge OAuth-discovery settings snippet ${psSingleQuote(geminiHostedConfig)} into Gemini CLI settings.json; use ${psSingleQuote(geminiHostedTokenConfig)} only as the token-header fallback.`,
    },
  ];

  for (const template of geminiEvidenceTemplates) {
    const evidencePath = path.join(evidenceDir, `gemini-cli-${template.check}.md`);

    await writeEvidenceTemplate(evidencePath, {
      ...template,
      clientName: "Gemini CLI",
      matrixClient: "gemini-cli",
      targetEnvironment: options.targetEnvironment,
    });
    generatedEvidenceKeys.add(matrixRowKey("gemini-cli", template.check));
    evidenceRows.push(`| Gemini CLI | ${template.check} | \`${evidencePath}\` |`);
  }

  rows.push(
    `| Gemini CLI | gemini-cli | \`${geminiLocalConfig}\` | \`${geminiHostedConfig}\` | \`${geminiHostedTokenConfig}\` |`,
  );

  readmeSections.push(
    "## Gemini CLI",
    "",
    "Prefer `pnpm smoke:mcp-gemini-cli` for repeatable headless evidence. If Gemini CLI is not installed globally, append `--gemini-package @google/gemini-cli@latest` so the smoke runs through a disposable package. Interactive fallback: merge the relevant generated settings snippet into Gemini CLI `settings.json` and keep the server key as `vrdex`; Gemini CLI policy parsing can misread server names that contain underscores.",
    "",
    "### Local Stdio Row",
    "",
    `Settings snippet: \`${geminiLocalConfig}\``,
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
    geminiLocalRecorder,
    "```",
    "",
    `Evidence template: \`${path.join(evidenceDir, "gemini-cli-local-stdio.md")}\``,
    "",
    "### Hosted Anonymous-Read Row",
    "",
    `Settings snippet: \`${geminiHostedConfig}\``,
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
    geminiHostedAnonymousRecorder,
    "```",
    "",
    `Evidence template: \`${path.join(evidenceDir, "gemini-cli-hosted-anonymous-read.md")}\``,
    "",
    "### Hosted OAuth Row",
    "",
    "Prefer Gemini CLI's native OAuth discovery first. Run `/mcp auth vrdex` when the client reports that authentication is required for protected MCP tools. Use the token-header settings snippet only if the current release cannot complete OAuth but can prove authenticated MCP access with a short-lived MCP-resource token.",
    "",
    `OAuth-discovery settings snippet: \`${geminiHostedConfig}\``,
    `Token-header fallback settings snippet: \`${geminiHostedTokenConfig}\``,
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
    geminiHostedOauthRecorder,
    "```",
    "",
    `Evidence template: \`${path.join(evidenceDir, "gemini-cli-hosted-oauth.md")}\``,
    "",
  );

  const manualRows: string[] = [];

  for (const template of manualEvidenceTemplates({ ...options, repoRoot })) {
    const evidencePath = path.join(evidenceDir, `${template.matrixClient}-${template.check}.md`);

    await writeEvidenceTemplate(evidencePath, template);
    generatedEvidenceKeys.add(matrixRowKey(template.matrixClient, template.check));
    evidenceRows.push(`| ${template.clientName} | ${template.check} | \`${evidencePath}\` |`);
    manualRows.push(`| ${template.clientName} | ${template.matrixClient} | ${template.check} | \`${evidencePath}\` |`);
  }

  const openRows = await verifyOpenWorksheetCoverage(options.matrixPath, generatedEvidenceKeys);

  readmeSections.push(
    "## Manual-Only Evidence Rows",
    "",
    "These rows usually require a hosted product surface, a desktop app not present on this machine, or reviewed OAuth credentials. Fill the worksheet after the real client session and record it with the generated `--evidence-file` command.",
    "",
    "| Client | Matrix client id | Check | Evidence template |",
    "| --- | --- | --- | --- |",
    ...manualRows,
    "",
  );

  const readme = [
    ...readmeSections,
    ...pendingBlockerSummarySection(openRows),
    "## Open Matrix Worksheet Coverage",
    "",
    `Matrix: \`${options.matrixPath}\``,
    `Open required rows covered by generated worksheets: ${openRows.length}`,
    "",
    "## Generated Config Files",
    "",
    "| Client | Matrix client id | Local stdio | Hosted HTTP | Hosted token fallback |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Generated Evidence Templates",
    "",
    "| Client | Check | Evidence template |",
    "| --- | --- | --- |",
    ...evidenceRows,
    "",
  ].join("\n");

  const readmePath = path.join(outputDir, "README.md");

  await writeFile(readmePath, readme, "utf8");

  console.log("| Artifact | Path |");
  console.log("| --- | --- |");
  console.log(`| MCP client smoke session pack | ${readmePath} |`);
  console.log(`| Config directory | ${configsDir} |`);
  console.log(`| Evidence template directory | ${evidenceDir} |`);
  console.log(`| Open required worksheet coverage | ${openRows.length} rows |`);
  console.log(`| Hosted MCP URL | ${hostedMcpUrl(options.hostedUrl!)} |`);
}

async function main() {
  await writeSessionPack(parseArgs(process.argv.slice(2)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
