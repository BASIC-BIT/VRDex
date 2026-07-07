import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

const expectedTools = [
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
];

function smokeEnv() {
  return {
    ...process.env,
    VRDEX_MCP_SMOKE_CIMD: "",
    VRDEX_MCP_SMOKE_CONTINUE_ON_FAILURE: "",
    VRDEX_MCP_SMOKE_DATA: "",
    VRDEX_MCP_SMOKE_DCR: "",
    VRDEX_MCP_SMOKE_HOSTED_ONLY: "",
    VRDEX_MCP_SMOKE_URL: "",
  };
}

function runSmoke(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/smoke-vrdex-mcp-compat.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: smokeEnv(),
    },
  );
}

function runSmokeAsync(args: string[]) {
  return new Promise<{ status: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/smoke-vrdex-mcp-compat.ts", ...args],
      {
        cwd: process.cwd(),
        env: smokeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("MCP smoke child process timed out."));
    }, 15_000);

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

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function startHostedFailureFixture() {
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      writeJson(response, 200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
        scopes_supported: ["mcp:read"],
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      writeJson(response, 200, {
        authorization_endpoint: `${origin}/oauth/authorize`,
        client_id_metadata_document_supported: true,
        issuer: origin,
        protected_resources: [`${origin}/mcp`],
        registration_endpoint: `${origin}/oauth/register`,
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/oauth/register") {
      writeJson(response, 500, { error: "server_error" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/authorize") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("Authorization request failed");
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/mcp") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    if (request.headers.authorization !== undefined) {
      response.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="mcp:read"`,
      });
      response.end();
      return;
    }

    const body = JSON.parse(await readRequestBody(request)) as {
      id?: number;
      method?: string;
      params?: {
        arguments?: {
          query?: string;
          type?: string;
        };
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
        result: {
          tools: expectedTools.map((name) => ({
            _meta: {
              securitySchemes: [
                { type: "noauth" },
                { scopes: ["mcp:read"], type: "oauth2" },
              ],
            },
            name,
          })),
        },
      });
      return;
    }

    if (body.method === "tools/call" && body.params?.arguments?.query === "") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          structuredContent: {
            query: "",
            results: [],
            type: body.params.arguments.type,
          },
        },
      });
      return;
    }

    if (body.method === "tools/call") {
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
    origin: `http://127.0.0.1:${address.port}`,
  };
}

describe("MCP compatibility smoke CLI", () => {
  it("can run hosted-only without local stdio profiles", () => {
    const result = runSmoke(["--hosted-only"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Hosted Streamable HTTP MCP/);
    assert.match(result.stdout, /skip/);
    assert.doesNotMatch(result.stdout, /Local stdio MCP/);
  });

  it("exits cleanly when a hosted-only target is unreachable", () => {
    const result = runSmoke(["--hosted-only", "--hosted-url", "http://127.0.0.1:9/mcp"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /fetch failed|bad port|ECONNREFUSED/i);
    assert.doesNotMatch(result.stderr, /Assertion failed/);
  });

  it("can keep probing hosted diagnostic checks after selected subcheck failures", async () => {
    const fixture = await startHostedFailureFixture();

    try {
      const result = await runSmokeAsync([
        "--hosted-only",
        "--hosted-url",
        `${fixture.origin}/mcp`,
        "--hosted-data",
        "--dcr",
        "--cimd",
        "--continue-on-failure",
      ]);

      assert.equal(result.status, 1);
      assert.match(result.stdout, /\| Hosted data-backed public read tool call \| fail \|/);
      assert.match(result.stdout, /Search backend unavailable/);
      assert.match(result.stdout, /\| Hosted OAuth metadata \| pass \|/);
      assert.match(result.stdout, /\| Hosted Dynamic Client Registration \| fail \|/);
      assert.match(result.stdout, /expected HTTP 201, got HTTP 500/);
      assert.match(result.stdout, /\| Hosted Client ID Metadata Document \| skip \|/);
      assert.match(result.stdout, /Client ID Metadata Document client ids require HTTPS issuer URLs/);
      assert.match(result.stderr, /Hosted MCP smoke failed: Hosted data-backed public read tool call/);
    } finally {
      await fixture.close();
    }
  });
});
