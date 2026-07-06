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

const defaultMatrixPath = "docs/developers/mcp-client-smoke-results.json";
const hostedPlaceholder = "<production-like-/mcp-url>";

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

function hostedTarget(options: Options) {
  return options.hostedUrl ?? hostedPlaceholder;
}

function repoPreflightCommand(client: ClientEntry, check: SmokeCheck, options: Options) {
  const target = hostedTarget(options);

  if (client.id === "claude-code" && check.id === "local-stdio") {
    return "pnpm smoke:mcp-claude-code";
  }

  if (client.id === "claude-code" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url ${target} --hosted-data`;
  }

  if (client.id === "mcp-inspector" && check.id === "hosted-anonymous-read") {
    return `pnpm smoke:mcp-inspector -- --hosted-url ${target} --hosted-data`;
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
    return "Run Claude Code HTTP OAuth login and record the mcp:read session result.";
  }

  if (client.id === "openai-chatgpt") {
    return "Run the relevant OpenAI or ChatGPT connector surface and record whether noauth/OAuth tool metadata behaves correctly.";
  }

  if (client.id === "mcp-inspector" && check.id === "hosted-oauth") {
    return "Use Inspector or a protocol client against the hosted OAuth path and record DCR/CIMD plus mcp:read behavior.";
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

function countPendingRequired(matrix: SmokeMatrix) {
  const pendingClientRows = matrix.clients.reduce(
    (total, client) =>
      total + client.checks.filter((check) => check.requiredForExternalReadiness && check.manualStatus !== "pass").length,
    0,
  );
  const pendingHostedRows = (matrix.hostedReadiness?.checks ?? [])
    .filter((check) => check.requiredForExternalReadiness && check.status !== "pass")
    .length;

  return pendingClientRows + pendingHostedRows;
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
  const pendingRequired = countPendingRequired(matrix);

  console.log("# MCP Client Smoke Plan");
  console.log("");
  console.log(`Matrix: ${options.matrixPath}`);
  console.log(`Last reviewed: ${matrix.lastReviewed}`);
  console.log(`Readiness mode: ${matrix.readinessMode}`);
  console.log(`Target environment: ${matrix.targetEnvironment ?? "not recorded"}`);
  console.log(`Hosted URL for generated commands: ${hostedTarget(options)}`);
  console.log(`Pending required rows: ${pendingRequired}`);
  console.log("");
  console.log("| Hosted evidence | Status | Repo smoke | Recorder command |");
  console.log("| --- | --- | --- | --- |");

  for (const check of matrix.hostedReadiness?.checks ?? []) {
    if (!shouldPrintHostedReadiness(check, options)) {
      continue;
    }

    console.log(
      `| ${[
        markdownCell(check.id),
        markdownCell(check.status),
        markdownCell(inlineCode(hostedReadinessCommand(check, options))),
        markdownCell(inlineCode(hostedReadinessRecorderCommand(check))),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("| Client | Check | Status | Repo preflight | Manual evidence | Recorder command |");
  console.log("| --- | --- | --- | --- | --- | --- |");

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
          markdownCell(manualEvidencePrompt(client, check)),
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
