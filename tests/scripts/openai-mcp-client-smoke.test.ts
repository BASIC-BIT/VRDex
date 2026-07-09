import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

function runOpenAiSmoke(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/smoke-openai-mcp-client.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        OPENAI_API_KEY: "",
        ...env,
      },
      timeout: 20_000,
    },
  );
}

function runOpenAiSmokeAsync(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/smoke-openai-mcp-client.ts", "--", ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("OpenAI MCP smoke child process timed out."));
    }, 20_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({
        status,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { connection: "close", "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function startHostedMcpFixture(options: {
  searchToolError?: boolean;
  tools?: string[];
} = {}) {
  const tools = options.tools ?? ["search", "fetch", "vrdex_search"];
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp" || request.method !== "POST") {
      response.writeHead(404, { connection: "close" });
      response.end("Not found");
      return;
    }

    const body = JSON.parse(await readRequestBody(request)) as {
      id?: number;
      method?: string;
      params?: {
        name?: string;
      };
    };

    if (body.method === "initialize") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: { protocolVersion: "2025-06-18", serverInfo: { name: "vrdex" } },
      });
      return;
    }

    if (body.method === "tools/list") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: { tools: tools.map((name) => ({ name })) },
      });
      return;
    }

    if (body.method === "tools/call" && body.params?.name === "search") {
      if (options.searchToolError) {
        writeJson(response, 200, {
          id: body.id,
          jsonrpc: "2.0",
          result: {
            content: [{ text: "Search backend unavailable", type: "text" }],
            isError: true,
          },
        });
        return;
      }

      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          structuredContent: {
            results: [
              {
                id: "event:club-night",
                title: "Club Night",
                url: "https://staging.vrdex.net/e/club-night",
              },
            ],
          },
        },
      });
      return;
    }

    if (body.method === "tools/call" && body.params?.name === "fetch") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          structuredContent: {
            id: "event:club-night",
            metadata: { entityType: "event", slug: "club-night" },
            text: "Title: Club Night\nEntity type: event",
            title: "Club Night",
            url: "https://staging.vrdex.net/e/club-night",
          },
        },
      });
      return;
    }

    writeJson(response, 400, { error: "unsupported_method" });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();

  assert.equal(typeof address, "object");
  assert.notEqual(address, null);

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://127.0.0.1:${address.port}/mcp`,
  };
}

