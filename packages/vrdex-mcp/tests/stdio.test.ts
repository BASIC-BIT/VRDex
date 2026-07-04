import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

type JsonRpcMessage = {
  error?: unknown;
  id?: number | string | null;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

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

function waitForMessage(
  messages: JsonRpcMessage[],
  onMessage: (listener: () => void) => void,
  id: number,
  stderr: string[],
) {
  return new Promise<JsonRpcMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for JSON-RPC response ${id}. stderr: ${stderr.join("")}`));
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

function pnpmExecCommand(repoRoot: string) {
  const args = ["--silent", "--dir", repoRoot, "exec", "tsx", "packages/vrdex-mcp/src/stdio.ts"];

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

test("serves VRDex tools over stdio and calls the configured API base URL", async () => {
  const fixture = await startFixtureServer();
  const messages: JsonRpcMessage[] = [];
  const stderr: string[] = [];
  const messageListeners = new Set<() => void>();
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const command = pnpmExecCommand(repoRoot);
  const child = spawn(command.command, command.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      VRDEX_API_BASE_URL: fixture.origin,
      VRDEX_API_TOKEN: "vrdx_stdio_token",
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
        clientInfo: { name: "vrdex-mcp-test", version: "0.0.0" },
        protocolVersion: "2025-06-18",
      },
    });

    const initialized = await waitForMessage(messages, onMessage, 1, stderr);

    assert.equal(Boolean(initialized.error), false);

    send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const tools = await waitForMessage(messages, onMessage, 2, stderr);
    assert.deepEqual(
      ((tools.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name),
      [
        "vrdex_search",
        "vrdex_get_profile",
        "vrdex_get_event",
        "vrdex_list_upcoming_events",
        "vrdex_get_world",
        "vrdex_list_active_worlds",
      ],
    );

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        arguments: { limit: 2, query: "club", type: "event" },
        name: "vrdex_search",
      },
    });

    const call = await waitForMessage(messages, onMessage, 3, stderr);

    assert.equal(Boolean(call.error), false);
    assert.deepEqual((call.result as { structuredContent: unknown }).structuredContent, {
      query: "club",
      type: "event",
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
});
