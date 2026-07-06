import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { startVrdexMcpApiFixture } from "./api-fixture";

type JsonRpcMessage = {
  error?: unknown;
  id?: number | string | null;
  jsonrpc: "2.0";
  method?: string;
  params?: unknown;
  result?: unknown;
};

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

  const call = await waitForMessage(args.messages, args.onMessage, args.id, args.stderr);

  assert.equal(Boolean(call.error), false, `${args.name} returned a JSON-RPC error`);

  return call;
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
  const fixture = await startVrdexMcpApiFixture();
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

    const search = await callTool({
      id: 3,
      messages,
      name: "vrdex_search",
      onMessage,
      send,
      stderr,
      toolArgs: { limit: 2, query: "club", type: "event" },
    });

    assert.deepEqual((search.result as { structuredContent: unknown }).structuredContent, {
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
});
