import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  fetchMcpOAuthClientCredentialsToken,
  hasAnyMcpOAuthClientCredentials,
  mcpOAuthClientCredentialsFromEnv,
  mcpOAuthClientCredentialsFromOptions,
} from "./mcp-oauth-client-credentials";

type InspectorOptions = {
  hostedDataPublicReads: boolean;
  hostedOAuthClientId?: string;
  hostedOAuthClientSecret?: string;
  hostedOAuthToken?: string;
  hostedUrl?: string;
  inspectorCommand: string;
  search: {
    limit: number;
    query: string;
    type: "all" | "community" | "event" | "person" | "profile" | "world";
  };
};

type InspectorResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

type ToolDescriptor = {
  _meta?: {
    securitySchemes?: unknown;
  };
  name?: unknown;
};

type InspectorSearchResult = {
  query?: unknown;
  results?: unknown;
  type?: unknown;
};

const expectedPublicReadTools = [
  "search",
  "fetch",
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
];
// Registered unconditionally, so they appear in every hosted `tools/list`,
// including an anonymous one. They advertise a scope pair rather than the
// public-read schemes -- asserting the public pair against every listed tool
// had this smoke failing before it could collect any transport or OAuth
// evidence at all.
const expectedOwnedReadToolScopes: Record<string, string> = {
  vrdex_list_my_media_submissions: "assets:contribute",
  vrdex_list_my_profiles: "profile:read",
};
const expectedWriteToolScopes: Record<string, string> = {
  vrdex_event_create: "events:write",
  vrdex_event_update: "events:write",
  vrdex_profile_media_manage: "assets:write",
  vrdex_profile_media_submit: "assets:contribute",
  vrdex_profile_update: "profile:write",
  vrdex_profile_submit: "profile:contribute",
};
const expectedTools = [
  ...expectedPublicReadTools,
  ...Object.keys(expectedOwnedReadToolScopes),
  ...Object.keys(expectedWriteToolScopes),
];
const searchTypes = new Set<InspectorOptions["search"]["type"]>([
  "all",
  "community",
  "event",
  "person",
  "profile",
  "world",
]);

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

function parseSearchType(value: string | undefined): InspectorOptions["search"]["type"] {
  const normalized = nonEmpty(value) ?? "all";

  assert(
    searchTypes.has(normalized as InspectorOptions["search"]["type"]),
    `Search type must be one of ${[...searchTypes].join(", ")}.`,
  );

  return normalized as InspectorOptions["search"]["type"];
}

function parseLimit(value: string | undefined) {
  const normalized = nonEmpty(value) ?? "1";
  const parsed = Number.parseInt(normalized, 10);

  assert(Number.isSafeInteger(parsed), "Search limit must be an integer.");
  assert(parsed >= 1 && parsed <= 50, "Search limit must be between 1 and 50.");

  return parsed;
}

function parseArgs(argv: string[]): InspectorOptions {
  const oauthClientCredentials = mcpOAuthClientCredentialsFromEnv(process.env, "MCP_INSPECTOR");
  const options: InspectorOptions = {
    hostedDataPublicReads: envFlag("VRDEX_MCP_INSPECTOR_HOSTED_DATA"),
    hostedOAuthClientId: oauthClientCredentials.clientId,
    hostedOAuthClientSecret: oauthClientCredentials.clientSecret,
    hostedOAuthToken: nonEmpty(process.env.VRDEX_MCP_INSPECTOR_OAUTH_TOKEN),
    hostedUrl: nonEmpty(process.env.VRDEX_MCP_INSPECTOR_HOSTED_URL),
    inspectorCommand: nonEmpty(process.env.VRDEX_MCP_INSPECTOR_COMMAND)
      ?? (process.platform === "win32" ? "npx.cmd" : "npx"),
    search: {
      limit: parseLimit(process.env.VRDEX_MCP_INSPECTOR_LIMIT),
      query: process.env.VRDEX_MCP_INSPECTOR_QUERY?.trim() ?? "",
      type: parseSearchType(process.env.VRDEX_MCP_INSPECTOR_TYPE),
    },
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--hosted-data":
      case "--hosted-data-public-reads":
        options.hostedDataPublicReads = true;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg);
        index += 1;
        break;
      case "--inspector-command":
        options.inspectorCommand = takeValue(argv, index, arg);
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
      case "--limit":
        options.search.limit = parseLimit(takeValue(argv, index, arg));
        index += 1;
        break;
      case "--query":
        options.search.query = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--type":
        options.search.type = parseSearchType(takeValue(argv, index, arg));
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.hostedDataPublicReads && !options.search.query) {
    options.search.query = "club";
  }

  assert.ok(nonEmpty(options.hostedUrl), "--hosted-url or VRDEX_MCP_INSPECTOR_HOSTED_URL is required.");
  assert.notEqual(options.inspectorCommand.trim(), "", "--inspector-command must not be empty.");
  if (options.hostedDataPublicReads) {
    assert.notEqual(options.search.query, "", "--hosted-data requires a non-empty search query.");
  }

  return options;
}