describe("OpenAI Responses API MCP smoke harness", () => {
  it("fails closed when no OpenAI API key is available", () => {
    const result = runOpenAiSmoke([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--hosted-data",
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /OPENAI_API_KEY is required/);
    assert.doesNotMatch(result.stderr, /Bearer /);
  });

  it("accepts a fixture-backed MCP tool call response for tests", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-openai-mcp-test-"));
    const fixturePath = path.join(tempDir, "responses.json");

    try {
      writeFileSync(
        fixturePath,
        JSON.stringify({
          output: [
            {
              arguments: JSON.stringify({ query: "club" }),
              name: "search",
              output: JSON.stringify({
                results: [{ id: "event:club-night", title: "Club Night", url: "https://staging.vrdex.net/e/club-night" }],
              }),
              type: "mcp_call",
            },
            {
              arguments: JSON.stringify({ id: "event:club-night" }),
              name: "fetch",
              output: JSON.stringify({
                id: "event:club-night",
                metadata: { entityType: "event", slug: "club-night" },
                text: "Title: Club Night\\nEntity type: event",
                title: "Club Night",
                url: "https://staging.vrdex.net/e/club-night",
              }),
              type: "mcp_call",
            },
            {
              content: [{ text: "openai-mcp-ok", type: "output_text" }],
              role: "assistant",
              type: "message",
            },
          ],
          output_text: "openai-mcp-ok",
        }),
        "utf8",
      );

      const result = runOpenAiSmoke([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--hosted-data",
        "--fixture",
        fixturePath,
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /OpenAI Responses API hosted anonymous MCP \| pass/);
      assert.match(result.stdout, /ChatGPT app hosted MCP \| skip/);
      assert.match(result.stdout, /query="club", type=all, limit=1/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("reports assertion failures without a process abort", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "vrdex-openai-mcp-test-"));
    const fixturePath = path.join(tempDir, "responses.json");

    try {
      writeFileSync(
        fixturePath,
        JSON.stringify({
          output: [
            {
              content: [{ text: "not-ok", type: "output_text" }],
              role: "assistant",
              type: "message",
            },
          ],
        }),
        "utf8",
      );

      const result = runOpenAiSmoke([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--hosted-data",
        "--fixture",
        fixturePath,
      ]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /OpenAI response did not include a search MCP tool call/);
      assert.doesNotMatch(result.stderr, /Assertion failed/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it("uses gpt-5.6-luna as the default live smoke model", async () => {
    const mcpFixture = await startHostedMcpFixture();
    let requestBody: Record<string, unknown> | undefined;
    const server = createServer(async (request, response) => {
      requestBody = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
      writeJson(response, 200, {
        output: [
          {
            arguments: JSON.stringify({ query: "club" }),
            name: "search",
            output: JSON.stringify({
              results: [{ id: "event:club-night", title: "Club Night", url: "https://staging.vrdex.net/e/club-night" }],
            }),
            type: "mcp_call",
          },
          {
            arguments: JSON.stringify({ id: "event:club-night" }),
            name: "fetch",
            output: JSON.stringify({
              id: "event:club-night",
              metadata: { entityType: "event", slug: "club-night" },
              text: "Title: Club Night\\nEntity type: event",
              title: "Club Night",
              url: "https://staging.vrdex.net/e/club-night",
            }),
            type: "mcp_call",
          },
          {
            content: [{ text: "openai-mcp-ok", type: "output_text" }],
            role: "assistant",
            type: "message",
          },
        ],
        output_text: "openai-mcp-ok",
      });
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();

      assert.ok(address !== null && typeof address === "object");

      const result = await runOpenAiSmokeAsync(
        [
          "--hosted-url",
          mcpFixture.url,
          "--hosted-data",
          "--endpoint",
          `http://127.0.0.1:${address.port}/v1/responses`,
        ],
        { OPENAI_API_KEY: "test-key" },
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(requestBody?.model, "gpt-5.6-luna");
      assert.match(result.stdout, /gpt-5\.6-luna called search and fetch/);
    } finally {
      await mcpFixture.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fails bounded live requests with a clear timeout message", async () => {
    const mcpFixture = await startHostedMcpFixture();
    const server = createServer((_request, _response) => {
      // Hold the socket open so the child process must rely on its request timeout.
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();

      assert.ok(address !== null && typeof address === "object");

      const result = await runOpenAiSmokeAsync(
        [
          "--hosted-url",
          mcpFixture.url,
          "--hosted-data",
          "--endpoint",
          `http://127.0.0.1:${address.port}/v1/responses`,
          "--request-timeout-ms",
          "1000",
        ],
        {
          OPENAI_API_KEY: "test-key",
        },
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /timed out after 1000ms/);
      assert.doesNotMatch(result.stderr, /test-key/);
      assert.doesNotMatch(result.stderr, /Bearer /);
    } finally {
      await mcpFixture.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fails before calling OpenAI when hosted search and fetch tools are missing", async () => {
    const mcpFixture = await startHostedMcpFixture({ tools: ["vrdex_search"] });
    let openAiRequests = 0;
    const server = createServer((_request, response) => {
      openAiRequests += 1;
      writeJson(response, 200, { output_text: "should-not-run" });
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();

      assert.ok(address !== null && typeof address === "object");

      const result = await runOpenAiSmokeAsync(
        [
          "--hosted-url",
          mcpFixture.url,
          "--hosted-data",
          "--endpoint",
          `http://127.0.0.1:${address.port}/v1/responses`,
        ],
        { OPENAI_API_KEY: "test-key" },
      );

      assert.equal(result.status, 1);
      assert.equal(openAiRequests, 0);
      assert.match(result.stderr, /does not expose OpenAI-compatible search, fetch tool\(s\)/);
      assert.doesNotMatch(result.stderr, /test-key/);
    } finally {
      await mcpFixture.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("fails before calling OpenAI when hosted data-backed search returns a tool error", async () => {
    const mcpFixture = await startHostedMcpFixture({ searchToolError: true });
    let openAiRequests = 0;
    const server = createServer((_request, response) => {
      openAiRequests += 1;
      writeJson(response, 200, { output_text: "should-not-run" });
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();

      assert.ok(address !== null && typeof address === "object");

      const result = await runOpenAiSmokeAsync(
        [
          "--hosted-url",
          mcpFixture.url,
          "--hosted-data",
          "--endpoint",
          `http://127.0.0.1:${address.port}/v1/responses`,
        ],
        { OPENAI_API_KEY: "test-key" },
      );

      assert.equal(result.status, 1);
      assert.equal(openAiRequests, 0);
      assert.match(result.stderr, /OpenAI hosted MCP preflight search failed/);
      assert.match(result.stderr, /Search backend unavailable/);
      assert.doesNotMatch(result.stderr, /test-key/);
    } finally {
      await mcpFixture.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
