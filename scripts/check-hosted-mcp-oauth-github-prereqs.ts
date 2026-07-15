import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

type GhCommand = {
  argsPrefix: string[];
  command: string;
};

type Options = {
  ghCommand: GhCommand;
  repo: string;
  requireReady: boolean;
};

type GitHubVariable = {
  name?: unknown;
  value?: unknown;
};

type GitHubSecret = {
  name?: unknown;
};

type AuditRow = {
  githubInputs: string;
  name: string;
  nextAction: string;
  required: boolean;
  status: "missing" | "partial" | "pass";
};

const reviewedClientIdSecret = "VRDEX_MCP_OAUTH_CLIENT_ID";
const reviewedClientSecretSecret = "VRDEX_MCP_OAUTH_CLIENT_SECRET";
const inspectorTokenSecret = "VRDEX_MCP_INSPECTOR_OAUTH_TOKEN";
const authHelpersVariable = "VRDEX_HOSTED_E2E_AUTH_HELPERS";
const developerCredentialsVariable = "VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS";
const browserTokenSecret = "VRDEX_HOSTED_E2E_BROWSER_TOKEN";

function nonEmpty(value: string | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function envFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  assert(value !== undefined && !value.startsWith("--"), `${name} requires a value.`);

  return value;
}

function ghCommandFromEnv(): GhCommand {
  const override = nonEmpty(process.env.VRDEX_HOSTED_MCP_OAUTH_PREREQS_GH_COMMAND);

  if (override === undefined) {
    return {
      argsPrefix: [],
      command: "gh",
    };
  }

  const parsed = JSON.parse(override) as unknown;

  assert.ok(Array.isArray(parsed), "VRDEX_HOSTED_MCP_OAUTH_PREREQS_GH_COMMAND must be a JSON string array.");
  assert.ok(parsed.length > 0, "VRDEX_HOSTED_MCP_OAUTH_PREREQS_GH_COMMAND must not be empty.");
  assert.ok(
    parsed.every((entry) => typeof entry === "string" && entry.trim()),
    "VRDEX_HOSTED_MCP_OAUTH_PREREQS_GH_COMMAND entries must be non-empty strings.",
  );

  return {
    argsPrefix: parsed.slice(1) as string[],
    command: parsed[0] as string,
  };
}

function defaultRepo() {
  return nonEmpty(process.env.VRDEX_GITHUB_REPOSITORY)
    ?? nonEmpty(process.env.GITHUB_REPOSITORY)
    ?? "BASIC-BIT/VRDex";
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    ghCommand: ghCommandFromEnv(),
    repo: defaultRepo(),
    requireReady: envFlag(process.env.VRDEX_HOSTED_MCP_OAUTH_PREREQS_REQUIRE_READY),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--repo":
        options.repo = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--require-ready":
        options.requireReady = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  assert.ok(nonEmpty(options.repo), "--repo must not be empty.");

  return options;
}

