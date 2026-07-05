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

  if (!url.pathname.endsWith("/mcp")) {
    url.pathname = `${trimTrailingSlashes(url.pathname)}/mcp`;
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

  const invalidBearer = await postMcpJsonRpc(
    url,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    },
    "Bearer not-a-jwt",
  );

  assert.equal(invalidBearer.status, 401);
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /resource_metadata=/);
  assert.match(invalidBearer.headers.get("www-authenticate") ?? "", /scope="mcp:read"/);

  const token = process.env.VRDEX_MCP_SMOKE_TOKEN?.trim();

  if (token) {
    const authenticated = await postMcpJsonRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {},
      },
      `Bearer ${token}`,
    );

    assert.equal(authenticated.status, 200);
    assert.match(JSON.stringify(await parseMcpHttpResponse(authenticated)), /"tools"/);
  }

  results.push({
    details: token ? "anonymous, OAuth challenge, and supplied bearer token passed" : "anonymous and OAuth challenge passed",
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
