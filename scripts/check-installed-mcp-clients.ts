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

type AutomationSurfaceResult = {
  client: string;
  evidence: string;
  nextAction: string;
  status: "manual_only" | "not_available";
  surface: string;
};

type SurfacePreconditionResult = {
  client: string;
  evidence: string;
  nextAction: string;
  status: "missing" | "pass" | "skip";
  surface: string;
};

type ProviderCredentialResult = {
  credentialSource: string;
  nextAction: string;
  path: string;
  status: "missing" | "partial" | "pass";
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
    manualGap: "Run pnpm smoke:mcp-gemini-cli with Google auth, or use Gemini CLI settings.json and an interactive /mcp session before recording rows. If Gemini CLI is not installed, the smoke supports --gemini-package @google/gemini-cli@latest.",
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
        evidence: "Gemini CLI command is available; MCP smoke can run through pnpm smoke:mcp-gemini-cli or interactive /mcp evidence",
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
  {
    clientSpecificPrefix: "GEMINI_CLI",
    matrixRow: "gemini-cli/hosted-oauth",
    smokeCommand: "pnpm smoke:mcp-gemini-cli -- --mode hosted-http --hosted-url <target-/mcp-url> --hosted-data",
    tokenEnvName: "VRDEX_GEMINI_CLI_OAUTH_TOKEN",
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

function envPresent(name: string) {
  return Boolean(process.env[name]?.trim());
}

function envPresenceSummary(names: string[]) {
  return names.map((name) => `${name}=${envPresent(name) ? "present" : "missing"}`).join("; ");
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
      path: "Current process temporary OAuth credential generation inputs",
      status: "pass",
    };
  }

  const nextAction = "Configure VRDEX_HOSTED_E2E_AUTH_HELPERS=true, VRDEX_HOSTED_E2E_DEVELOPER_CREDENTIALS=true, and secret VRDEX_HOSTED_E2E_BROWSER_TOKEN, or use reviewed OAuth smoke client credentials.";

  return {
    credentialSource,
    nextAction,
    path: "Current process temporary OAuth credential generation inputs",
    status: sources.hasAnyInput ? "partial" : "missing",
  };
}

function runPowerShell(script: string) {
  if (process.platform !== "win32") {
    return "";
  }

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });

  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}

function evaluateClaudeDesktopSurface(): SurfacePreconditionResult {
  if (process.platform !== "win32") {
    return {
      client: "Claude Desktop",
      evidence: "desktop app process/path detection is implemented for Windows only",
      nextAction: "Verify Claude Desktop manually on this OS before recording matrix evidence.",
      status: "skip",
      surface: "desktop app availability",
    };
  }

  const processNames = runPowerShell(
    "Get-Process | Where-Object { $_.ProcessName -match 'Claude' } | Select-Object -First 5 -ExpandProperty ProcessName",
  ).split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) => candidate.toLowerCase() === entry.toLowerCase()) === index,
    );
  const appPath = runPowerShell(
    "$paths = @(" +
      "$env:LOCALAPPDATA + '\\Programs\\Claude\\Claude.exe'," +
      "$env:LOCALAPPDATA + '\\Claude\\Claude.exe'," +
      "$env:ProgramFiles + '\\Claude\\Claude.exe'," +
      "${env:ProgramFiles(x86)} + '\\Claude\\Claude.exe'" +
      "); $paths | Where-Object { Test-Path $_ } | Select-Object -First 1",
  ).split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);

  if (processNames.length > 0) {
    return {
      client: "Claude Desktop",
      evidence: `running process detected: ${processNames.join(", ")}`,
      nextAction: "Use the running desktop app or current Custom Connector path to capture tools/list plus vrdex_search evidence.",
      status: "pass",
      surface: "desktop app availability",
    };
  }

  if (appPath !== undefined) {
    return {
      client: "Claude Desktop",
      evidence: "common Windows install path detected",
      nextAction: "Launch Claude Desktop and capture tools/list plus vrdex_search evidence.",
      status: "pass",
      surface: "desktop app availability",
    };
  }

  return {
    client: "Claude Desktop",
    evidence: "no Claude Desktop process or common Windows install path detected",
    nextAction: "Install or launch Claude Desktop, or use its current Custom Connector surface before recording matrix evidence.",
    status: "missing",
    surface: "desktop app availability",
  };
}

function evaluateSurfacePreconditions(): SurfacePreconditionResult[] {
  return [evaluateClaudeDesktopSurface()];
}

