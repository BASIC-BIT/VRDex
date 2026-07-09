import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type ManualStatus = "fail" | "not_applicable" | "pass" | "pending";
type HostedReadinessStatus = "fail" | "pass" | "pending";
type SmokeSurface =
  | "hosted_http_anonymous"
  | "hosted_http_diagnostic"
  | "hosted_http_oauth"
  | "local_stdio";

type SmokeCheck = {
  environment?: string;
  id: string;
  manualEvidence?: string;
  manualStatus: ManualStatus;
  notes?: string;
  repoEvidence?: string;
  requiredForExternalReadiness: boolean;
  surface: SmokeSurface;
};

type ClientEntry = {
  checks: SmokeCheck[];
  id: string;
  name: string;
};

type HostedReadinessCheck = {
  id: string;
  notes?: string;
  requiredForExternalReadiness: boolean;
  status: HostedReadinessStatus;
};

type SmokeMatrix = {
  clients: ClientEntry[];
  hostedReadiness?: {
    checks: HostedReadinessCheck[];
  };
  lastReviewed: string;
  readinessMode: string;
  schemaVersion: 1;
  targetEnvironment: string | null;
};

type Options = {
  checkId?: string;
  clientId?: string;
  hostedUrl?: string;
  includePassed: boolean;
  matrixPath: string;
  requireHostedUrl: boolean;
};

type PendingBlocker = {
  label: string;
  nextAction: string;
  rows: string[];
};

const defaultMatrixPath = "docs/developers/mcp-client-smoke-results.json";
const hostedEvidenceTargetPattern = /\b(same-branch|production-like|staging|production)\b/i;
const pendingHostedEvidencePattern =
  /\b(pending|need|needs|lack|lacks|skipped|unavailable|not deployed|without data-backed|temporarily unavailable)\b/i;