function runInspector(options: InspectorOptions, args: string[]) {
  return new Promise<InspectorResult>((resolve, reject) => {
    const command = inspectorSpawn(options, args);
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${options.inspectorCommand} timed out after 120000ms.`));
    }, 120_000);
    const stderr: Buffer[] = [];
    const stdout: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

function redactSensitiveOutput(text: string, options: InspectorOptions) {
  let redacted = text.replace(/Authorization:\s*Bearer\s+[^\s"'\\]+/gi, "Authorization: Bearer [REDACTED]");

  if (options.hostedOAuthToken !== undefined) {
    redacted = redacted.replaceAll(options.hostedOAuthToken, "[REDACTED]");
  }
  if (options.hostedOAuthClientSecret !== undefined) {
    redacted = redacted.replaceAll(options.hostedOAuthClientSecret, "[REDACTED_CLIENT_SECRET]");
  }

  return redacted;
}

function parseInspectorJson<T>(result: InspectorResult, label: string, options: InspectorOptions) {
  assert.equal(
    result.code,
    0,
    redactSensitiveOutput(result.stderr, options) || `${label} exited with ${result.code}.`,
  );

  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`${label} did not return JSON: ${result.stdout.slice(0, 500)}`);
  }
}

function hostedInspectorArgs(hostedUrl: string, method: string) {
  return [
    "--yes",
    "@modelcontextprotocol/inspector",
    "--cli",
    hostedUrl,
    "--transport",
    "http",
    "--method",
    method,
  ];
}

function hostedInspectorArgsWithHeaders(hostedUrl: string, method: string, headers: string[] = []) {
  const args = hostedInspectorArgs(hostedUrl, method);

  for (const header of headers) {
    args.push("--header", header);
  }

  return args;
}

function inspectorSpawn(options: InspectorOptions, args: string[]) {
  if (process.platform !== "win32") {
    return { args, command: options.inspectorCommand };
  }

  return {
    args: ["/d", "/s", "/c", options.inspectorCommand, ...args],
    command: process.env.ComSpec ?? "cmd.exe",
  };
}

function assertPublicReadSecuritySchemes(tool: ToolDescriptor) {
  const writeScope = expectedWriteToolScopes[String(tool.name)];
  const ownedReadScope = expectedOwnedReadToolScopes[String(tool.name)];

  if (writeScope !== undefined) {
    assert.deepEqual(
      tool._meta?.securitySchemes,
      [{ scopes: ["mcp:write", writeScope], type: "oauth2" }],
      `Hosted Inspector tool ${String(tool.name)} is missing write auth metadata.`,
    );

    return;
  }

  if (ownedReadScope !== undefined) {
    assert.deepEqual(
      tool._meta?.securitySchemes,
      [{ scopes: ["mcp:read", ownedReadScope], type: "oauth2" }],
      `Hosted Inspector tool ${String(tool.name)} is missing owned-read auth metadata.`,
    );

    return;
  }

  assert.deepEqual(
    tool._meta?.securitySchemes,
    [
      { type: "noauth" },
      { scopes: ["mcp:read"], type: "oauth2" },
    ],
    `Hosted Inspector tool ${String(tool.name)} is missing public-read auth metadata.`,
  );
}

async function smokeHostedToolList(options: InspectorOptions) {
  const result = await runInspector(options, hostedInspectorArgsWithHeaders(options.hostedUrl!, "tools/list"));
  const body = parseInspectorJson<{ tools?: ToolDescriptor[] }>(result, "MCP Inspector tools/list", options);

  assertHostedTools(body, "MCP Inspector tools/list");
}

function assertHostedTools(body: { tools?: ToolDescriptor[] }, label: string) {
  assert.equal(Array.isArray(body.tools), true, `${label} did not return tools.`);
  const toolNames = (body.tools ?? []).map((tool) => tool.name);

  assertExpectedHostedToolNames(toolNames);
  for (const tool of body.tools ?? []) {
    assertPublicReadSecuritySchemes(tool);
  }
}

export function assertExpectedHostedToolNames(toolNames: unknown[]) {
  assert.deepEqual(
    [...toolNames].sort(),
    [...expectedTools].sort(),
    "Hosted MCP returned an unexpected tool set.",
  );
}

export function assertInspectorDataBackedSearch(
  structuredContent: InspectorSearchResult,
  search: InspectorOptions["search"],
) {
  assert.equal(structuredContent.query, search.query);
  assert.equal(structuredContent.type, search.type);
  assert.equal(Array.isArray(structuredContent.results), true);
  assert.ok(
    (structuredContent.results as unknown[]).length > 0,
    "MCP Inspector hosted data-backed vrdex_search returned no public results.",
  );
}

async function smokeHostedOAuthToolList(options: InspectorOptions) {
  const token = await hostedOAuthToken(options);

  if (token === undefined) {
    return "skip";
  }

  const result = await runInspector(
    options,
    hostedInspectorArgsWithHeaders(options.hostedUrl!, "tools/list", [
      `Authorization: Bearer ${token}`,
    ]),
  );
  const body = parseInspectorJson<{ tools?: ToolDescriptor[] }>(result, "MCP Inspector OAuth tools/list", options);

  assertHostedTools(body, "MCP Inspector OAuth tools/list");

  return "pass";
}

async function smokeHostedDataSearch(options: InspectorOptions) {
  if (!options.hostedDataPublicReads) {
    return "skip";
  }

  const result = await runInspector(options, [
    ...hostedInspectorArgs(options.hostedUrl!, "tools/call"),
    "--tool-name",
    "vrdex_search",
    "--tool-arg",
    `query=${options.search.query}`,
    `type=${options.search.type}`,
    `limit=${options.search.limit}`,
  ]);
  const body = parseInspectorJson<{
    content?: Array<{ text?: unknown; type?: unknown }>;
    isError?: unknown;
  }>(result, "MCP Inspector tools/call", options);

  assert.notEqual(body.isError, true, `MCP Inspector hosted vrdex_search returned a tool error: ${JSON.stringify(body)}`);

  const text = body.content?.find((entry) => entry.type === "text")?.text;

  assert.equal(typeof text, "string", "MCP Inspector hosted vrdex_search did not return text JSON.");

  const structuredContent = JSON.parse(text as string) as InspectorSearchResult;

  assertInspectorDataBackedSearch(structuredContent, options.search);

  return "pass";
}

async function hostedOAuthToken(options: InspectorOptions) {
  if (options.hostedOAuthToken !== undefined) {
    return options.hostedOAuthToken;
  }

  const credentials = mcpOAuthClientCredentialsFromOptions(options);

  if (!hasAnyMcpOAuthClientCredentials(credentials)) {
    return undefined;
  }

  const hostedUrl = options.hostedUrl;

  assert.ok(hostedUrl, "Hosted URL is required for OAuth client-credentials token acquisition.");
  const result = await fetchMcpOAuthClientCredentialsToken({
    ...credentials,
    hostedUrl,
  });

  options.hostedOAuthToken = result.accessToken;

  return result.accessToken;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  await smokeHostedToolList(options);
  const dataStatus = await smokeHostedDataSearch(options);
  const oauthStatus = await smokeHostedOAuthToolList(options);

  console.log("| Smoke target | Status | Details |");
  console.log("| --- | --- | --- |");
  console.log(
    `| MCP Inspector hosted tools/list | pass | listed sixteen hosted VRDex tools with per-tool auth metadata for ${options.hostedUrl} |`,
  );
  console.log(
    dataStatus === "pass"
      ? `| MCP Inspector hosted data-backed vrdex_search | pass | query=${JSON.stringify(options.search.query)}, type=${options.search.type}, limit=${options.search.limit} returned structured content |`
      : "| MCP Inspector hosted data-backed vrdex_search | skip | pass --hosted-data against a same-branch or production-like backend |",
  );
  console.log(
    oauthStatus === "pass"
      ? "| MCP Inspector hosted OAuth tools/list | pass | acquired or supplied MCP-resource OAuth token listed sixteen hosted VRDex tools without exposing the token or client secret |"
      : "| MCP Inspector hosted OAuth tools/list | skip | set VRDEX_MCP_OAUTH_CLIENT_ID / VRDEX_MCP_OAUTH_CLIENT_SECRET or VRDEX_MCP_INSPECTOR_OAUTH_TOKEN for hosted OAuth evidence |",
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
