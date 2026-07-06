import { spawnSync } from "node:child_process";

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
        evidence: "VS Code CLI exposes --add-mcp for safe profile-scoped MCP configuration",
        patterns: [/Model Context Protocol/i, /--add-mcp <json>/i],
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

function printResults(results: ClientResult[]) {
  console.log("# Installed MCP Client Preflight");
  console.log("");
  console.log("This read-only check inspects local CLI versions and MCP configuration support.");
  console.log("It does not write MCP config, launch GUI sessions, or replace manual matrix smokes.");
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
}

function main() {
  const results = clients.map(evaluateClient);
  const failures = results.filter((result) => result.status === "fail");

  printResults(results);

  if (failures.length > 0) {
    throw new Error(`Installed MCP client preflight failed: ${failures.map((failure) => failure.name).join(", ")}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