function evaluateProviderCredentials(): ProviderCredentialResult[] {
  const openAiKeyEnvName = process.env.VRDEX_OPENAI_MCP_API_KEY_ENV?.trim() || "OPENAI_API_KEY";
  const hasOpenAiKey = envPresent(openAiKeyEnvName);
  const hasGeminiApiKey = envPresent("GEMINI_API_KEY");
  const hasVertexProject = envPresent("GOOGLE_CLOUD_PROJECT");
  const hasVertexLocation = envPresent("GOOGLE_CLOUD_LOCATION");
  const usesVertex = /^(1|true|yes)$/i.test(process.env.GOOGLE_GENAI_USE_VERTEXAI?.trim() ?? "");
  const geminiStatus = hasGeminiApiKey || (usesVertex && hasVertexProject && hasVertexLocation)
    ? "pass"
    : usesVertex || hasVertexProject || hasVertexLocation
      ? "partial"
      : "missing";

  return [
    {
      credentialSource: `${openAiKeyEnvName}=${hasOpenAiKey ? "present" : "missing"}`,
      nextAction: hasOpenAiKey
        ? "Run pnpm smoke:mcp-openai -- --hosted-url <target-/mcp-url> --hosted-data against a target that exposes search and fetch."
        : `Set ${openAiKeyEnvName}, then run pnpm smoke:mcp-openai -- --hosted-url <target-/mcp-url> --hosted-data against a target that exposes search and fetch.`,
      path: "OpenAI Responses API remote MCP",
      status: hasOpenAiKey ? "pass" : "missing",
    },
    {
      credentialSource: envPresenceSummary(["GEMINI_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"]),
      nextAction: geminiStatus === "pass"
        ? "Run pnpm smoke:mcp-gemini-cli with --gemini-package @google/gemini-cli@latest if Gemini CLI is not installed."
        : "Set GEMINI_API_KEY, or configure complete Vertex AI Gemini CLI auth inputs, before running pnpm smoke:mcp-gemini-cli.",
      path: "Gemini CLI model authentication",
      status: geminiStatus,
    },
  ];
}

function runAutomationProbe(command: string, args: string[]) {
  const result = runProbe({
    args,
    command,
    evidence: `${[command, ...args].join(" ")} output`,
    patterns: [],
  });

  return result.output;
}

function evaluateAutomationSurfaces(): AutomationSurfaceResult[] {
  const vscodeChatHelp = runAutomationProbe("code", ["chat", "--help"]);
  const vscodeIsolatedChatHelp = runAutomationProbe(
    "code",
    ["--user-data-dir", ".tmp-gh-artifacts/mcp-client-cli-probe/vscode-chat", "chat", "--help"],
  );
  const cursorAgentHelp = runAutomationProbe("cursor", ["agent", "--help"]);
  const cursorChatHelp = runAutomationProbe("cursor", ["--chat", "--help"]);
  const windsurfHelp = runAutomationProbe("windsurf", ["--help"]);

  return [
    {
      client: "VS Code",
      evidence: /Usage:\s+code(?:\.exe)?\s+chat/i.test(vscodeChatHelp)
        ? "code chat is available with prompt and mode options, but help exposes no stdout transcript or tool-call export option"
        : "code chat help was not available on PATH",
      nextAction: "Use app-visible screenshot or transcript evidence after the real chat session lists tools and calls vrdex_search.",
      status: /Usage:\s+code(?:\.exe)?\s+chat/i.test(vscodeChatHelp) ? "manual_only" : "not_available",
      surface: "chat subcommand",
    },
    {
      client: "VS Code",
      evidence: /user-data-dir.+not in the list of known options for subcommand 'chat'/i.test(vscodeIsolatedChatHelp)
        ? "code chat currently warns that --user-data-dir is not a known chat option, so isolated add-mcp profiles are setup aids rather than headless chat evidence"
        : "code chat did not report the current isolated user-data warning; verify isolation manually before relying on this launch path",
      nextAction: "Keep recording VS Code rows from the real app session, not from CLI handoff success.",
      status: "manual_only",
      surface: "isolated chat handoff",
    },
    {
      client: "Cursor",
      evidence: /Usage:\s+cursor(?:\.exe)?\s+\[options\]/i.test(cursorAgentHelp)
        ? "cursor agent is advertised, but current help falls back to generic Cursor CLI help rather than a transcript-producing MCP smoke command"
        : "cursor agent help shape changed; inspect manually before treating it as an automation path",
      nextAction: "Use installed app or agent-surface screenshot/transcript evidence after the real session lists tools and calls vrdex_search.",
      status: "manual_only",
      surface: "agent subcommand",
    },
    {
      client: "Cursor",
      evidence: /--chat/i.test(cursorChatHelp)
        ? "cursor --chat opens the standalone chat surface, but help exposes no stdout transcript or tool-call export option"
        : "cursor --chat help was not available on PATH",
      nextAction: "Use app-visible evidence for Cursor rows; do not record CLI launch success as a pass.",
      status: /--chat/i.test(cursorChatHelp) ? "manual_only" : "not_available",
      surface: "standalone chat flag",
    },
    {
      client: "Windsurf",
      evidence: /--add-mcp/i.test(windsurfHelp) && !/\b(chat|agent)\b/i.test(windsurfHelp)
        ? "windsurf help exposes --add-mcp but no chat or agent subcommand for transcript-producing CLI smoke evidence"
        : "windsurf help shape changed; inspect manually before treating it as an automation path",
      nextAction: "Use installed app screenshot/transcript evidence after the real session lists tools and calls vrdex_search.",
      status: /--add-mcp/i.test(windsurfHelp) ? "manual_only" : "not_available",
      surface: "chat or agent CLI",
    },
  ];
}

