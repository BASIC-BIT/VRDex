import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import { startVrdexMcpApiFixture } from "../packages/vrdex-mcp/tests/api-fixture";
import { summarizeMcpToolFailure } from "./lib/mcp-smoke-diagnostics";

type JsonRpcMessage = {
  error?: unknown;
  id?: number | string | null;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

type SmokeResult = {
  details: string;
  name: string;
  status: "fail" | "pass" | "skip";
};

type HostedOAuthMetadata = {
  authorizationEndpoint: string;
  issuer: string;
  registrationEndpoint: string;
  resource: string;
  scopes: string[];
};

type SmokeOptions = {
  clientMetadataDocument: boolean;
  continueOnFailure: boolean;
  dynamicRegistration: boolean;
  hostedOnly: boolean;
  hostedDataPublicReads: boolean;
  hostedSearchQuery: string;
  hostedUrl?: string;
};

type HostedToolDescriptor = {
  _meta?: unknown;
  name?: unknown;
};

const localReadTools = [
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
];
const writeToolResourceScopes: Record<string, string> = {
  vrdex_event_create: "events:write",
  vrdex_event_update: "events:write",
  vrdex_profile_update: "profile:write",
  vrdex_profile_submit: "profile:contribute",
};
const writeToolNames = Object.keys(writeToolResourceScopes);
// Reads, but of the caller's own inventory, so they advertise a scope pair the
// way the writes do rather than the anonymous public-read pair.
const ownedReadToolScopes: Record<string, string> = {
  vrdex_list_my_profiles: "profile:read",
};
const ownedReadToolNames = Object.keys(ownedReadToolScopes);
const localExpectedTools = [...localReadTools, ...ownedReadToolNames, ...writeToolNames];
const hostedExpectedTools = ["search", "fetch", ...localReadTools];

function assertHostedToolSecuritySchemes(tool: HostedToolDescriptor) {
  assert.equal(typeof tool._meta, "object", `Hosted tool ${String(tool.name)} is missing _meta.`);
  assert.notEqual(tool._meta, null, `Hosted tool ${String(tool.name)} is missing _meta.`);

  const metadata = tool._meta as {
    securitySchemes?: unknown;
  };

  const resourceScope = writeToolResourceScopes[String(tool.name)];
  const ownedReadScope = ownedReadToolScopes[String(tool.name)];

  if (resourceScope !== undefined) {
    assert.deepEqual(
      metadata.securitySchemes,
      [{ scopes: ["mcp:write", resourceScope], type: "oauth2" }],
      `Hosted tool ${String(tool.name)} is missing write auth metadata.`,
    );
  } else if (ownedReadScope !== undefined) {
    assert.deepEqual(
      metadata.securitySchemes,
      [{ scopes: ["mcp:read", ownedReadScope], type: "oauth2" }],
      `Hosted tool ${String(tool.name)} is missing owned-read auth metadata.`,
    );
  } else {
    assert.deepEqual(
      metadata.securitySchemes,
      [
        { type: "noauth" },
        { scopes: ["mcp:read"], type: "oauth2" },
      ],
      `Hosted tool ${String(tool.name)} is missing public-read auth metadata.`,
    );
  }
}

const localClientProfiles = [
  { name: "Claude Desktop", clientName: "claude-desktop" },
  { name: "Claude Code", clientName: "claude-code" },
  { name: "Gemini CLI", clientName: "gemini-cli" },
  { name: "VS Code", clientName: "vscode" },
  { name: "Cursor", clientName: "cursor" },
  { name: "Devin Desktop / Windsurf Cascade", clientName: "devin-windsurf-cascade" },
  { name: "MCP Inspector", clientName: "mcp-inspector" },
];

function envFlag(name: string) {
  const value = process.env[name]?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function takeValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function markdownCell(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("|", "\\|")
    .trim();
}

function parseArgs(argv: string[]): SmokeOptions {
  const options: SmokeOptions = {
    clientMetadataDocument: envFlag("VRDEX_MCP_SMOKE_CIMD"),
    continueOnFailure: envFlag("VRDEX_MCP_SMOKE_CONTINUE_ON_FAILURE"),
    dynamicRegistration: envFlag("VRDEX_MCP_SMOKE_DCR"),
    hostedOnly: envFlag("VRDEX_MCP_SMOKE_HOSTED_ONLY"),
    hostedDataPublicReads: envFlag("VRDEX_MCP_SMOKE_DATA"),
    hostedSearchQuery: process.env.VRDEX_MCP_SMOKE_QUERY?.trim() || "club",
  };

  const hostedUrl = process.env.VRDEX_MCP_SMOKE_URL?.trim();

  if (hostedUrl) {
    options.hostedUrl = hostedUrl;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--cimd":
      case "--client-metadata-document":
        options.clientMetadataDocument = true;
        break;
      case "--dcr":
      case "--dynamic-client-registration":
        options.dynamicRegistration = true;
        break;
      case "--continue-on-failure":
        options.continueOnFailure = true;
        break;
      case "--hosted-url":
        options.hostedUrl = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--hosted-data":
      case "--hosted-data-public-reads":
        options.hostedDataPublicReads = true;
        break;
      case "--hosted-query":
        options.hostedSearchQuery = takeValue(argv, index, arg).trim();
        index += 1;
        break;
      case "--hosted-only":
        options.hostedOnly = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function callTool(args: {
  id: number;
  messages: JsonRpcMessage[];
  name: string;
  onMessage: (listener: () => void) => void;
  send: (message: JsonRpcMessage) => void;
  stderr: string[];
  toolArgs: Record<string, unknown>;
}) {
  args.send({
    jsonrpc: "2.0",
    id: args.id,
    method: "tools/call",
    params: {
      arguments: args.toolArgs,
      name: args.name,
    },
  });

  const call = await waitForMessage(args.messages, args.onMessage, args.id, args.stderr, args.name);

  assert.equal(Boolean(call.error), false, `${args.name} returned a JSON-RPC error`);

  return call;
}

function pnpmExecCommand() {
  const args = ["--silent", "exec", "tsx", "packages/vrdex-mcp/src/stdio.ts"];

  if (process.env.npm_execpath !== undefined) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  }

  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
  };
}

function waitForMessage(
  messages: JsonRpcMessage[],
  onMessage: (listener: () => void) => void,
  id: number,
  stderr: string[],
  label: string,
) {
  return new Promise<JsonRpcMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label} JSON-RPC response ${id}. stderr: ${stderr.join("")}`));
    }, 10_000);

    function check() {
      const message = messages.find((item) => item.id === id);

      if (message !== undefined) {
        clearTimeout(timeout);
        resolve(message);
      }
    }

    onMessage(check);
    check();
  });
}

async function smokeLocalStdioProfile(profile: (typeof localClientProfiles)[number]) {
  const fixture = await startVrdexMcpApiFixture();
  const messages: JsonRpcMessage[] = [];
  const stderr: string[] = [];
  const messageListeners = new Set<() => void>();
  const command = pnpmExecCommand();
  const child = spawn(command.command, command.args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VRDEX_API_BASE_URL: fixture.origin,
      VRDEX_API_TOKEN: "vrdx_mcp_smoke_token",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });

  function onMessage(listener: () => void) {
    messageListeners.add(listener);
  }

  function send(message: JsonRpcMessage) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  lines.on("line", (line) => {
    messages.push(JSON.parse(line) as JsonRpcMessage);

    for (const listener of messageListeners) {
      listener();
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf8"));
  });

  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: profile.clientName, version: "smoke" },
        protocolVersion: "2025-06-18",
      },
    });

    const initialized = await waitForMessage(messages, onMessage, 1, stderr, profile.name);

    assert.equal(Boolean(initialized.error), false);

    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const tools = await waitForMessage(messages, onMessage, 2, stderr, profile.name);
    const toolNames = ((tools.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);

    assert.deepEqual(toolNames, localExpectedTools);

    await callTool({
      id: 3,
      messages,
      name: "vrdex_search",
      onMessage,
      send,
      stderr,
      toolArgs: { limit: 2, query: "club", type: "event" },
    });
    await callTool({
      id: 4,
      messages,
      name: "vrdex_get_profile",
      onMessage,
      send,
      stderr,
      toolArgs: { profileType: "community", slug: "basic-bit" },
    });
    await callTool({
      id: 5,
      messages,
      name: "vrdex_get_event",
      onMessage,
      send,
      stderr,
      toolArgs: { slug: "club-night" },
    });
    await callTool({
      id: 6,
      messages,
      name: "vrdex_list_upcoming_events",
      onMessage,
      send,
      stderr,
      toolArgs: { limit: 1 },
    });
    await callTool({
      id: 7,
      messages,
      name: "vrdex_get_world",
      onMessage,
      send,
      stderr,
      toolArgs: { slug: "club-world" },
    });
    await callTool({
      id: 8,
      messages,
      name: "vrdex_list_active_worlds",
      onMessage,
      send,
      stderr,
      toolArgs: { limit: 1 },
    });

    assert.equal(fixture.captured.length, 6);
    assert.deepEqual(
      fixture.captured.map((request) => request.pathname),
      [
        "/api/v0/search",
        "/api/v0/communities/basic-bit",
        "/api/v0/events/club-night",
        "/api/v0/events/upcoming",
        "/api/v0/worlds/club-world",
        "/api/v0/worlds/active",
      ],
    );
    assert.equal(fixture.captured[0]?.searchParams.get("q"), "club");
    assert.equal(fixture.captured[0]?.searchParams.get("type"), "event");
    assert.equal(fixture.captured[0]?.searchParams.get("limit"), "2");
    assert.equal(fixture.captured[3]?.searchParams.get("limit"), "1");
    assert.equal(fixture.captured[5]?.searchParams.get("limit"), "1");
  } finally {
    child.stdin.end();
    child.kill();
    lines.close();
    await fixture.close();
  }
}

async function parseMcpHttpResponse(response: Response) {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as unknown;
  }

  const dataLine = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));

  return dataLine === undefined ? undefined : (JSON.parse(dataLine.slice("data:".length).trim()) as unknown);
}

function hostedSmokeUrl(options: SmokeOptions) {
  const rawUrl = options.hostedUrl;

  if (!rawUrl) {
    return undefined;
  }

  const url = new URL(rawUrl);
  const pathname = trimTrailingSlashes(url.pathname);

  if (!pathname.endsWith("/mcp")) {
    url.pathname = `${pathname}/mcp`;
  } else {
    url.pathname = pathname;
  }

  return url;
}

function trimTrailingSlashes(value: string) {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return value.slice(0, end);
}

async function postMcpJsonRpc(url: URL, body: JsonRpcMessage, authorization?: string) {
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      ...(authorization === undefined ? {} : { authorization }),
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response, label: string) {
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 300)}`);
  }
}