const hostedPlaceholder = "<production-like-/mcp-url>";
const installedAppClientIds = new Set(["cursor", "devin-windsurf", "vscode"]);
const blockerOrder = [
  "hosted-protocol-target",
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
    includePassed: false,
    matrixPath: process.env.VRDEX_MCP_CLIENT_MATRIX_PATH?.trim() || defaultMatrixPath,
    requireHostedUrl: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--check":
        options.checkId = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--client":
        options.clientId = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--include-passed":
        options.includePassed = true;
        break;
      case "--matrix":
        options.matrixPath = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--require-hosted-url":
        options.requireHostedUrl = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function markdownCell(value: string | undefined) {
  return (value ?? "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .trim();
}

function inlineCode(value: string) {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function jsonInline(value: unknown) {
  return JSON.stringify(value).replaceAll("`", "\\`");
}

function psEscapedJsonAssignment(value: unknown) {
  return `$mcpJson = '${JSON.stringify(value).replaceAll("'", "''").replaceAll('"', '\\"')}'`;
}

function addMcpCommand(cli: string, value: unknown, userDataId: string, suffix?: string) {
  return [
    psEscapedJsonAssignment(value),
    `${cli} --user-data-dir .tmp-gh-artifacts/mcp-client-smoke-session/user-data/${userDataId} --add-mcp $mcpJson`,
    suffix === undefined ? undefined : `# ${suffix}`,
  ].filter(Boolean).join("; ");
}

function hostedTarget(options: Options) {
  return options.hostedUrl ?? hostedPlaceholder;
}

function hostedOrigin(options: Options) {
  const target = hostedTarget(options);

  if (target === hostedPlaceholder) {
    return "<production-like-origin>";
  }

  const url = new URL(target);
  const pathname = url.pathname.replace(/\/mcp\/?$/, "");

  url.pathname = pathname === "" ? "/" : pathname;
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/, "");
}

function repoRootForConfig() {
  return process.cwd().replaceAll("\\", "/");
}

function stdioAddMcpDefinition(options: Options) {
  return {
    args: [
      "pnpm",
      "--silent",
      "--dir",
      repoRootForConfig(),
      "exec",
      "tsx",
      "packages/vrdex-mcp/src/stdio.ts",
    ],
    command: process.platform === "win32" ? "corepack.cmd" : "corepack",
    env: {
      VRDEX_API_BASE_URL: hostedOrigin(options),
      VRDEX_MCP_OUTPUT_MODE: "compact",
    },
    name: "vrdex",
  };
}

function hostedAddMcpDefinition(options: Options) {
  return {
    name: "vrdex",
    type: "http",
    url: hostedTarget(options),
  };
}

function repoPreflightCommand(client: ClientEntry, check: SmokeCheck, options: Options) {
  const target = hostedTarget(options);

  if (client.id === "claude-code" && check.id === "local-stdio") {
    return "pnpm smoke:mcp-claude-code";
  }

  if (client.id === "claude-code" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "claude-code" && check.id === "hosted-oauth") {
    return `VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET=<secret> pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "mcp-inspector" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-inspector -- --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "gemini-cli" && check.id === "local-stdio") {
    return "pnpm smoke:mcp-gemini-cli";
  }

  if (client.id === "gemini-cli" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "gemini-cli" && check.id === "hosted-oauth") {
    return `VRDEX_GEMINI_CLI_OAUTH_TOKEN=<mcp-resource-token> pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "openai-chatgpt" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-openai -- --hosted-url ${target} --hosted-data`;
  }

  if (check.id === "local-stdio") {
    return "pnpm smoke:mcp-compat";
  }

  if (check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-compat -- --hosted-url ${target} --hosted-data`;
  }

  if (check.id === "hosted-oauth") {
    return `pnpm smoke:mcp-compat -- --hosted-url ${target} --hosted-data --dcr --cimd`;
  }

  return "pnpm check:mcp-client-matrix";
}

function manualEvidencePrompt(client: ClientEntry, check: SmokeCheck) {
  if (client.id === "claude-code" && check.id === "hosted-oauth") {
    return "Run Claude Code with a reviewed OAuth app client-credentials token acquisition or a pre-minted MCP-resource token, then record the authenticated mcp:read result; pair with DCR/CIMD protocol evidence.";
  }

  if (client.id === "openai-chatgpt" && check.id === "hosted-anonymous-read") {
    return "Run pnpm smoke:mcp-openai with OPENAI_API_KEY in process env or repo-root .env.local against a target that includes hosted search/fetch aliases, or record ChatGPT Apps/Connectors UI evidence. Confirm public reads do not require OAuth.";
  }

  if (client.id === "openai-chatgpt" && check.id === "hosted-oauth") {
    return "Record ChatGPT Apps/Connectors hosted OAuth behavior, including whether the surface accepts public-client CIMD, uses DCR, or requires app review before mcp:read.";
  }

  if (client.id === "mcp-inspector" && check.id === "hosted-oauth") {
    return "Run Inspector with reviewed OAuth app client credentials or a pre-minted MCP-resource token and record DCR/CIMD plus authenticated mcp:read behavior.";
  }

  if (client.id === "gemini-cli" && check.id === "hosted-oauth") {
    return "Run the Gemini CLI real-client smoke with native OAuth or a short-lived MCP-resource token fallback, then record whether automatic discovery, DCR, token storage, and mcp:read succeed.";
  }

  if (client.id === "gemini-cli" && check.id === "local-stdio") {
    return "Run pnpm smoke:mcp-gemini-cli, or configure Gemini CLI settings.json with a command-based MCP server, run /mcp, and call vrdex_search.";
  }

  if (client.id === "gemini-cli" && check.id === "hosted-anonymous-read") {
    return "Run pnpm smoke:mcp-gemini-cli -- --mode hosted-http, or configure Gemini CLI settings.json with httpUrl pointing at hosted /mcp and call vrdex_search without authenticating.";
  }

  if (check.id === "hosted-anonymous-read") {
    return "Configure the current client release against hosted /mcp and call vrdex_search without a bearer token.";
  }

  if (check.id === "hosted-oauth") {
    return "Configure the current client release for hosted /mcp OAuth and record the mcp:read authorization result.";
  }

  if (check.id === "local-stdio") {
    return "Configure the current client release with local stdio and call vrdex_search.";
  }

  return "Record the current client behavior with sanitized evidence.";
}

function setupHint(client: ClientEntry, check: SmokeCheck, options: Options) {
  const target = hostedTarget(options);

  if (client.id === "claude-code" && check.id === "hosted-oauth") {
    return `Set VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID and VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET for a reviewed client-credentials app, then run pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${target} --hosted-data. As a fallback, set VRDEX_CLAUDE_CODE_OAUTH_TOKEN to a pre-minted MCP-resource token. For an interactive client-session check, use claude mcp add --transport http --callback-port 8765 vrdex ${target} followed by claude mcp login vrdex.`;
  }

  if (client.id === "vscode" && check.id === "local-stdio") {
    return addMcpCommand("code", stdioAddMcpDefinition(options), "vscode");
  }

  if (client.id === "vscode" && check.id === "hosted-anonymous-read") {
    return addMcpCommand("code", hostedAddMcpDefinition(options), "vscode");
  }

  if (client.id === "vscode" && check.id === "hosted-oauth") {
    return addMcpCommand(
      "code",
      hostedAddMcpDefinition(options),
      "vscode",
      "then use VS Code Chat to trigger hosted OAuth and record whether mcp:read succeeds or a token fallback is required.",
    );
  }

  if (client.id === "cursor" && check.id === "local-stdio") {
    return addMcpCommand("cursor", stdioAddMcpDefinition(options), "cursor");
  }

  if (client.id === "cursor" && check.id === "hosted-anonymous-read") {
    return addMcpCommand("cursor", hostedAddMcpDefinition(options), "cursor");
  }

  if (client.id === "cursor" && check.id === "hosted-oauth") {
    return addMcpCommand(
      "cursor",
      hostedAddMcpDefinition(options),
      "cursor",
      "then use Cursor Chat/Agent to trigger hosted OAuth and record whether mcp:read succeeds or a token fallback is required.",
    );
  }

  if (client.id === "devin-windsurf" && check.id === "local-stdio") {
    return addMcpCommand("windsurf", stdioAddMcpDefinition(options), "windsurf");
  }

  if (client.id === "devin-windsurf" && check.id === "hosted-anonymous-read") {
    return addMcpCommand("windsurf", hostedAddMcpDefinition(options), "windsurf");
  }

  if (client.id === "devin-windsurf" && check.id === "hosted-oauth") {
    return addMcpCommand(
      "windsurf",
      hostedAddMcpDefinition(options),
      "windsurf",
      "then use Windsurf Cascade to trigger hosted OAuth and record whether mcp:read succeeds.",
    );
  }

  if (client.id === "claude-desktop" && check.id === "local-stdio") {
    return `Add mcpServers.vrdex with command ${stdioAddMcpDefinition(options).command} and args/env from the shared local stdio config, then call vrdex_search.`;
  }

  if (client.id === "claude-desktop" && check.surface.startsWith("hosted_http")) {
    return `Use Claude Desktop Custom Connector for ${target}; verify hosted anonymous read first, then hosted OAuth for mcp:read.`;
  }

  if (client.id === "openai-chatgpt" && check.id === "hosted-anonymous-read") {
    return `With OPENAI_API_KEY in process env or repo-root .env.local, run pnpm smoke:mcp-openai -- --hosted-url ${target} --hosted-data for Responses API remote MCP search/fetch integration evidence; record ChatGPT Apps/Connectors UI evidence separately when product-surface behavior matters.`;
  }

  if (client.id === "openai-chatgpt" && check.id === "hosted-oauth") {
    return `Configure the current ChatGPT Apps/Connectors surface for ${target}; verify protected-resource metadata, public-client CIMD, DCR fallback, and any app review requirement before recording mcp:read.`;
  }

  if (client.id === "mcp-inspector" && check.id === "hosted-oauth") {
    return `Set VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_ID and VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_SECRET for a reviewed client-credentials app, then run pnpm smoke:mcp-inspector -- --hosted-url ${target} --hosted-data. As a fallback, set VRDEX_MCP_INSPECTOR_OAUTH_TOKEN to a pre-minted MCP-resource token. Pair with pnpm smoke:mcp-compat -- --hosted-only --hosted-url ${target} --hosted-data --dcr --cimd for DCR/CIMD evidence.`;
  }

  if (client.id === "gemini-cli" && check.id === "local-stdio") {
    return `Run pnpm smoke:mcp-gemini-cli with an installed Gemini CLI and Google auth. If Gemini CLI is not installed, use pnpm smoke:mcp-gemini-cli -- --gemini-package @google/gemini-cli@latest. Interactive fallback: add ${jsonInline({ mcpServers: { vrdex: stdioAddMcpDefinition(options) } })} to Gemini CLI settings.json, then run /mcp and call vrdex_search.`;
  }

  if (client.id === "gemini-cli" && check.id === "hosted-anonymous-read") {
    return `Run pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${target} --hosted-data with an installed Gemini CLI and Google auth. If Gemini CLI is not installed, add --gemini-package @google/gemini-cli@latest. Interactive fallback: add ${jsonInline({ mcpServers: { vrdex: { httpUrl: target } } })} to Gemini CLI settings.json, then run /mcp and call vrdex_search without /mcp auth.`;
  }

  if (client.id === "gemini-cli" && check.id === "hosted-oauth") {
    return `Prefer Gemini CLI native OAuth discovery first with ${jsonInline({ mcpServers: { vrdex: { httpUrl: target } } })} and /mcp auth vrdex. For repeatable fallback evidence, set VRDEX_GEMINI_CLI_OAUTH_TOKEN or reviewed OAuth client credentials, then run pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url ${target} --hosted-data. Add --gemini-package @google/gemini-cli@latest if Gemini CLI is not installed.`;
  }

  return "Use the docs matrix row to configure the current client release, then record exact evidence.";
}

function setupHintWithPrereqs(client: ClientEntry, check: SmokeCheck, options: Options) {
  const hint = setupHint(client, check, options);

  return check.id === "hosted-oauth"
    ? `Run pnpm ops:mcp-hosted-oauth-prereqs before the client session. ${hint}`
    : hint;
}

function recordCommand(client: ClientEntry, check: SmokeCheck) {
  const parts = [
    "pnpm record:mcp-client-smoke --",
    `--client ${client.id}`,
    `--check ${check.id}`,
    "--status pass",
    '--environment "<OS / client version / target>"',
    '--evidence "<sanitized evidence link or command output>"',
  ];

  if (check.requiredForExternalReadiness && check.surface.startsWith("hosted_http")) {
    parts.push('--target-environment "<same-branch Convex preview / staging / production-like target>"');
  }

  return parts.join(" ");
}

function shouldPrint(check: SmokeCheck, options: Options) {
  if (options.checkId !== undefined && check.id !== options.checkId) {
    return false;
  }

  if (!check.requiredForExternalReadiness) {
    return options.includePassed && check.manualStatus !== "not_applicable";
  }

  return options.includePassed || check.manualStatus !== "pass";
}

function countOpenRequired(matrix: SmokeMatrix) {
  const openClientRows = matrix.clients.reduce(
    (total, client) =>
      total + client.checks.filter((check) => check.requiredForExternalReadiness && check.manualStatus !== "pass").length,
    0,
  );
  const openHostedRows = (matrix.hostedReadiness?.checks ?? [])
    .filter((check) => check.requiredForExternalReadiness && check.status !== "pass")
    .length;

  return openClientRows + openHostedRows;
}

function clientRowKey(client: ClientEntry, check: SmokeCheck) {
  return `${client.id}/${check.id}`;
}

function hostedReadinessRowKey(check: HostedReadinessCheck) {
  return `hostedReadiness/${check.id}`;
}

function blockerForClientRow(client: ClientEntry, check: SmokeCheck): { id: string } & Omit<PendingBlocker, "rows"> {
  if (client.id === "gemini-cli") {
    if (check.id === "hosted-oauth") {
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

  if (check.id === "hosted-oauth" && (client.id === "claude-code" || client.id === "mcp-inspector")) {
    return {
      id: "oauth-smoke-credentials",
      label: "OAuth smoke credentials",
      nextAction: "Provide reviewed OAuth smoke secrets or explicitly enable the temporary hosted credential-generation gate before running authenticated client smokes.",
    };
  }

  if (client.id === "claude-desktop") {
    return {
      id: "desktop-custom-connector",
      label: "Desktop or custom connector session",
      nextAction: "Run Claude Desktop or its current Custom Connector path and capture a real tools/list plus vrdex_search result.",
    };
  }

  if (client.id === "openai-chatgpt") {
    return {
      id: "hosted-product-surface",
      label: "OpenAI-compatible hosted target or product surface access",
      nextAction: "Run pnpm smoke:mcp-openai with OPENAI_API_KEY in process env or repo-root .env.local against a target that includes hosted search/fetch aliases, and separately verify ChatGPT Apps/Connectors UI plus OAuth behavior before launch snippets.",
    };
  }

  if (installedAppClientIds.has(client.id) && check.id === "hosted-oauth") {
    return {
      id: "installed-app-oauth",
      label: "Installed app OAuth session",
      nextAction: "Use the generated app setup and capture the current client's hosted OAuth behavior, falling back to a short-lived token only when documented.",
    };
  }

  if (installedAppClientIds.has(client.id)) {
    return {
      id: "installed-app-tool-call",
      label: "Installed app tool-call session",
      nextAction: "Open the installed app with the generated session pack, list VRDex tools, call vrdex_search, and record sanitized evidence.",
    };
  }

  if (check.id === "hosted-oauth") {
    return {
      id: "installed-app-oauth",
      label: "Installed app OAuth session",
      nextAction: "Run the real client OAuth flow and record whether protected mcp:read succeeds or needs a documented fallback.",
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
  row: string,
) {
  const existing = blockers.get(blocker.id);

  if (existing !== undefined) {
    existing.rows.push(row);

    return;
  }

  blockers.set(blocker.id, {
    label: blocker.label,
    nextAction: blocker.nextAction,
    rows: [row],
  });
}

function pendingBlockerSummary(matrix: SmokeMatrix, options: Options) {
  const blockers = new Map<string, PendingBlocker>();

  for (const check of matrix.hostedReadiness?.checks ?? []) {
    if (!shouldPrintHostedReadiness(check, options) || check.status === "pass") {
      continue;
    }

    addPendingBlocker(
      blockers,
      {
        id: "hosted-protocol-target",
        label: "Hosted protocol target evidence",
        nextAction: "Run the hosted smoke against a same-branch, staging, production-like, or production backend and record data-backed read, DCR, and CIMD evidence.",
      },
      hostedReadinessRowKey(check),
    );
  }

  for (const client of matrix.clients) {
    if (options.clientId !== undefined && client.id !== options.clientId) {
      continue;
    }

    for (const check of client.checks) {
      if (!shouldPrint(check, options) || !check.requiredForExternalReadiness || check.manualStatus === "pass") {
        continue;
      }

      addPendingBlocker(blockers, blockerForClientRow(client, check), clientRowKey(client, check));
    }
  }

  return blockerOrder
    .map((id) => blockers.get(id))
    .filter((blocker): blocker is PendingBlocker => blocker !== undefined);
}

function isHostedTargetReady(matrix: SmokeMatrix) {
  const target = matrix.targetEnvironment ?? "";

  return (
    hostedEvidenceTargetPattern.test(target) &&
    !pendingHostedEvidencePattern.test(target) &&
    !/\bpending\b/i.test(matrix.readinessMode)
  );
}

function pendingTargetWarning(matrix: SmokeMatrix, options: Options) {
  const hasHostedWork =
    (matrix.hostedReadiness?.checks ?? []).some(
      (check) => shouldPrintHostedReadiness(check, options) && check.status !== "pass",
    ) ||
    matrix.clients.some((client) =>
      client.checks.some(
        (check) =>
          shouldPrint(check, options) &&
          check.requiredForExternalReadiness &&
          check.surface.startsWith("hosted_http") &&
          check.manualStatus !== "pass",
      ),
    );

  if (!hasHostedWork || isHostedTargetReady(matrix)) {
    return undefined;
  }

  return "the recorded target is not eligible for hosted pass evidence yet. Use these commands only as diagnostics until the target is a same-branch Convex preview, staging, production-like, or production backend with data-backed public reads and OAuth storage.";
}

function hostedReadinessCommand(check: HostedReadinessCheck, options: Options) {
  const target = hostedTarget(options);
  const base = `pnpm smoke:mcp-compat -- --hosted-only --hosted-url ${target}`;

  switch (check.id) {
    case "hosted-data-backed-anonymous-read":
      return `${base} --hosted-data`;
    case "hosted-dynamic-client-registration":
      return `${base} --dcr`;
    case "hosted-client-id-metadata-document":
      return `${base} --cimd`;
    default:
      return base;
  }
}

function hostedReadinessRecorderCommand(check: HostedReadinessCheck) {
  return [
    "pnpm record:mcp-hosted-evidence --",
    `--check ${check.id}`,
    "--status pass",
    '--target-environment "<same-branch Convex preview / staging / production-like target>"',
    '--environment "<OS / runner / target>"',
    '--evidence "<sanitized workflow link or command output>"',
  ].join(" ");
}

function shouldPrintHostedReadiness(check: HostedReadinessCheck, options: Options) {
  if (options.checkId !== undefined && check.id !== options.checkId) {
    return false;
  }

  return options.includePassed || check.status !== "pass";
}

function printPlan(matrix: SmokeMatrix, options: Options) {
  const openRequired = countOpenRequired(matrix);
  const warning = pendingTargetWarning(matrix, options);

  console.log("# MCP Client Smoke Plan");
  console.log("");
  console.log(`Matrix: ${options.matrixPath}`);
  console.log(`Last reviewed: ${matrix.lastReviewed}`);
  console.log(`Readiness mode: ${matrix.readinessMode}`);
  console.log(`Target environment: ${matrix.targetEnvironment ?? "not recorded"}`);
  console.log(`Hosted URL for generated commands: ${hostedTarget(options)}`);
  console.log(`Open required rows: ${openRequired}`);
  if (warning !== undefined) {
    console.log(`Target warning: ${warning}`);
  }
  console.log("");
  console.log("## Open Blocker Summary");
  console.log("");
  const blockers = pendingBlockerSummary(matrix, options);

  if (blockers.length === 0) {
    console.log("All required rows that match the current filters are pass.");
  } else {
    console.log("| Blocker | Open rows | Next action |");
    console.log("| --- | --- | --- |");

    for (const blocker of blockers) {
      console.log(
        `| ${[
          markdownCell(blocker.label),
          markdownCell(blocker.rows.map(inlineCode).join(", ")),
          markdownCell(blocker.nextAction),
        ].join(" | ")} |`,
      );
    }
  }
  console.log("");
  console.log("| Hosted evidence | Status | Repo smoke | Notes | Recorder command |");
  console.log("| --- | --- | --- | --- | --- |");

  for (const check of matrix.hostedReadiness?.checks ?? []) {
    if (!shouldPrintHostedReadiness(check, options)) {
      continue;
    }

    console.log(
      `| ${[
        markdownCell(check.id),
        markdownCell(check.status),
        markdownCell(inlineCode(hostedReadinessCommand(check, options))),
        markdownCell(check.notes),
        markdownCell(inlineCode(hostedReadinessRecorderCommand(check))),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("| Client | Check | Status | Repo preflight | Setup hint | Manual evidence | Notes | Recorder command |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const client of matrix.clients) {
    if (options.clientId !== undefined && client.id !== options.clientId) {
      continue;
    }

    for (const check of client.checks) {
      if (!shouldPrint(check, options)) {
        continue;
      }

      console.log(
        `| ${[
          markdownCell(client.name),
          markdownCell(check.id),
          markdownCell(check.manualStatus),
          markdownCell(inlineCode(repoPreflightCommand(client, check, options))),
          markdownCell(inlineCode(setupHintWithPrereqs(client, check, options))),
          markdownCell(manualEvidencePrompt(client, check)),
          markdownCell(check.notes),
          markdownCell(inlineCode(recordCommand(client, check))),
        ].join(" | ")} |`,
      );
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const matrix = JSON.parse(await readFile(options.matrixPath, "utf8")) as SmokeMatrix;

  assert.equal(matrix.schemaVersion, 1, "MCP client smoke matrix schemaVersion must be 1.");
  assert.equal(Array.isArray(matrix.clients), true, "MCP client smoke matrix clients must be an array.");

  if (options.requireHostedUrl && options.hostedUrl === undefined) {
    throw new Error("--hosted-url or VRDEX_MCP_SMOKE_URL is required when --require-hosted-url is set.");
  }

  printPlan(matrix, options);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
