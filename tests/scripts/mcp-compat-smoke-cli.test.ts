import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";

import { hostedExpectedToolNames, smokeHostedClientMetadataDocument } from "../../scripts/smoke-vrdex-mcp-compat";

const expectedTools = [
  "search",
  "fetch",
  "vrdex_search",
  "vrdex_get_profile",
  "vrdex_get_event",
  "vrdex_list_upcoming_events",
  "vrdex_get_world",
  "vrdex_list_active_worlds",
];
// A correct hosted deployment registers all write tools unconditionally, so the
// success fixture has to model all of them: the smoke now fails a deployment that
// is missing one, which is the whole point of asserting rather than flagging.
// Per tool, mirroring the server. A fixture that gave every write tool the same
// pair would keep passing a server that had stopped distinguishing them.
const writeToolScopes: Record<string, string> = {
  vrdex_event_intake_draft_save: "events:contribute",
  vrdex_event_intake_extract: "events:contribute",
  vrdex_event_intake_publish: "events:contribute",
  vrdex_event_intake_poster_upload_begin: "events:contribute",
  vrdex_event_intake_poster_upload_complete: "events:contribute",
  vrdex_event_intake_artwork_select: "events:contribute",
  vrdex_event_intake_event_update: "events:contribute",
  vrdex_event_intake_event_retract: "events:contribute",
  vrdex_event_create: "events:write",
  vrdex_event_update: "events:write",
  vrdex_profile_media_manage: "assets:write",
  vrdex_profile_media_submit: "assets:contribute",
  vrdex_profile_update: "profile:write",
  vrdex_profile_submit: "profile:contribute",
  vrdex_contribution_capacity_request: "assets:contribute",
  vrdex_contribution_batch_create: "assets:contribute",
  vrdex_contribution_batch_append: "assets:contribute",
  vrdex_contribution_batch_archive: "assets:contribute",
  vrdex_contribution_item_submit: "assets:contribute",
  vrdex_contribution_item_revise: "assets:contribute",
  vrdex_media_upload_begin: "assets:contribute",
  vrdex_media_upload_complete: "assets:contribute",
  vrdex_media_review_decide: "assets:review:write",
  vrdex_media_review_rebase: "assets:review:write",
  vrdex_media_review_decide_selected: "assets:review:write",
  vrdex_media_submission_withdraw: "assets:contribute",
  vrdex_media_submission_publish: "assets:publish",
  vrdex_media_contribution_manage: "assets:contribute",
  vrdex_media_contribution_place: "assets:publish",
  vrdex_media_contribution_propose_placement: "assets:contribute",
};
// Independent hosted contract fixture, deliberately not imported from runtime schemas.
const contributionSchemas: Record<string, Record<string, unknown>> = {
  vrdex_media_contribution_get: { inputSchema: { type: "object", additionalProperties: false, required: ["submissionId"] }, outputSchema: { required: ["submissionId", "assetId", "contributionVersion", "metadata", "canSelectPrimary", "canClearPrimary", "canEditMetadata", "canRemove"] } },
  vrdex_media_contribution_manage: { inputSchema: { type: "object", oneOf: [
    { additionalProperties: false, required: ["submissionId", "expectedContributionVersion", "idempotencyKey", "action", "metadata"] },
    { additionalProperties: false, required: ["submissionId", "expectedContributionVersion", "idempotencyKey", "action"] },
  ] }, outputSchema: { required: ["operationId", "operationState"] } },
  vrdex_media_contribution_place: { inputSchema: { type: "object", additionalProperties: false, required: ["submissionId", "expectedContributionVersion", "idempotencyKey", "action"], properties: { action: { enum: ["select_primary", "clear_primary"] } } }, outputSchema: { required: ["operationId", "operationState"] } },
  vrdex_media_contribution_propose_placement: { inputSchema: { type: "object", additionalProperties: false, required: ["submissionId", "expectedContributionVersion", "idempotencyKey"] }, outputSchema: { required: ["operationId", "operationState"] } },
};
const expectedWriteTools = Object.keys(writeToolScopes);
// Reads, but of the caller's own inventory, so they advertise a scope pair
// rather than the anonymous public-read pair every other read carries.
const contributionCollectionReadScopes = ["profile:contribute", "assets:contribute", "assets:review:read"];
const ownedReadToolScopes: Record<string, string | string[]> = {
  vrdex_event_intake_draft_get: "events:contribute",
  vrdex_event_intake_event_get: "events:contribute",
  vrdex_contribution_capacity: contributionCollectionReadScopes,
  vrdex_contribution_capacity_requests: contributionCollectionReadScopes,
  vrdex_contribution_status: contributionCollectionReadScopes,
  vrdex_contribution_batch_get: contributionCollectionReadScopes,
  vrdex_contribution_batch_items: contributionCollectionReadScopes,
  vrdex_list_my_media_submissions: "assets:contribute",
  vrdex_list_my_profiles: "profile:read",
  vrdex_get_my_media_submission: "assets:contribute",
  vrdex_media_review_assignments: "assets:review:read",
  vrdex_media_review_list: "assets:review:read",
  vrdex_media_review_get: "assets:review:read",
  vrdex_media_review_preview: "assets:review:read",
  vrdex_media_submission_get: "assets:publish",
  vrdex_media_contribution_get: "assets:contribute",
  vrdex_media_submission_preview: "assets:publish",
};
const expectedOwnedReadTools = Object.keys(ownedReadToolScopes);

