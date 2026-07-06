import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";

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
  status: "pass" | "skip";
};

type HostedOAuthMetadata = {
  authorizationEndpoint: string;
  issuer: string;
  registrationEndpoint: string;
  resource: string;
};

const expectedTools = [
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
];

const localClientProfiles = [
  { name: "Claude Desktop", clientName: "claude-desktop" },
  { name: "Claude Code", clientName: "claude-code" },
  { name: "VS Code", clientName: "vscode" },
  { name: "Cursor", clientName: "cursor" },
  { name: "Devin Desktop / Windsurf Cascade", clientName: "devin-windsurf-cascade" },
  { name: "MCP Inspector", clientName: "mcp-inspector" },
];

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function handleFixtureRequest(request: IncomingMessage, response: ServerResponse, captured: string[]) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  captured.push(`${url.pathname}?${url.searchParams.toString()}`);

  writeJson(response, 200, {
    query: url.searchParams.get("q") ?? "",
    type: url.searchParams.get("type") ?? "all",
    results: [
      {
        entityType: "event",
        routePath: "/events/club-night",
        score: 1,
        slug: "club-night",
        title: "Club Night",
      },
    ],
  });
}

async function startFixtureServer() {
  const captured: string[] = [];
  const server = createServer((request, response) => handleFixtureRequest(request, response, captured));

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address !== null && typeof address === "object");

  return {
    captured,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    origin: `http://127.0.0.1:${address.port}`,
  };
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
  const fixture = await startFixtureServer();
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

    assert.deepEqual(toolNames, expectedTools);

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        arguments: { limit: 2, query: "club", type: "event" },
        name: "vrdex_search",
      },
    });

    const call = await waitForMessage(messages, onMessage, 3, stderr, profile.name);

    assert.equal(Boolean(call.error), false);
    assert.equal(fixture.captured.length, 1);

    const requestUrl = new URL(fixture.captured[0] ?? "", "http://127.0.0.1");

    assert.equal(requestUrl.pathname, "/api/v0/search");
    assert.equal(requestUrl.searchParams.get("q"), "club");
    assert.equal(requestUrl.searchParams.get("type"), "event");
    assert.equal(requestUrl.searchParams.get("limit"), "2");
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

function hostedSmokeUrl() {
  const rawUrl = process.env.VRDEX_MCP_SMOKE_URL?.trim();

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

function smokeDynamicRegistrationEnabled() {
  const value = process.env.VRDEX_MCP_SMOKE_DCR?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

function smokeClientMetadataDocumentEnabled() {
  const value = process.env.VRDEX_MCP_SMOKE_CIMD?.trim().toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

async function smokeHostedOAuthMetadata(url: URL, results: SmokeResult[]): Promise<HostedOAuthMetadata> {
  const protectedResourceUrl = urlForPath(url.origin, "/.well-known/oauth-protected-resource");
  const protectedResource = await fetch(protectedResourceUrl, { headers: { accept: "application/json" } });

  assert.equal(protectedResource.status, 200);

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

  assert.equal(authorizationServer.status, 200);

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

  return { authorizationEndpoint, issuer, registrationEndpoint, resource };
}

async function smokeHostedDynamicClientRegistration(metadata: HostedOAuthMetadata, results: SmokeResult[]) {
  if (!smokeDynamicRegistrationEnabled()) {
    results.push({
      details: "set VRDEX_MCP_SMOKE_DCR=1 to register a smoke public MCP client",
      name: "Hosted Dynamic Client Registration",
      status: "skip",
    });

    return;
  }

  const registration = await fetch(metadata.registrationEndpoint, {
    body: JSON.stringify({
      client_name: "VRDex MCP Smoke Client",
      contacts: ["mailto:smoke@example.invalid"],
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://localhost:8765/callback"],
      response_types: ["code"],
      scope: "mcp:read public:read",
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

  assert.equal(registration.status, 201);

  const body = await responseJson(registration, "Dynamic Client Registration");

  assert.match(stringField(body.client_id, "client id"), /^vrdx_app_[0-9a-f]{24}$/);
  assert.equal(stringField(body.resource, "registered resource"), metadata.resource);
  assert.equal(stringField(body.authorization_server, "authorization server"), metadata.issuer);
  assert.equal(stringField(body.token_endpoint_auth_method, "token endpoint auth method"), "none");
  assert.equal(stringField(body.scope, "registered scope").split(/\s+/).includes("mcp:read"), true);

  results.push({
    details: "public MCP client registration passed",
    name: "Hosted Dynamic Client Registration",
    status: "pass",
  });
}

async function smokeHostedClientMetadataDocument(metadata: HostedOAuthMetadata, results: SmokeResult[]) {
  if (!smokeClientMetadataDocumentEnabled()) {
    results.push({
      details: "set VRDEX_MCP_SMOKE_CIMD=1 to probe public-client Client ID Metadata Documents",
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

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientMetadataUrl);
  authorizationUrl.searchParams.set("redirect_uri", "http://localhost:8765/callback");
  authorizationUrl.searchParams.set("resource", metadata.resource);
  authorizationUrl.searchParams.set("scope", "mcp:read public:read");
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
    details: "URL-form public client id metadata was accepted before the expected sign-in redirect",
    name: "Hosted Client ID Metadata Document",
    status: "pass",
  });
}

async function smokeHostedHttp(results: SmokeResult[]) {
  const url = hostedSmokeUrl();

  if (url === undefined) {
    results.push({
      details: "set VRDEX_MCP_SMOKE_URL to test a deployed Streamable HTTP endpoint",
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

  assert.equal(initialized.status, 200);
  assert.match(JSON.stringify(await parseMcpHttpResponse(initialized)), /"name":"vrdex"/);

  const listed = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  assert.equal(listed.status, 200);
  const toolsBody = JSON.stringify(await parseMcpHttpResponse(listed));

  for (const toolName of expectedTools) {
    assert.match(toolsBody, new RegExp(`"name":"${toolName}"`));
  }

  const anonymousSearch = await postMcpJsonRpc(url, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      arguments: { limit: 1, query: "", type: "all" },
      name: "vrdex_search",
    },
  });

  assert.equal(anonymousSearch.status, 200);

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

  const invalidBearer = await postMcpJsonRpc(
    url,
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {},
    },
    "Bearer not-a-jwt",
  );

  assert.equal(invalidBearer.status, 401);
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /scope="mcp:read"/);

  const metadata = await smokeHostedOAuthMetadata(url, results);

  await smokeHostedDynamicClientRegistration(metadata, results);
  await smokeHostedClientMetadataDocument(metadata, results);

  const token = process.env.VRDEX_MCP_SMOKE_TOKEN?.trim();

  if (token) {
    const authenticated = await postMcpJsonRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: {},
      },
      `Bearer ${token}`,
    );

    assert.equal(authenticated.status, 200);
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
  const results: SmokeResult[] = [];

  for (const profile of localClientProfiles) {
    await smokeLocalStdioProfile(profile);
    results.push({
      details: "stdio initialize, tool list, and vrdex_search passed",
      name: `Local stdio MCP - ${profile.name}`,
      status: "pass",
    });
  }

  await smokeHostedHttp(results);

  console.log("| Smoke target | Status | Details |");
  console.log("| --- | --- | --- |");

  for (const result of results) {
    console.log(`| ${result.name} | ${result.status} | ${result.details} |`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
