import { spawnSync } from "node:child_process";

import {
  hostedMcpOAuthCredentialGenerationSourcesFromEnv,
  mcpOAuthCredentialSourcesFromEnv,
} from "./mcp-oauth-client-credentials";

type Probe = {
  args: string[];
  command: string;
  evidence: string;
  patterns: RegExp[];
};

type ClientProbe = {
  id: string;
  manualGap: string;
  name: string;
  optional?: boolean;
  probes: Probe[];
  version: Probe;
};

type ProbeResult = {
  evidence: string;
  missingPatterns: string[];
  status: "fail" | "pass" | "skip";
};

type ClientResult = {
  evidence: string[];
  id: string;
  manualGap: string;
  name: string;
  status: "fail" | "pass" | "skip";
  version: string;
};

type OAuthPrerequisite = {
  clientSpecificPrefix: string;
  matrixRow: string;
  smokeCommand: string;
  tokenEnvName: string;
};

type OAuthPrerequisiteResult = {
  credentialSource: string;
  matrixRow: string;
  nextAction: string;
  status: "missing" | "partial" | "pass";
};

type OAuthCredentialGenerationResult = {
  credentialSource: string;
  nextAction: string;
  path: string;
  status: "missing" | "partial" | "pass";
};

const clients: ClientProbe[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    manualGap: "Run real hosted-data and hosted-OAuth MCP sessions before recording hosted matrix rows.",
    version: {
      command: "claude",
      args: ["--version"],
      evidence: "installed Claude Code CLI version",
      patterns: [/Claude Code/i],
    },
    probes: [
      {
        command: "claude",
        args: ["mcp", "--help"],
        evidence: "claude mcp command group is available",
        patterns: [/Configure and manage MCP servers/i, /\badd\b/i],
      },
      {
        command: "claude",
        args: ["mcp", "add", "--help"],
        evidence: "Claude Code supports stdio, HTTP, OAuth client id, and callback-port setup",
        patterns: [/--transport <transport>/i, /\bstdio\b/i, /\bhttp\b/i, /--client-id/i, /--callback-port/i],
      },
    ],
  },
  {
    id: "vscode",
    name: "VS Code",
    manualGap: "Use the installed app to list tools and call vrdex_search before recording manual rows.",
    version: {
      command: "code",
      args: ["--version"],
      evidence: "installed VS Code CLI version",
      patterns: [/^\d+\.\d+\.\d+/m],
    },
    probes: [
      {
        command: "code",
        args: ["--help"],
        evidence: "VS Code CLI exposes --add-mcp for isolated user-data MCP configuration",
        patterns: [/Model Context Protocol/i, /--add-mcp <json>/i],
      },
    ],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    manualGap: "Use Gemini CLI settings.json and an interactive /mcp session to list tools and call vrdex_search before recording manual rows.",
    version: {
      command: "gemini",
      args: ["--version"],
      evidence: "installed Gemini CLI version",
      patterns: [/.+/],
    },
    probes: [
      {
        command: "gemini",
        args: ["--help"],
        evidence: "Gemini CLI command is available; MCP smoke depends on settings.json plus interactive /mcp evidence",
        patterns: [/.+/],
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    manualGap: "Use the installed app or Cursor agent surface to list tools and call vrdex_search before recording manual rows.",
    version: {
      command: "cursor",
      args: ["--version"],
      evidence: "installed Cursor CLI version",
      patterns: [/^\d+\.\d+\.\d+/m],
    },
    probes: [
      {
        command: "cursor",
        args: ["--help"],
        evidence: "Cursor CLI exposes --add-mcp for MCP server configuration",
        patterns: [/--add-mcp <json>/i, /Model Context Protocol/i],
      },
    ],
  },
  {
    id: "windsurf",
    name: "Windsurf",
    manualGap: "Use the installed app to list tools and call vrdex_search before recording Windsurf rows.",
    version: {
      command: "windsurf",
      args: ["--version"],
      evidence: "installed Windsurf CLI version",
      patterns: [/^\d+\.\d+\.\d+/m],
    },
    probes: [
      {
        command: "windsurf",
        args: ["--help"],
        evidence: "Windsurf CLI exposes --add-mcp for MCP server configuration",
        patterns: [/Model Context Protocol/i, /--add-mcp <json>/i],
      },
    ],
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    manualGap: "Desktop app smoke remains manual; verify tools/list and vrdex_search in the current Custom Connector or local config path.",
    optional: true,
    version: {
      command: "claude-desktop",
      args: ["--version"],
      evidence: "Claude Desktop CLI is not expected on Windows",
      patterns: [/Claude/i],
    },
    probes: [],
  },
  {
    id: "openai-chatgpt",
    name: "OpenAI and ChatGPT MCP-capable surfaces",
    manualGap: "Connector behavior must be verified in the relevant hosted OpenAI or ChatGPT product surface.",
    optional: true,
    version: {
      command: "openai",
      args: ["--version"],
      evidence: "OpenAI hosted MCP surfaces do not have a required local CLI for this matrix",
      patterns: [/openai/i],
    },
    probes: [],
  },
];

const oauthPrerequisites: OAuthPrerequisite[] = [
  {
    clientSpecificPrefix: "CLAUDE_CODE",
    matrixRow: "claude-code/hosted-oauth",
    smokeCommand: "pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url <target-/mcp-url> --hosted-data",
    tokenEnvName: "VRDEX_CLAUDE_CODE_OAUTH_TOKEN",
  },
  {
    clientSpecificPrefix: "MCP_INSPECTOR",
    matrixRow: "mcp-inspector/hosted-oauth",
    smokeCommand: "pnpm smoke:mcp-inspector -- --hosted-url <target-/mcp-url> --hosted-data",
    tokenEnvName: "VRDEX_MCP_INSPECTOR_OAUTH_TOKEN",
  },
];

function commandLine(probe: Probe) {
  return [probe.command, ...probe.args].join(" ");
}

function runProbe(probe: Probe): { output: string; status: "found" | "missing" } {
  const result = spawnSync(commandLine(probe), {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  if (result.error !== undefined || result.status === 127 || output.includes("not recognized")) {
    return { output, status: "missing" };
  }

  return { output, status: "found" };
}

function evaluateProbe(probe: Probe): ProbeResult {
  const result = runProbe(probe);

  if (result.status === "missing") {
    return {
      evidence: `${commandLine(probe)} is not available`,
      missingPatterns: [],
      status: "skip",
    };
  }

  const missingPatterns = probe.patterns
    .filter((pattern) => !pattern.test(result.output))
    .map((pattern) => pattern.source);

  return {
    evidence: missingPatterns.length === 0
      ? probe.evidence
      : `${probe.evidence}; missing ${missingPatterns.join(", ")}`,
    missingPatterns,
    status: missingPatterns.length === 0 ? "pass" : "fail",
  };
}

function versionString(probe: Probe) {
  const result = runProbe(probe);

  if (result.status === "missing") {
    return "not installed or not on PATH";
  }

  return result.output.split(/\r?\n/)[0]?.trim() || "installed";
}

function evaluateClient(client: ClientProbe): ClientResult {
  const version = versionString(client.version);

  if (version === "not installed or not on PATH") {
    return {
      evidence: [client.optional === true ? "optional local surface not found" : "command not found on PATH"],
      id: client.id,
      manualGap: client.manualGap,
      name: client.name,
      status: "skip",
      version,
    };
  }

  if (client.optional === true && client.probes.length === 0) {
    return {
      evidence: ["local CLI is not used as readiness evidence for this hosted/manual-only surface"],
      id: client.id,
      manualGap: client.manualGap,
      name: client.name,
      status: "skip",
      version,
    };
  }

  const probeResults = client.probes.map(evaluateProbe);
  const failed = probeResults.filter((probe) => probe.status === "fail");

  return {
    evidence: probeResults.length === 0
      ? ["installed; no safe headless MCP configuration probe is defined"]
      : probeResults.map((probe) => probe.evidence),
    id: client.id,
    manualGap: client.manualGap,
    name: client.name,
    status: failed.length === 0 ? "pass" : "fail",
    version,
  };
}

function markdownCell(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .trim();
}

function evaluateOAuthPrerequisite(prerequisite: OAuthPrerequisite): OAuthPrerequisiteResult {
  const sources = mcpOAuthCredentialSourcesFromEnv(
    process.env,
    prerequisite.clientSpecificPrefix,
    prerequisite.tokenEnvName,
  );
  const credentialSource = [
    sources.hasCompleteClientCredentials
      ? `client credentials from ${sources.clientIdSource} + ${sources.clientSecretSource}`
      : undefined,
    sources.hasToken ? `token from ${sources.tokenSource}` : undefined,
    sources.hasPartialClientCredentials
      ? `partial client credentials from ${[sources.clientIdSource, sources.clientSecretSource].filter(Boolean).join(" + ")}`
      : undefined,
  ].filter(Boolean).join("; ") || "none";

  if (sources.hasPartialClientCredentials && !sources.hasCompleteClientCredentials && !sources.hasToken) {
    return {
      credentialSource,
      matrixRow: prerequisite.matrixRow,
      nextAction: "Set both client id and client secret, or clear the partial variable before running the OAuth smoke.",
      status: "partial",
    };
  }

  if (sources.hasCompleteClientCredentials || sources.hasToken) {
    return {
      credentialSource,
      matrixRow: prerequisite.matrixRow,
      nextAction: prerequisite.smokeCommand,
      status: "pass",
    };
  }

  return {
    credentialSource,
    matrixRow: prerequisite.matrixRow,
    nextAction: `Set VRDEX_MCP_OAUTH_CLIENT_ID + VRDEX_MCP_OAUTH_CLIENT_SECRET, or set ${prerequisite.tokenEnvName}, then run ${prerequisite.smokeCommand}.`,
    status: "missing",
  };
}

function evaluateOAuthCredentialGeneration(): OAuthCredentialGenerationResult {
  const sources = hostedMcpOAuthCredentialGenerationSourcesFromEnv(process.env);
  const credentialSource = [
    sources.hasAuthHelpers ? `auth helpers from ${sources.authHelpersSource}` : undefined,
    sources.hasDeveloperCredentials ? `developer credentials from ${sources.developerCredentialsSource}` : undefined,
    sources.hasBrowserToken ? `browser token from ${sources.browserTokenSource}` : undefined,
  ].filter(Boolean).join("; ") || "none";

  if (sources.canGenerateCredentials) {
    return {
      credentialSource,
      nextAction: "Dispatch deployed-health hosted-mcp-smoke with mcp_oauth=true; the workflow can mint temporary MCP OAuth smoke credentials.",
      path: "GitHub hosted-mcp-smoke temporary OAuth credentials",
      status: "pass",
    };
  }

  const nextAction = "Configure VRDEX_HOSTED_E2E_AUTH_HELPERS=true, VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true, and secret VRDEX_HOSTED_E2E_BROWSER_TOKEN, or use reviewed OAuth smoke client credentials.";

  return {
    credentialSource,
    nextAction,
    path: "GitHub hosted-mcp-smoke temporary OAuth credentials",
    status: sources.hasAnyInput ? "partial" : "missing",
  };
}

function printResults(
  results: ClientResult[],
  oauthResults: OAuthPrerequisiteResult[],
  oauthGenerationResults: OAuthCredentialGenerationResult[],
) {
  console.log("# Installed MCP Client Preflight");
  console.log("");
  console.log("This read-only check inspects local CLI versions and MCP configuration support.");
  console.log("It does not write MCP config, launch GUI sessions, print secrets, or replace manual matrix smokes.");
  console.log("");
  console.log("| Client | Status | Version | CLI evidence | Remaining manual gap |");
  console.log("| --- | --- | --- | --- | --- |");

  for (const result of results) {
    console.log(
      `| ${[
        markdownCell(result.name),
        result.status,
        markdownCell(result.version),
        markdownCell(result.evidence.join("; ")),
        markdownCell(result.manualGap),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("## Hosted OAuth Evidence Prerequisites");
  console.log("");
  console.log("| Matrix row | Status | Credential source | Next action |");
  console.log("| --- | --- | --- | --- |");

  for (const result of oauthResults) {
    console.log(
      `| ${[
        markdownCell(result.matrixRow),
        result.status,
        markdownCell(result.credentialSource),
        markdownCell(result.nextAction),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("## Hosted OAuth Credential Generation");
  console.log("");
  console.log("| Path | Status | Credential source | Next action |");
  console.log("| --- | --- | --- | --- |");

  for (const result of oauthGenerationResults) {
    console.log(
      `| ${[
        markdownCell(result.path),
        result.status,
        markdownCell(result.credentialSource),
        markdownCell(result.nextAction),
      ].join(" | ")} |`,
    );
  }
}

function main() {
  const results = clients.map(evaluateClient);
  const oauthResults = oauthPrerequisites.map(evaluateOAuthPrerequisite);
  const oauthGenerationResults = [evaluateOAuthCredentialGeneration()];
  const failures = [
    ...results.filter((result) => result.status === "fail").map((result) => result.name),
    ...oauthResults.filter((result) => result.status === "partial").map((result) => result.matrixRow),
  ];

  printResults(results, oauthResults, oauthGenerationResults);

  if (failures.length > 0) {
    throw new Error(`Installed MCP client preflight failed: ${failures.join(", ")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