function runGhJson(options: Options, args: string[], label: string) {
  const result = spawnSync(options.ghCommand.command, [...options.ghCommand.argsPrefix, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error !== undefined || result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

    throw new Error(`${label} failed. ${output || String(result.error ?? "gh exited without output")}`);
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;

    assert.ok(Array.isArray(parsed), `${label} must return a JSON array.`);

    return parsed;
  } catch (error) {
    throw new Error(`${label} did not return parseable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function markdownCell(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .trim();
}

function enabledVariableSummary(variables: Map<string, string>, name: string) {
  if (!variables.has(name)) {
    return `${name}=missing`;
  }

  return envFlag(variables.get(name)) ? `${name}=true` : `${name}=present-not-enabled`;
}

function secretSummary(secrets: Set<string>, name: string) {
  return `${name}=${secrets.has(name) ? "present" : "missing"}`;
}

function statusForRequiredInputs(inputs: boolean[]) {
  if (inputs.every(Boolean)) {
    return "pass";
  }

  return inputs.some(Boolean) ? "partial" : "missing";
}

function buildRows(variables: Map<string, string>, secrets: Set<string>): AuditRow[] {
  const hasReviewedClientId = secrets.has(reviewedClientIdSecret);
  const hasReviewedClientSecret = secrets.has(reviewedClientSecretSecret);
  const hasInspectorToken = secrets.has(inspectorTokenSecret);
  const hasAuthHelpers = envFlag(variables.get(authHelpersVariable));
  const hasDeveloperCredentials = envFlag(variables.get(developerCredentialsVariable));
  const hasBrowserToken = secrets.has(browserTokenSecret);

  const reviewedClientStatus = statusForRequiredInputs([hasReviewedClientId, hasReviewedClientSecret]);
  const temporaryCredentialStatus = statusForRequiredInputs([
    hasAuthHelpers,
    hasDeveloperCredentials,
    hasBrowserToken,
  ]);
  const hostedOauthEvidenceReady = reviewedClientStatus === "pass" || temporaryCredentialStatus === "pass";
  const hostedOauthEvidencePartial =
    reviewedClientStatus === "partial"
    || temporaryCredentialStatus === "partial"
    || hasInspectorToken;

  return [
    {
      githubInputs: [
        secretSummary(secrets, reviewedClientIdSecret),
        secretSummary(secrets, reviewedClientSecretSecret),
      ].join("; "),
      name: "Reviewed OAuth client secrets",
      nextAction: reviewedClientStatus === "pass"
        ? "Run Claude Code and MCP Inspector hosted OAuth smokes with reviewed client credentials."
        : "Install both reviewed OAuth app client secrets, or use the temporary credential-generation path.",
      required: false,
      status: reviewedClientStatus,
    },
    {
      githubInputs: secretSummary(secrets, inspectorTokenSecret),
      name: "Inspector OAuth token fallback",
      nextAction: hasInspectorToken
        ? "Dispatch hosted-mcp-smoke with mcp_oauth=true for Inspector-only OAuth workflow evidence."
        : "Optional fallback only; prefer reviewed client credentials or temporary smoke credentials.",
      required: false,
      status: hasInspectorToken ? "pass" : "missing",
    },
    {
      githubInputs: [
        enabledVariableSummary(variables, authHelpersVariable),
        enabledVariableSummary(variables, developerCredentialsVariable),
        secretSummary(secrets, browserTokenSecret),
      ].join("; "),
      name: "Temporary OAuth credential generation",
      nextAction: temporaryCredentialStatus === "pass"
        ? "Dispatch deployed-health hosted-mcp-smoke with mcp_oauth=true so the workflow mints temporary smoke credentials."
        : `Configure ${authHelpersVariable}=true, ${developerCredentialsVariable}=true, and secret ${browserTokenSecret}.`,
      required: false,
      status: temporaryCredentialStatus,
    },
    {
      githubInputs: [
        reviewedClientStatus === "pass" ? "reviewed client credentials ready" : "reviewed client credentials not ready",
        temporaryCredentialStatus === "pass" ? "temporary credential generation ready" : "temporary credential generation not ready",
        hasInspectorToken ? "Inspector token fallback present" : "Inspector token fallback missing",
      ].join("; "),
      name: "Hosted MCP OAuth evidence path",
      nextAction: hostedOauthEvidenceReady
        ? "Run hosted OAuth workflow/client smokes, then record the remaining hosted-oauth matrix rows."
        : "Enable reviewed OAuth client secrets or the temporary credential-generation path before declaring hosted OAuth evidence ready.",
      required: true,
      status: hostedOauthEvidenceReady ? "pass" : hostedOauthEvidencePartial ? "partial" : "missing",
    },
  ];
}

function printRows(repo: string, rows: AuditRow[]) {
  console.log("# Hosted MCP OAuth GitHub Prerequisites");
  console.log("");
  console.log(`GitHub repository: ${repo}`);
  console.log("");
  console.log("This read-only audit reads GitHub Actions variable values for boolean gates and lists secret names. It never reads secret values.");
  console.log("");
  console.log("| Requirement | Required | Status | GitHub repo inputs | Next action |");
  console.log("| --- | --- | --- | --- | --- |");

  for (const row of rows) {
    console.log(
      `| ${[
        markdownCell(row.name),
        row.required ? "yes" : "no",
        row.status,
        markdownCell(row.githubInputs),
        markdownCell(row.nextAction),
      ].join(" | ")} |`,
    );
  }
}

function variablesFromJson(entries: unknown[]) {
  const variables = new Map<string, string>();

  for (const entry of entries as GitHubVariable[]) {
    if (typeof entry.name === "string") {
      variables.set(entry.name, typeof entry.value === "string" ? entry.value : "");
    }
  }

  return variables;
}

function secretsFromJson(entries: unknown[]) {
  const secrets = new Set<string>();

  for (const entry of entries as GitHubSecret[]) {
    if (typeof entry.name === "string") {
      secrets.add(entry.name);
    }
  }

  return secrets;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const variables = variablesFromJson(runGhJson(
    options,
    ["variable", "list", "--repo", options.repo, "--json", "name,value"],
    "GitHub variable list",
  ));
  const secrets = secretsFromJson(runGhJson(
    options,
    ["secret", "list", "--repo", options.repo, "--json", "name"],
    "GitHub secret list",
  ));
  const rows = buildRows(variables, secrets);
  const blockers = rows.filter((row) => row.required && row.status !== "pass");

  printRows(options.repo, rows);

  if (options.requireReady && blockers.length > 0) {
    throw new Error(`Hosted MCP OAuth GitHub prerequisites are not ready: ${blockers.map((row) => `${row.name}: ${row.status}`).join(", ")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