async function assertHttpStatus(response: Response, expectedStatus: number, label: string) {
  if (response.status === expectedStatus) {
    return;
  }

  const text = await response.text();
  const body = text.trim() ? text.slice(0, 500) : "<empty body>";

  throw new Error(`${label} expected HTTP ${expectedStatus}, got HTTP ${response.status}: ${body}`);
}

function urlForPath(origin: string, pathname: string) {
  const url = new URL(origin);

  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  return url;
}

function stringField(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} must be a string`);

  return value as string;
}

function stringArrayField(value: unknown, label: string): string[] {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);

  return (value as unknown[]).map((item, index) => stringField(item, `${label}[${index}]`));
}

function failureDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return summarizeMcpToolFailure({ error: message });
}

function assertMcpToolSuccess(
  payload: {
    error?: unknown;
    result?: {
      isError?: unknown;
    };
  },
  label: string,
) {
  assert.equal(
    payload.error,
    undefined,
    `${label} returned a JSON-RPC error: ${summarizeMcpToolFailure(payload)}`,
  );
  assert.notEqual(
    payload.result?.isError,
    true,
    `${label} returned a tool error: ${summarizeMcpToolFailure(payload)}`,
  );
}

function assertNonEmptyResults(results: unknown, label: string) {
  assert.equal(Array.isArray(results), true, `${label} did not return a results array.`);
  assert.ok((results as unknown[]).length > 0, `${label} returned no public results.`);

  return results as unknown[];
}

async function runHostedDiagnosticStep(
  results: SmokeResult[],
  options: SmokeOptions,
  name: string,
  step: () => Promise<void>,
) {
  if (!options.continueOnFailure) {
    await step();
    return;
  }

  try {
    await step();
  } catch (error: unknown) {
    results.push({
      details: failureDetails(error),
      name,
      status: "fail",
    });
  }
}

async function smokeHostedOAuthMetadata(url: URL, results: SmokeResult[]): Promise<HostedOAuthMetadata> {
  const protectedResourceUrl = urlForPath(url.origin, "/.well-known/oauth-protected-resource/mcp");
  const protectedResource = await fetch(protectedResourceUrl, { headers: { accept: "application/json" } });

  await assertHttpStatus(protectedResource, 200, "OAuth protected-resource metadata");

  const protectedResourceBody = await responseJson(protectedResource, "OAuth protected-resource metadata");
  const resource = stringField(protectedResourceBody.resource, "protected resource");
  const authorizationServers = stringArrayField(
    protectedResourceBody.authorization_servers,
    "authorization servers",
  );
  const scopes = stringArrayField(protectedResourceBody.scopes_supported, "protected resource scopes");

  assert.equal(resource, url.toString());
  assert.equal(scopes.includes("mcp:read"), true);

  const issuer = authorizationServers[0];

  assert.notEqual(issuer, undefined);

  const authorizationServerUrl = urlForPath(issuer, "/.well-known/oauth-authorization-server");
  const authorizationServer = await fetch(authorizationServerUrl, { headers: { accept: "application/json" } });

  await assertHttpStatus(authorizationServer, 200, "OAuth authorization-server metadata");

  const authorizationServerBody = await responseJson(authorizationServer, "OAuth authorization-server metadata");
  const authorizationEndpoint = stringField(
    authorizationServerBody.authorization_endpoint,
    "authorization endpoint",
  );
  const registrationEndpoint = stringField(
    authorizationServerBody.registration_endpoint,
    "registration endpoint",
  );
  const protectedResources = stringArrayField(
    authorizationServerBody.protected_resources,
    "authorization-server protected resources",
  );

  assert.equal(stringField(authorizationServerBody.issuer, "issuer"), issuer);
  assert.equal(authorizationEndpoint, `${issuer}/oauth/authorize`);
  assert.equal(authorizationServerBody.client_id_metadata_document_supported, true);
  assert.equal(protectedResources.includes(resource), true);

  results.push({
    details: "protected-resource and authorization-server metadata passed",
    name: "Hosted OAuth metadata",
    status: "pass",
  });

  return { authorizationEndpoint, issuer, registrationEndpoint, resource, scopes };
}

function requestedHostedOAuthScopes(metadata: HostedOAuthMetadata) {
  // Every resource scope the deployment advertises, not a hardcoded pair. A
  // registration that asked only for `events:write` would pass while
  // `profile:write` was rejected, leaving the profile tools unreachable for
  // discovered clients and the smoke none the wiser.
  const resourceWrites = [...new Set(Object.values(writeToolResourceScopes))]
    .filter((scope) => metadata.scopes.includes(scope));

  return [
    "mcp:read",
    "public:read",
    // Same reasoning one scope down: without it a discovered client lists the
    // owned-inventory tool and is refused by it, which is the shape that leaves
    // an owner unable to read the revision their own update has to pin.
    ...(metadata.scopes.includes("profile:read") ? ["profile:read"] : []),
    ...(metadata.scopes.includes("mcp:write") && resourceWrites.length > 0
      ? ["mcp:write", ...resourceWrites]
      : []),
  ];
}

async function smokeHostedDynamicClientRegistration(
  metadata: HostedOAuthMetadata,
  options: SmokeOptions,
  results: SmokeResult[],
) {
  if (!options.dynamicRegistration) {
    results.push({
      details: "pass --dcr or set VRDEX_MCP_SMOKE_DCR=1 to register a smoke public MCP client",
      name: "Hosted Dynamic Client Registration",
      status: "skip",
    });

    return;
  }

  const requestedScopes = requestedHostedOAuthScopes(metadata);
  const registration = await fetch(metadata.registrationEndpoint, {
    body: JSON.stringify({
      client_name: "VRDex MCP Smoke Client",
      contacts: ["mailto:smoke@example.invalid"],
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://localhost:8765/callback"],
      response_types: ["code"],
      scope: requestedScopes.join(" "),
      software_id: "vrdex-mcp-compat-smoke",
      software_version: "0.0.0",
      token_endpoint_auth_method: "none",
    }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });

  await assertHttpStatus(registration, 201, "Dynamic Client Registration");

  const body = await responseJson(registration, "Dynamic Client Registration");

  assert.match(stringField(body.client_id, "client id"), /^vrdx_app_[0-9a-f]{24}$/);
  assert.equal(stringField(body.resource, "registered resource"), metadata.resource);
  assert.equal(stringField(body.authorization_server, "authorization server"), metadata.issuer);
  assert.equal(stringField(body.token_endpoint_auth_method, "token endpoint auth method"), "none");
  const registeredScopes = stringField(body.scope, "registered scope").split(/\s+/);

  for (const requestedScope of requestedScopes) {
    assert.equal(registeredScopes.includes(requestedScope), true);
  }

  results.push({
    details: `public MCP client registration passed for scopes=${requestedScopes.join(" ")}`,
    name: "Hosted Dynamic Client Registration",
    status: "pass",
  });
}

async function smokeHostedClientMetadataDocument(
  metadata: HostedOAuthMetadata,
  options: SmokeOptions,
  results: SmokeResult[],
) {
  if (!options.clientMetadataDocument) {
    results.push({
      details: "pass --cimd or set VRDEX_MCP_SMOKE_CIMD=1 to probe public-client Client ID Metadata Documents",
      name: "Hosted Client ID Metadata Document",
      status: "skip",
    });

    return;
  }

  if (new URL(metadata.issuer).protocol !== "https:") {
    results.push({
      details: "Client ID Metadata Document client ids require HTTPS issuer URLs",
      name: "Hosted Client ID Metadata Document",
      status: "skip",
    });

    return;
  }

  const clientMetadataUrl = urlForPath(
    metadata.issuer,
    "/.well-known/oauth-client/vrdex-mcp-public-client",
  ).toString();
  const authorizationUrl = new URL(metadata.authorizationEndpoint);
  const requestedScopes = requestedHostedOAuthScopes(metadata);

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientMetadataUrl);
  authorizationUrl.searchParams.set("redirect_uri", "http://localhost:8765/callback");
  authorizationUrl.searchParams.set("resource", metadata.resource);
  authorizationUrl.searchParams.set("scope", requestedScopes.join(" "));
  authorizationUrl.searchParams.set("code_challenge", "a".repeat(43));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("state", "vrdex-cimd-smoke");

  const authorization = await fetch(authorizationUrl, {
    headers: { accept: "text/html" },
    redirect: "manual",
  });

  assert.equal(
    authorization.status >= 300 && authorization.status < 400,
    true,
    `Client ID Metadata Document authorization expected a redirect, got HTTP ${authorization.status}: ${(await authorization.text()).slice(0, 300)}`,
  );

  const location = authorization.headers.get("location") ?? "";

  assert.match(location, /\/sign-in\?/);
  assert.match(decodeURIComponent(location), /\/oauth\/authorize\?/);

  results.push({
    details: `URL-form public client id metadata was accepted for scopes=${requestedScopes.join(" ")} before the expected sign-in redirect`,
    name: "Hosted Client ID Metadata Document",
    status: "pass",
  });
}

async function smokeHostedDataBackedPublicRead(url: URL, options: SmokeOptions, results: SmokeResult[]) {
  if (!options.hostedDataPublicReads) {
    results.push({
      details: "pass --hosted-data or set VRDEX_MCP_SMOKE_DATA=1 to exercise non-empty search against a production-like Convex backend",
      name: "Hosted data-backed public read tool call",
      status: "skip",
    });

    return;
  }

  assert.notEqual(options.hostedSearchQuery, "", "--hosted-data requires a non-empty hosted search query.");

  const dataBackedSearch = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      arguments: { limit: 1, query: options.hostedSearchQuery, type: "all" },
      name: "vrdex_search",
    },
  });

  await assertHttpStatus(dataBackedSearch, 200, "Hosted data-backed vrdex_search");

  const dataSearchBody = (await parseMcpHttpResponse(dataBackedSearch)) as {
    error?: unknown;
    result?: {
      isError?: unknown;
      structuredContent?: {
        query?: unknown;
        results?: unknown;
        type?: unknown;
      };
    };
  };

  assertMcpToolSuccess(dataSearchBody, "Hosted data-backed vrdex_search");
  assert.equal(dataSearchBody.result?.structuredContent?.query, options.hostedSearchQuery);
  assert.equal(dataSearchBody.result?.structuredContent?.type, "all");
  assertNonEmptyResults(dataSearchBody.result?.structuredContent?.results, "Hosted data-backed vrdex_search");

  results.push({
    details: `anonymous vrdex_search returned at least one public result for query=${JSON.stringify(options.hostedSearchQuery)}`,
    name: "Hosted data-backed public read tool call",
    status: "pass",
  });
}

async function smokeHostedOpenAiCompatibleSearchFetch(url: URL, options: SmokeOptions, results: SmokeResult[]) {
  if (!options.hostedDataPublicReads) {
    results.push({
      details: "pass --hosted-data or set VRDEX_MCP_SMOKE_DATA=1 to require data-backed search plus fetch aliases",
      name: "Hosted OpenAI-compatible search/fetch",
      status: "skip",
    });

    return;
  }

  assert.notEqual(options.hostedSearchQuery, "", "--hosted-data requires a non-empty hosted search query.");

  const search = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      arguments: { query: options.hostedSearchQuery },
      name: "search",
    },
  });

  await assertHttpStatus(search, 200, "Hosted OpenAI-compatible search");

  const searchBody = (await parseMcpHttpResponse(search)) as {
    error?: unknown;
    result?: {
      isError?: unknown;
      structuredContent?: {
        results?: unknown;
      };
    };
  };

  assertMcpToolSuccess(searchBody, "Hosted OpenAI-compatible search");

  const searchResults = assertNonEmptyResults(
    searchBody.result?.structuredContent?.results,
    "Hosted OpenAI-compatible search",
  );
  const firstResult = searchResults[0] as { id?: unknown };

  if (typeof firstResult.id !== "string") {
    assert.fail("Hosted OpenAI-compatible search first result did not include an id.");
  }

  const firstResultId = firstResult.id;

  const fetchResult = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      arguments: { id: firstResultId },
      name: "fetch",
    },
  });

  await assertHttpStatus(fetchResult, 200, "Hosted OpenAI-compatible fetch");

  const fetchBody = (await parseMcpHttpResponse(fetchResult)) as {
    error?: unknown;
    result?: {
      isError?: unknown;
      structuredContent?: {
        text?: unknown;
      };
    };
  };

  assertMcpToolSuccess(fetchBody, "Hosted OpenAI-compatible fetch");
  const fetchText = fetchBody.result?.structuredContent?.text;

  if (typeof fetchText !== "string") {
    assert.fail("Hosted OpenAI-compatible fetch did not return document text.");
  }

  assert.notEqual(fetchText.trim(), "");

  results.push({
    details: `search returned id=${firstResultId} and fetch returned non-empty document text for query=${JSON.stringify(options.hostedSearchQuery)}`,
    name: "Hosted OpenAI-compatible search/fetch",
    status: "pass",
  });
}

async function smokeHostedHttp(results: SmokeResult[], options: SmokeOptions) {
  const url = hostedSmokeUrl(options);

  if (url === undefined) {
    results.push({
      details: "pass --hosted-url or set VRDEX_MCP_SMOKE_URL to test a deployed Streamable HTTP endpoint",
      name: "Hosted Streamable HTTP MCP",
      status: "skip",
    });

    return;
  }

  const initialized = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "vrdex-mcp-hosted-smoke", version: "0.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

  await assertHttpStatus(initialized, 200, "Hosted initialize");
  assert.match(JSON.stringify(await parseMcpHttpResponse(initialized)), /"name":"vrdex"/);

  const listed = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  await assertHttpStatus(listed, 200, "Hosted tools/list");
  const toolsResponse = (await parseMcpHttpResponse(listed)) as {
    result?: {
      tools?: HostedToolDescriptor[];
    };
  };
  const listedTools = toolsResponse.result?.tools;

  assert.equal(Array.isArray(listedTools), true, "Hosted tools/list did not return a tools array.");

  const toolsBody = JSON.stringify(toolsResponse);

  for (const toolName of hostedExpectedTools) {
    assert.match(toolsBody, new RegExp(`"name":"${toolName}"`));
  }

  for (const tool of listedTools ?? []) {
    assertHostedToolSecuritySchemes(tool);
  }

  const listedToolNames = new Set((listedTools ?? []).map((tool) => String(tool.name)));
  // Asserted, not merely observed. Reading this as a flag meant a deployment
  // that failed to register one write tool made the flag false, skipped every
  // scope assertion below, and passed: the read-only `hostedExpectedTools`
  // list was the only thing actually required.
  for (const toolName of writeToolNames) {
    assert.equal(
      listedToolNames.has(toolName),
      true,
      `Hosted MCP did not list the ${toolName} write tool.`,
    );
  }

  // Same rule for the owned-inventory reads. Without one of these an owner
  // cannot read the revision every update has to pin, so a deployment missing
  // it can still write nothing.
  for (const toolName of ownedReadToolNames) {
    assert.equal(
      listedToolNames.has(toolName),
      true,
      `Hosted MCP did not list the ${toolName} owned-read tool.`,
    );
  }
  const writeToolsListed = true;

  const anonymousSearch = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      arguments: { limit: 1, query: "", type: "all" },
      name: "vrdex_search",
    },
  });

  await assertHttpStatus(anonymousSearch, 200, "Hosted anonymous vrdex_search");

  const searchBody = (await parseMcpHttpResponse(anonymousSearch)) as {
    error?: unknown;
    result?: {
      structuredContent?: {
        query?: unknown;
        results?: unknown;
        type?: unknown;
      };
    };
  };

  assert.equal(searchBody.error, undefined);
  assert.equal(searchBody.result?.structuredContent?.query, "");
  assert.equal(searchBody.result?.structuredContent?.type, "all");
  assert.equal(Array.isArray(searchBody.result?.structuredContent?.results), true);

  results.push({
    details: "anonymous vrdex_search invocation returned structured public-read content",
    name: "Hosted anonymous read tool call",
    status: "pass",
  });

  await runHostedDiagnosticStep(results, options, "Hosted data-backed public read tool call", () =>
    smokeHostedDataBackedPublicRead(url, options, results),
  );
  await runHostedDiagnosticStep(results, options, "Hosted OpenAI-compatible search/fetch", () =>
    smokeHostedOpenAiCompatibleSearchFetch(url, options, results),
  );

  const invalidBearer = await postMcpJsonRpc(
    url,
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/list",
      params: {},
    },
    "Bearer not-a-jwt",
  );

  await assertHttpStatus(invalidBearer, 401, "Hosted invalid bearer challenge");
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /scope="mcp:read"/);

  const metadata = await smokeHostedOAuthMetadata(url, results);

  if (writeToolsListed) {
    assert.equal(metadata.scopes.includes("mcp:write"), true);

    // Every resource scope a listed write tool needs. Asserting only the event
    // pair let a deployment advertise the profile tools while omitting
    // `profile:write` from its protected-resource metadata, which is exactly
    // the shape that leaves a discovered client unable to call them.
    for (const toolName of writeToolNames) {
      const resourceScope = writeToolResourceScopes[toolName];

      assert.equal(
        metadata.scopes.includes(resourceScope),
        true,
        `Hosted protected-resource metadata omits ${resourceScope}, required by ${toolName}.`,
      );
    }
  }

  await runHostedDiagnosticStep(results, options, "Hosted Dynamic Client Registration", () =>
    smokeHostedDynamicClientRegistration(metadata, options, results),
  );
  await runHostedDiagnosticStep(results, options, "Hosted Client ID Metadata Document", () =>
    smokeHostedClientMetadataDocument(metadata, options, results),
  );

  const token = process.env.VRDEX_MCP_SMOKE_TOKEN?.trim();

  if (token) {
    const authenticated = await postMcpJsonRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/list",
        params: {},
      },
      `Bearer ${token}`,
    );

    await assertHttpStatus(authenticated, 200, "Hosted authenticated tools/list");
    assert.match(JSON.stringify(await parseMcpHttpResponse(authenticated)), /"tools"/);
  }

  results.push({
    details: token
      ? "anonymous, read tool, OAuth challenge, and supplied bearer token passed"
      : "anonymous, read tool, and OAuth challenge passed",
    name: "Hosted Streamable HTTP MCP",
    status: "pass",
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results: SmokeResult[] = [];

  if (!options.hostedOnly) {
    for (const profile of localClientProfiles) {
      await smokeLocalStdioProfile(profile);
      results.push({
        details: "stdio initialize, tool list, and all curated read tool calls passed",
        name: `Local stdio MCP - ${profile.name}`,
        status: "pass",
      });
    }
  }

  await smokeHostedHttp(results, options);

  console.log("| Smoke target | Status | Details |");
  console.log("| --- | --- | --- |");

  for (const result of results) {
    console.log(`| ${markdownCell(result.name)} | ${result.status} | ${markdownCell(result.details)} |`);
  }

  const failed = results.filter((result) => result.status === "fail");
  if (failed.length > 0) {
    throw new Error(`Hosted MCP smoke failed: ${failed.map((result) => result.name).join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