function printResults(
  results: ClientResult[],
  automationResults: AutomationSurfaceResult[],
  surfaceResults: SurfacePreconditionResult[],
  providerCredentialResults: ProviderCredentialResult[],
  oauthResults: OAuthPrerequisiteResult[],
  oauthGenerationResults: OAuthCredentialGenerationResult[],
) {
  console.log("# Installed MCP Client Preflight");
  console.log("");
  console.log("This read-only check inspects local CLI versions and MCP configuration support.");
  console.log("It does not write MCP config, launch GUI sessions, print secrets, or replace manual matrix smokes.");
  console.log("The CLI automation surface notes are informational and are not readiness evidence.");
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
  console.log("## CLI Automation Surface Notes");
  console.log("");
  console.log("| Client | Surface | Status | Evidence | Next action |");
  console.log("| --- | --- | --- | --- | --- |");

  for (const result of automationResults) {
    console.log(
      `| ${[
        markdownCell(result.client),
        markdownCell(result.surface),
        result.status,
        markdownCell(result.evidence),
        markdownCell(result.nextAction),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("## Desktop And Hosted Product Preconditions");
  console.log("");
  console.log("These checks are setup signals only. They do not list MCP tools or replace manual matrix evidence.");
  console.log("");
  console.log("| Client | Surface | Status | Evidence | Next action |");
  console.log("| --- | --- | --- | --- | --- |");

  for (const result of surfaceResults) {
    console.log(
      `| ${[
        markdownCell(result.client),
        markdownCell(result.surface),
        result.status,
        markdownCell(result.evidence),
        markdownCell(result.nextAction),
      ].join(" | ")} |`,
    );
  }

  console.log("");
  console.log("## Model Provider Credential Preconditions");
  console.log("");
  console.log("This section reports only whether required environment variables are present. It does not print secret values.");
  console.log("");
  console.log("| Path | Status | Credential source | Next action |");
  console.log("| --- | --- | --- | --- |");

  for (const result of providerCredentialResults) {
    console.log(
      `| ${[
        markdownCell(result.path),
        result.status,
        markdownCell(result.credentialSource),
        markdownCell(result.nextAction),
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
  console.log("This section reads only the current process environment. Run pnpm ops:mcp-hosted-oauth-prereqs for the GitHub repository variable/secret audit.");
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
  const automationResults = evaluateAutomationSurfaces();
  const surfaceResults = evaluateSurfacePreconditions();
  const providerCredentialResults = evaluateProviderCredentials();
  const oauthResults = oauthPrerequisites.map(evaluateOAuthPrerequisite);
  const oauthGenerationResults = [evaluateOAuthCredentialGeneration()];
  const failures = [
    ...results.filter((result) => result.status === "fail").map((result) => result.name),
    ...oauthResults.filter((result) => result.status === "partial").map((result) => result.matrixRow),
  ];

  printResults(results, automationResults, surfaceResults, providerCredentialResults, oauthResults, oauthGenerationResults);

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