function securitySchemesForTool(name: string) {
  if (expectedWriteTools.includes(name)) {
    const scopes = name.startsWith("vrdex_contribution_")
      ? ["profile:contribute", "assets:contribute"].map((scope) => ["mcp:write", scope])
      : name === "vrdex_media_upload_begin" || name === "vrdex_media_upload_complete"
        ? ["assets:write", "assets:contribute"].map((scope) => ["mcp:write", scope])
        : [["mcp:write", writeToolScopes[name]]];
    if (name === "vrdex_contribution_batch_append") {
      scopes.push(["mcp:write", "assets:contribute", "profile:contribute"]);
    }
    return scopes.map((scope) => ({ scopes: scope, type: "oauth2" }));
  }
  if (expectedOwnedReadTools.includes(name)) {
    const scopes = ownedReadToolScopes[name];
    return (Array.isArray(scopes) ? scopes : [scopes]).map((scope) => ({ scopes: ["mcp:read", scope], type: "oauth2" }));
  }
  return [{ type: "noauth" }, { scopes: ["mcp:read"], type: "oauth2" }];
}

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

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      writeJson(response, 200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
        scopes_supported: ["mcp:read", "profile:read", "mcp:write", "assets:write", "assets:contribute", "assets:review:read", "assets:review:write", "assets:publish", "events:write", "events:contribute", "profile:write", "profile:contribute"],
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
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`,
      });
      response.end();
      return;
    }

    const body = JSON.parse(await readRequestBody(request)) as {
      id?: number;
      method?: string;
      params?: {
        arguments?: {
          id?: string;
          query?: string;
          type?: string;
        };
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
        result: {
          // This fixture models a deployment whose data-backed reads fail, not
          // one missing tools, so its inventory is otherwise correct. Leaving
          // the write tools out made the smoke abort on the tool list before it
          // reached the read failures this test is about.
          tools: [...expectedTools, ...expectedOwnedReadTools, ...expectedWriteTools].map((name) => ({
            _meta: { securitySchemes: securitySchemesForTool(name) },
            ...contributionSchemas[name],
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

async function startHostedSuccessFixture(extraToolName?: string, omittedScope?: string) {
  const server = createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url ?? "/", origin);

    if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      writeJson(response, 200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
        scopes_supported: ["mcp:read", "profile:read", "mcp:write", "assets:write", "assets:contribute", "assets:review:read", "assets:review:write", "assets:publish", "events:write", "events:contribute", "profile:write", "profile:contribute"].filter((scope) => scope !== omittedScope),
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
      const registration = JSON.parse(await readRequestBody(request)) as { scope?: string };
      assert.ok(registration.scope?.split(/\s+/).includes("assets:review:read"));
      assert.ok(registration.scope?.split(/\s+/).includes("events:contribute"));
      writeJson(response, 201, {
        client_id: "vrdx_app_0123456789abcdef01234567",
        client_name: "VRDex MCP Client",
        grant_types: ["authorization_code"],
        redirect_uris: ["http://localhost:8765/callback"],
        response_types: ["code"],
        authorization_server: origin,
        resource: `${origin}/mcp`,
        scope: registration.scope,
        token_endpoint_auth_method: "none",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/authorize") {
      response.writeHead(302, { location: `${origin}/sign-in?next=/oauth/authorize` });
      response.end();
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/mcp") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    if (request.headers.authorization !== undefined) {
      response.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:read"`,
      });
      response.end();
      return;
    }

    const body = JSON.parse(await readRequestBody(request)) as {
      id?: number;
      method?: string;
      params?: {
        arguments?: {
          id?: string;
          query?: string;
          type?: string;
        };
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
        result: {
          tools: [...expectedTools, ...expectedOwnedReadTools, ...expectedWriteTools, ...(extraToolName ? [extraToolName] : [])].map((name) => ({
            _meta: { securitySchemes: securitySchemesForTool(name) },
            ...contributionSchemas[name],
            name,
          })),
        },
      });
      return;
    }

    if (body.method === "tools/call" && body.params?.name === "search") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          structuredContent: {
            results: [
              {
                id: "profile:community:afterglow",
                title: "Afterglow",
                url: `${origin}/afterglow`,
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
            id: body.params.arguments?.id,
            text: "Title: Afterglow\nEntity type: profile",
          },
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

    if (body.method === "tools/call" && body.params?.name === "vrdex_search") {
      writeJson(response, 200, {
        id: body.id,
        jsonrpc: "2.0",
        result: {
          structuredContent: {
            query: body.params.arguments?.query,
            results: [
              {
                entityType: "profile",
                profileType: "community",
                routePath: "/afterglow",
                score: 42,
                slug: "afterglow",
                summary: "A warm VRChat club night.",
                title: "Afterglow",
              },
            ],
            type: body.params.arguments?.type,
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
    origin: `http://127.0.0.1:${address.port}`,
  };
}

describe("MCP compatibility smoke CLI", () => {
  it("matches the independently classified hosted tool catalog", () => {
    assert.deepEqual(
      [...hostedExpectedToolNames].sort(),
      [...expectedTools, ...expectedOwnedReadTools, ...expectedWriteTools].sort(),
    );
  });

  it("fetches and validates the HTTPS CIMD document and authorization redirect", async () => {
    const issuer = "https://app.example.test";
    const clientId = `${issuer}/.well-known/oauth-client/vrdex-mcp-public-client`;
    const metadata = {
      authorizationEndpoint: `${issuer}/oauth/authorize`,
      issuer,
      registrationEndpoint: `${issuer}/oauth/register`,
      resource: `${issuer}/mcp`,
      scopes: ["mcp:read"],
    };
    const options = {
      clientMetadataDocument: true,
      continueOnFailure: false,
      dynamicRegistration: false,
      hostedOnly: true,
      hostedDataPublicReads: false,
      hostedSearchQuery: "club",
    };
    const run = async (status = 200, returnedId = clientId, scope = "mcp:read public:read", location = `${issuer}/sign-in?next=/oauth/authorize`) => {
      const originalFetch = globalThis.fetch;
      const results: { details: string; name: string; status: "fail" | "pass" | "skip" }[] = [];
      let requests = 0;
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        requests += 1;
        if (requests === 1) {
          assert.equal(url.toString(), clientId);
          assert.deepEqual(init?.headers, { accept: "application/json" });
          return Response.json({ client_id: returnedId, scope }, { status });
        }
        assert.equal(requests, 2);
        assert.equal(url.origin + url.pathname, metadata.authorizationEndpoint);
        assert.equal(url.searchParams.get("client_id"), clientId);
        assert.equal(url.searchParams.get("scope"), "mcp:read public:read");
        assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8765/callback");
        assert.equal(url.searchParams.get("resource"), metadata.resource);
        assert.equal(init?.redirect, "manual");
        return new Response(null, { status: 302, headers: { location } });
      };
      try {
        await smokeHostedClientMetadataDocument(metadata, options, results);
        return results;
      } finally {
        globalThis.fetch = originalFetch;
      }
    };

    assert.match((await run())[0]?.details ?? "", /accepted for scopes=mcp:read public:read/);
    await assert.rejects(run(404), /expected HTTP 200, got HTTP 404/);
    await assert.rejects(run(200, `${issuer}/wrong-client`), /wrong-client/);
    await assert.rejects(run(200, clientId, "mcp:write"), /mcp:read/);
    await assert.rejects(run(200, clientId, "mcp:read public:read", "https://attacker.example/sign-in?next=/oauth/authorize"), /unexpected authentication redirect/);
  });

  it("rejects protected-resource metadata missing a classified owned-read scope before DCR", async () => {
    const fixture = await startHostedSuccessFixture(undefined, "assets:review:read");

    try {
      const result = await runSmokeAsync(["--hosted-only", "--hosted-url", `${fixture.origin}/mcp`, "--dcr"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /metadata omits assets:review:read, required by vrdex_contribution_capacity/);
      assert.doesNotMatch(result.stdout, /Hosted Dynamic Client Registration/);
    } finally {
      await fixture.close();
    }
  });

  it("requests classified owned-read scopes during hosted DCR", async () => {
    const fixture = await startHostedSuccessFixture();

    try {
      const result = await runSmokeAsync([
        "--hosted-only",
        "--hosted-url",
        `${fixture.origin}/mcp`,
        "--dcr",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\| Hosted Dynamic Client Registration \| pass \|/);
      assert.match(result.stdout, /assets:review:read/);
    } finally {
      await fixture.close();
    }
  });

  it("reports one generic local protocol smoke without claiming client compatibility", () => {
    const result = runSmoke([]);

    assert.equal(result.status, 0, result.stderr);
    const localRows = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("| Local stdio MCP"));
    assert.deepEqual(localRows, [
      "| Local stdio MCP protocol | pass | stdio initialize, tool list, and all curated read tool calls passed |",
    ]);
    assert.match(result.stdout, /\| Smoke target \| Status \| Details \|/);
    assert.match(result.stdout, /\| Hosted Streamable HTTP MCP \| skip \|/);
  });

  it("can run hosted-only without the local stdio protocol smoke", () => {
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
      assert.match(result.stdout, /\| Hosted OpenAI-compatible search\/fetch \| fail \|/);
      assert.match(result.stdout, /Search backend unavailable/);
      assert.match(result.stdout, /\| Hosted OAuth metadata \| pass \|/);
      assert.match(result.stdout, /\| Hosted Dynamic Client Registration \| fail \|/);
      assert.match(result.stdout, /expected HTTP 201, got HTTP 500/);
      assert.match(result.stdout, /\| Hosted Client ID Metadata Document \| skip \|/);
      assert.match(result.stdout, /Client ID Metadata Document client ids require HTTPS issuer URLs/);
      assert.match(
        result.stderr,
        /Hosted MCP smoke failed: Hosted data-backed public read tool call, Hosted OpenAI-compatible search\/fetch/,
      );
    } finally {
      await fixture.close();
    }
  });

  it("requires hosted data-backed OpenAI search and fetch aliases", async () => {
    const fixture = await startHostedSuccessFixture();

    try {
      const result = await runSmokeAsync([
        "--hosted-only",
        "--hosted-url",
        `${fixture.origin}/mcp`,
        "--hosted-data",
        "--hosted-query",
        "afterglow",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /\| Hosted data-backed public read tool call \| pass \|/);
      assert.match(result.stdout, /\| Hosted OpenAI-compatible search\/fetch \| pass \|/);
      assert.match(result.stdout, /query="afterglow"/);
      assert.match(result.stdout, /id=profile:community:afterglow/);
    } finally {
      await fixture.close();
    }
  });

  it("rejects an unclassified hosted tool even when it advertises public-read metadata", async () => {
    const fixture = await startHostedSuccessFixture("vrdex_future_private_read");

    try {
      const result = await runSmokeAsync(["--hosted-only", "--hosted-url", `${fixture.origin}/mcp`]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Hosted tool vrdex_future_private_read is unclassified/);
    } finally {
      await fixture.close();
    }
  });
});
