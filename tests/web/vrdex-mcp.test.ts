import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runMcpProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
    },
  });
}

const namedSchemaMapKeys = new Set(["$defs", "definitions", "dependentSchemas", "patternProperties", "properties"]);

function hasLegacySchemaId(value: unknown, insideNamedSchemaMap = false): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasLegacySchemaId(item));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  return Object.entries(value).some(
    ([key, child]) =>
      (key === "id" && !insideNamedSchemaMap) || hasLegacySchemaId(child, namedSchemaMapKeys.has(key)),
  );
}

function jsonBodyFromProbe(output: string) {
  const payload = output.trim().split(/\r?\n/).slice(1).join("\n");
  const eventData = payload
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);

  return JSON.parse(eventData ?? payload) as {
    result?: {
      tools?: Array<{
        _meta?: unknown;
        name?: string;
        outputSchema?: unknown;
      }>;
    };
  };
}

function assertPublicReadSecuritySchemes(value: unknown) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);

  const metadata = value as {
    securitySchemes?: Array<{
      scopes?: unknown;
      type?: unknown;
    }>;
  };

  assert.deepEqual(metadata.securitySchemes, [
    { type: "noauth" },
    { scopes: ["mcp:read"], type: "oauth2" },
  ]);
}

function assertAuthenticatedReadSecuritySchemes(value: unknown) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);

  const metadata = value as {
    securitySchemes?: Array<{
      scopes?: unknown;
      type?: unknown;
    }>;
  };

  assert.deepEqual(metadata.securitySchemes, [
    { scopes: ["mcp:read"], type: "oauth2" },
  ]);
}

function assertEventWriteSecuritySchemes(value: unknown) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);

  const metadata = value as {
    securitySchemes?: Array<{
      scopes?: unknown;
      type?: unknown;
    }>;
  };

  assert.deepEqual(metadata.securitySchemes, [
    { scopes: ["mcp:write", "events:write"], type: "oauth2" },
  ]);
}

describe("VRDex MCP server", () => {
  it("extracts accepted curated tool calls for durable invocation counts", () => {
    const output = runMcpProbe(`
      import {
        acceptedMcpRouteClassForRequest,
        mcpToolCallNamesFromPayload,
        mcpToolCallNamesFromRequest,
      } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const payloadNames = mcpToolCallNamesFromPayload([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "search",
            arguments: { query: "club" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "unknown_tool",
            arguments: {},
          },
        },
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "fetch",
            arguments: { id: "profile:community:afterglow" },
          },
        },
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "vrdex_get_world",
            arguments: { slug: "world" },
          },
        },
      ]);
      const requestNames = await mcpToolCallNamesFromRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "vrdex_list_active_worlds",
            arguments: {},
          },
        }),
      }));
      const malformedNames = await mcpToolCallNamesFromRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        body: "{",
      }));
      const anonymousRouteClass = acceptedMcpRouteClassForRequest(new Request("https://app.example.test/mcp"));
      const authenticatedRouteClass = acceptedMcpRouteClassForRequest(new Request("https://app.example.test/mcp", {
        headers: {
          authorization: "Bearer test",
        },
      }));

      console.log(JSON.stringify({
        payloadNames,
        requestNames,
        malformedNames,
        anonymousRouteClass,
        authenticatedRouteClass,
      }));
    `);
    const result = JSON.parse(output) as {
      anonymousRouteClass: string;
      authenticatedRouteClass: string;
      malformedNames: string[];
      payloadNames: string[];
      requestNames: string[];
    };

    assert.deepEqual(result.payloadNames, ["search", "fetch", "vrdex_get_world"]);
    assert.deepEqual(result.requestNames, ["vrdex_list_active_worlds"]);
    assert.deepEqual(result.malformedNames, []);
    assert.equal(result.anonymousRouteClass, "anonymous_mcp_public_read");
    assert.equal(result.authenticatedRouteClass, "authenticated_mcp");
  });

  it("serves MCP initialization without requiring Convex for tool listing", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler();
      const request = new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "vrdex-test", version: "0.0.0" },
          },
        }),
      });
      const response = await handler.fetch(request);

      console.log(response.status);
      console.log(await response.text());
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"name":"vrdex"/);
    assert.match(output, /"tools":/);
  });

  it("advertises the curated anonymous public read tools", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler();
      const request = new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });
      const response = await handler.fetch(request);

      console.log(response.status);
      console.log(await response.text());
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"name":"search"/);
    assert.match(output, /"name":"fetch"/);
    assert.match(output, /"name":"vrdex_search"/);
    assert.match(output, /"name":"vrdex_get_profile"/);
    assert.match(output, /"name":"vrdex_get_event"/);
    assert.match(output, /"name":"vrdex_get_world"/);
    assert.match(output, /"name":"vrdex_list_upcoming_events"/);
    assert.match(output, /"name":"vrdex_list_active_worlds"/);
    assert.match(output, /"readOnlyHint":true/);

    const body = jsonBodyFromProbe(output);
    const tools = body.result?.tools ?? [];

    assert.equal(tools.every((tool) => !hasLegacySchemaId(tool.outputSchema)), true);

    for (const tool of tools) {
      assertPublicReadSecuritySchemes(tool._meta);
    }
  });

  it("advertises OAuth-only tools when anonymous hosted reads are disabled", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler({ anonymousPublicReads: false });
      const response = await handler.fetch(new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: {},
        }),
      }));

      console.log(response.status);
      console.log(await response.text());
    `);
    const body = jsonBodyFromProbe(output);
    const tools = body.result?.tools ?? [];

    assert.match(output, /^200/m);
    assert.equal(tools.length, 8);

    for (const tool of tools) {
      assertAuthenticatedReadSecuritySchemes(tool._meta);
    }
  });

  it("keeps hosted event writes default-off and advertises scoped tools only when enabled", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      async function list(eventWrites) {
        const handler = createVrdexMcpHandler({ eventWrites });
        const response = await handler.fetch(new Request("http://localhost:3000/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: eventWrites ? 4 : 3,
            method: "tools/list",
            params: {},
          }),
        }));

        return await response.text();
      }

      console.log(JSON.stringify({
        disabled: await list(false),
        enabled: await list(true),
      }));
    `);
    const result = JSON.parse(output) as { disabled: string; enabled: string };
    const disabled = jsonBodyFromProbe(`ignored\n${result.disabled}`);
    const enabled = jsonBodyFromProbe(`ignored\n${result.enabled}`);
    const disabledTools = disabled.result?.tools ?? [];
    const enabledTools = enabled.result?.tools ?? [];

    assert.equal(disabledTools.length, 8);
    assert.equal(disabledTools.some((tool) => tool.name === "vrdex_event_create"), false);
    assert.equal(enabledTools.length, 10);

    for (const tool of enabledTools.filter((candidate) => candidate.name?.startsWith("vrdex_event_"))) {
      assertEventWriteSecuritySchemes(tool._meta);
    }
  });

  it("challenges anonymous hosted writes with the exact write scopes", () => {
    const output = runMcpProbe(`
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      const authorization = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "vrdex_event_create",
            arguments: { idempotencyKey: "test-key-123" },
          },
        }),
      }));

      console.log(authorization.response?.status);
      console.log(authorization.response?.headers.get("www-authenticate"));
      console.log(await authorization.response?.text());
    `);

    assert.match(output, /^401/m);
    assert.match(output, /scope="mcp:write events:write"/);
    assert.match(output, /OAuth bearer token is required for hosted MCP event writes/);
  });

  it("offers an explicit OAuth bootstrap without disabling canonical anonymous reads", () => {
    const output = runMcpProbe(`
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "compatibility-test", version: "1.0.0" },
          protocolVersion: "2025-11-25",
        },
      });
      const canonical = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }));
      const explicit = await authorizeHostedMcpRequest(new Request(
        "https://app.example.test/mcp?auth=required",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      ));

      console.log(JSON.stringify({
        canonical: {
          response: canonical.response,
          routeClass: canonical.routeClass,
        },
        explicit: {
          status: explicit.response?.status,
          challenge: explicit.response?.headers.get("www-authenticate"),
          routeClass: explicit.routeClass,
        },
      }));
    `);
    const result = JSON.parse(output) as {
      canonical: { response: null; routeClass: string };
      explicit: { challenge: string; routeClass: string; status: number };
    };

    assert.equal(result.canonical.response, null);
    assert.equal(result.canonical.routeClass, "anonymous_mcp_public_read");
    assert.equal(result.explicit.status, 401);
    assert.equal(result.explicit.routeClass, "anonymous_mcp_public_read");
    assert.match(result.explicit.challenge, /scope="mcp:read"/);
    assert.match(
      result.explicit.challenge,
      /resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
    );
  });

  it("returns an authoritative 403 challenge before dispatch for under-scoped write tokens", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      const accessToken = signOAuthAccessToken({
        aud: "https://app.example.test/mcp",
        client_id: "vrdx_app_0123456789abcdef01234567",
        exp: Math.floor((Date.now() + 60_000) / 1000),
        iat: Math.floor(Date.now() / 1000),
        iss: "https://app.example.test",
        jti: createOAuthAccessTokenId(),
        scope: "mcp:read",
        sub: "user_123",
      });
      const authorization = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          authorization: \`Bearer \${accessToken}\`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "vrdex_event_update",
            arguments: { idempotencyKey: "test-key-123", slug: "event", update: {} },
          },
        }),
      }));

      console.log(authorization.response?.status);
      console.log(authorization.response?.headers.get("www-authenticate"));
      console.log(await authorization.response?.text());
    `);

    assert.match(output, /^403/m);
    assert.match(output, /scope="mcp:write events:write"/);
    assert.match(output, /error="insufficient_scope"/);
  });

  it("requires the union of read and write scopes for mixed MCP batches", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signOAuthAccessToken({
        aud: "https://app.example.test/mcp",
        client_id: "vrdx_app_0123456789abcdef01234567",
        exp: now + 60,
        iat: now,
        iss: "https://app.example.test",
        jti: createOAuthAccessTokenId(),
        scope: "mcp:write events:write",
        sub: "user_123",
      });
      const authorization = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          authorization: \`Bearer \${accessToken}\`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "vrdex_search", arguments: { query: "club" } },
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "vrdex_event_update",
              arguments: { idempotencyKey: "test-key-123", slug: "event", update: {} },
            },
          },
        ]),
      }));

      console.log(authorization.response?.status);
      console.log(authorization.response?.headers.get("www-authenticate"));
    `);

    assert.match(output, /^403/m);
    assert.match(output, /scope="mcp:read mcp:write events:write"/);
  });

  it("rejects authenticated batches containing multiple hosted event writes", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      const now = Math.floor(Date.now() / 1000);
      const accessToken = signOAuthAccessToken({
        aud: "https://app.example.test/mcp",
        client_id: "vrdx_app_0123456789abcdef01234567",
        exp: now + 60,
        iat: now,
        iss: "https://app.example.test",
        jti: createOAuthAccessTokenId(),
        scope: "mcp:write events:write",
        sub: "user_123",
      });
      const authorization = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          authorization: \`Bearer \${accessToken}\`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "vrdex_event_create",
              arguments: { idempotencyKey: "create-key-123" },
            },
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "vrdex_event_update",
              arguments: { idempotencyKey: "update-key-123", slug: "event", update: {} },
            },
          },
        ]),
      }), {
        validateAccessTokenRecord: async (input) => ({
          ok: true,
          accessTokenRecordId: "token_record_123",
          clientId: input.clientId,
          dynamicClientId: "dynamic_client_123",
          resource: input.resource,
          scopes: ["mcp:write", "events:write"],
          subjectType: "user",
          tokenId: input.tokenId,
          trustTier: "standard",
          userId: "user_123",
        }),
      });

      console.log(authorization.response?.status);
      console.log(await authorization.response?.text());
    `);

    assert.match(output, /^400/m);
    assert.match(output, /MCP batches may contain at most one hosted event write/);
  });

  it("rejects declared oversized MCP bodies before parsing", () => {
    const output = runMcpProbe(`
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      let rateLimitChecks = 0;
      const authorization = await authorizeHostedMcpRequest(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          "content-length": String(1024 * 1024 + 1),
          "content-type": "application/json",
        },
        body: "{}",
      }), {
        checkRateLimit: async () => {
          rateLimitChecks += 1;
          return {
            allowed: true,
            key: "test:oversized",
            limit: 60,
            remaining: 59,
            resetAt: Date.now() + 60_000,
            retryAfterSeconds: 60,
          };
        },
      });

      console.log(authorization.response?.status);
      console.log(await authorization.response?.text());
      console.log(\`RATE_LIMIT_CHECKS=\${rateLimitChecks}\`);
    `);

    assert.match(output, /^413/m);
    assert.match(output, /MCP request body exceeds the 1 MiB limit/);
    assert.match(output, /RATE_LIMIT_CHECKS=1/);
  });

  it("allows write-only OAuth sessions to initialize and list tools without invoking them", () => {
    const output = runMcpProbe(`
      import assert from "node:assert/strict";
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import {
        authorizeHostedMcpRequest,
        createVrdexMcpHandler,
      } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      const now = Math.floor(Date.now() / 1000);
      const resource = "https://app.example.test/mcp";
      const clientId = "vrdx_app_0123456789abcdef01234567";
      const accessToken = signOAuthAccessToken({
        aud: resource,
        client_id: clientId,
        exp: now + 60,
        iat: now,
        iss: "https://app.example.test",
        jti: createOAuthAccessTokenId(),
        scope: "mcp:write events:write",
        sub: "user_123",
      });
      const handler = createVrdexMcpHandler({ eventWrites: true });
      const validateAccessTokenRecord = async (input) => ({
        ok: true,
        accessTokenRecordId: "token_record_123",
        clientId: input.clientId,
        dynamicClientId: "dynamic_client_123",
        resource: input.resource,
        scopes: ["mcp:write", "events:write"],
        subjectType: "user",
        tokenId: input.tokenId,
        trustTier: "standard",
        userId: "user_123",
      });

      async function dispatch(payload) {
        const request = new Request(resource, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: \`Bearer \${accessToken}\`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const authorization = await authorizeHostedMcpRequest(request.clone(), {
          validateAccessTokenRecord,
        });
        assert.equal(authorization.response, null);
        assert.ok("authInfo" in authorization && authorization.authInfo !== undefined);
        return await handler.fetch(request, { authInfo: authorization.authInfo });
      }

      const initialized = await dispatch({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "write-only-proof", version: "1.0.0" },
        },
      });
      const listed = await dispatch({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      });
      const listedBody = await listed.text();

      console.log(JSON.stringify({
        initializedStatus: initialized.status,
        listedStatus: listed.status,
        listsCreate: listedBody.includes('"name":"vrdex_event_create"'),
        listsUpdate: listedBody.includes('"name":"vrdex_event_update"'),
      }));
    `);
    const result = JSON.parse(output) as {
      initializedStatus: number;
      listedStatus: number;
      listsCreate: boolean;
      listsUpdate: boolean;
    };

    assert.deepEqual(result, {
      initializedStatus: 200,
      listedStatus: 200,
      listsCreate: true,
      listsUpdate: true,
    });
  });

  it("composes JWT, durable validation, AuthInfo, and write-subject rejection", () => {
    const output = runMcpProbe(`
      import assert from "node:assert/strict";
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import {
        authorizeHostedMcpRequest,
        createVrdexMcpHandler,
      } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_HOSTED_MCP_EVENT_WRITES = "true";
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      const now = Math.floor(Date.now() / 1000);
      const resource = "https://app.example.test/mcp";
      const clientId = "vrdx_app_0123456789abcdef01234567";

      function token(options = {}) {
        return signOAuthAccessToken({
          aud: options.aud ?? resource,
          client_id: clientId,
          exp: options.exp ?? now + 60,
          iat: now,
          iss: "https://app.example.test",
          jti: options.jti ?? createOAuthAccessTokenId(),
          scope: "mcp:read mcp:write events:write",
          sub: options.sub ?? "user_123",
        });
      }

      function request(accessToken) {
        return new Request("https://app.example.test/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: \`Bearer \${accessToken}\`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "vrdex_event_create",
              arguments: {
                idempotencyKey: "test-key-123",
                communitySlug: "afterglow",
                startAt: 1780000000000,
                title: "Afterglow Night",
              },
            },
          }),
        });
      }

      const accessToken = token();
      const accepted = await authorizeHostedMcpRequest(request(accessToken), {
        validateAccessTokenRecord: async (input) => ({
          ok: true,
          accessTokenRecordId: "token_record_123",
          clientId: input.clientId,
          dynamicClientId: "dynamic_client_123",
          resource: input.resource,
          scopes: ["mcp:read", "mcp:write", "events:write"],
          subjectType: "user",
          tokenId: input.tokenId,
          trustTier: "standard",
          userId: "user_123",
        }),
      });
      assert.equal(accepted.response, null);
      assert.ok("authInfo" in accepted && accepted.authInfo !== undefined);
      assert.equal(accepted.authInfo.token, accessToken);

      let mutationUserId;
      const handler = createVrdexMcpHandler({
        eventWrites: true,
        adminConvex: {
          mutation: async (_mutation, args) => {
            mutationUserId = args.ownerUserId;
            throw new Error("stop after principal proof");
          },
        },
      });
      const dispatched = await handler.fetch(request(accessToken), {
        authInfo: accepted.authInfo,
      });
      const dispatchedBody = await dispatched.text();

      const revoked = await authorizeHostedMcpRequest(request(token({ jti: createOAuthAccessTokenId() })), {
        validateAccessTokenRecord: async () => ({ ok: false, reason: "revoked" }),
      });
      const clientSubject = await authorizeHostedMcpRequest(request(token({ sub: "client_123" })), {
        validateAccessTokenRecord: async (input) => ({
          ok: true,
          accessTokenRecordId: "token_record_456",
          clientId: input.clientId,
          dynamicClientId: "dynamic_client_456",
          resource: input.resource,
          scopes: ["mcp:read", "mcp:write", "events:write"],
          subjectType: "client",
          tokenId: input.tokenId,
          trustTier: "standard",
        }),
      });
      const wrongAudience = await authorizeHostedMcpRequest(request(token({
        aud: "https://api.example.test",
      })), {
        validateAccessTokenRecord: async () => {
          throw new Error("wrong-audience token reached durable validation");
        },
      });
      const expired = await authorizeHostedMcpRequest(request(token({ exp: now - 1 })), {
        validateAccessTokenRecord: async () => {
          throw new Error("expired token reached durable validation");
        },
      });

      console.log(JSON.stringify({
        accepted: {
          clientId: accepted.authInfo.clientId,
          resource: accepted.authInfo.resource?.toString(),
          routeClass: accepted.routeClass,
          scopes: accepted.authInfo.scopes,
          subjectType: accepted.authInfo.extra?.subjectType,
          tokenMatches: accepted.authInfo.token === accessToken,
          userId: accepted.authInfo.extra?.userId,
        },
        clientSubjectStatus: clientSubject.response?.status,
        dispatchedBody,
        expiredStatus: expired.response?.status,
        mutationUserId,
        revokedStatus: revoked.response?.status,
        wrongAudienceStatus: wrongAudience.response?.status,
      }));
    `);
    const result = JSON.parse(output) as {
      accepted: {
        clientId: string;
        resource: string;
        routeClass: string;
        scopes: string[];
        subjectType: string;
        tokenMatches: boolean;
        userId: string;
      };
      clientSubjectStatus: number;
      dispatchedBody: string;
      expiredStatus: number;
      mutationUserId: string;
      revokedStatus: number;
      wrongAudienceStatus: number;
    };

    assert.deepEqual(result.accepted, {
      clientId: "vrdx_app_0123456789abcdef01234567",
      resource: "https://app.example.test/mcp",
      routeClass: "authenticated_mcp_write",
      scopes: ["mcp:read", "mcp:write", "events:write"],
      subjectType: "user",
      tokenMatches: true,
      userId: "user_123",
    });
    assert.equal(result.mutationUserId, "user_123");
    assert.match(result.dispatchedBody, /may already have accepted the mutation/);
    assert.equal(result.revokedStatus, 401);
    assert.equal(result.clientSubjectStatus, 403);
    assert.equal(result.wrongAudienceStatus, 401);
    assert.equal(result.expiredStatus, 401);
    assert.doesNotMatch(output, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  });

  it("passes only sanitized principal attribution and hashes to hosted event mutations", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      process.env.VRDEX_PUBLIC_WEB_ORIGIN = "https://app.example.test";
      let mutationArgs;
      const event = {
        id: "event_123",
        slug: "afterglow-night",
        title: "Afterglow Night",
        startAt: 1780000000000,
        communityName: "Afterglow",
        communitySlug: "afterglow",
        source: { label: "Community submitted", sourceType: "community" },
        watchSurfaceEnabled: false,
        mediaLinks: [],
        participantLinks: [],
        slotLinks: [],
        worlds: [],
      };
      const handler = createVrdexMcpHandler({
        eventWrites: true,
        authInfo: {
          token: "raw-secret-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "events:write"],
          resource: new URL("https://app.example.test/mcp"),
          extra: {
            requestId: "request-123",
            subjectType: "user",
            tokenId: "token-123",
            userId: "user_123",
          },
        },
        adminConvex: {
          mutation: async (_mutation, args) => {
            mutationArgs = args;
            return {
              eventId: "event_123",
              slug: "afterglow-night",
              eventPath: "/e/afterglow-night",
              shortLinkCode: "abc123",
              shortLinkPath: "/s/abc123",
            };
          },
        },
        convex: {
          query: async () => event,
        },
      });
      const response = await handler.fetch(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "vrdex_event_create",
            arguments: {
              idempotencyKey: "operator-key-123",
              communitySlug: "afterglow",
              startAt: 1780000000000,
              title: "Afterglow Night",
            },
          },
        }),
      }));

      console.log(JSON.stringify({
        body: await response.text(),
        mutationArgs,
        status: response.status,
      }));
    `);
    const result = JSON.parse(output) as {
      body: string;
      mutationArgs: Record<string, unknown>;
      status: number;
    };

    assert.equal(result.status, 200);
    assert.match(result.body, /"canonicalUrl":"https:\/\/app\.example\.test\/e\/afterglow-night"/);
    assert.equal(result.mutationArgs.ownerUserId, "user_123");
    assert.equal(result.mutationArgs.oauthClientId, "vrdx_app_test");
    assert.equal(result.mutationArgs.oauthTokenId, "token-123");
    assert.equal(result.mutationArgs.requestId, "request-123");
    assert.match(String(result.mutationArgs.idempotencyKeyHash), /^[0-9a-f]{64}$/);
    assert.match(String(result.mutationArgs.requestFingerprint), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result.mutationArgs).includes("operator-key-123"), false);
    assert.equal(JSON.stringify(result.mutationArgs).includes("raw-secret-token"), false);
  });

  it("preserves indeterminate and accepted-readback no-retry behavior for hosted writes", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";
      import { ConvexError } from "convex/values";

      const authInfo = {
        token: "never-print-this-token",
        clientId: "vrdx_app_test",
        scopes: ["mcp:write", "events:write"],
        resource: new URL("https://app.example.test/mcp"),
        extra: {
          requestId: "request-123",
          subjectType: "user",
          tokenId: "token-123",
          userId: "user_123",
        },
      };
      const write = {
        eventId: "event_123",
        slug: "afterglow-night",
        eventPath: "/e/afterglow-night",
        shortLinkCode: "abc123",
        shortLinkPath: "/s/abc123",
      };

      async function call(handler, id) {
        const response = await handler.fetch(new Request("https://app.example.test/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
              name: "vrdex_event_create",
              arguments: {
                idempotencyKey: "operator-key-123",
                communitySlug: "afterglow",
                startAt: 1780000000000,
                title: "Afterglow Night",
              },
            },
          }),
        }));

        return await response.text();
      }

      const indeterminate = await call(createVrdexMcpHandler({
        eventWrites: true,
        authInfo,
        adminConvex: { mutation: async () => { throw new Error("private commit state"); } },
      }), 7);
      const readback = await call(createVrdexMcpHandler({
        eventWrites: true,
        authInfo,
        adminConvex: { mutation: async () => write },
        convex: { query: async () => { throw new Error("private readback state"); } },
      }), 8);
      const denied = await call(createVrdexMcpHandler({
        eventWrites: true,
        authInfo,
        adminConvex: {
          mutation: async () => {
            throw new ConvexError({ code: "MCP_EVENT_WRITE_DENIED" });
          },
        },
      }), 9);
      const malformedReadback = await call(createVrdexMcpHandler({
        eventWrites: true,
        authInfo,
        adminConvex: { mutation: async () => write },
        convex: { query: async () => ({ id: "event_123", slug: "afterglow-night" }) },
      }), 10);
      const mismatchedReadback = await call(createVrdexMcpHandler({
        eventWrites: true,
        authInfo,
        adminConvex: { mutation: async () => write },
        convex: { query: async () => ({ id: "event_other", slug: "afterglow-night" }) },
      }), 11);

      console.log(JSON.stringify({ denied, indeterminate, malformedReadback, mismatchedReadback, readback }));
    `);
    const result = JSON.parse(output) as {
      denied: string;
      indeterminate: string;
      malformedReadback: string;
      mismatchedReadback: string;
      readback: string;
    };

    assert.match(result.denied, /VRDex rejected the event write/);
    assert.doesNotMatch(result.denied, /may already have accepted/);
    assert.match(result.indeterminate, /may already have accepted the mutation/);
    assert.match(result.indeterminate, /Do not retry automatically/);
    assert.doesNotMatch(result.indeterminate, /private commit state|never-print-this-token/);
    assert.match(result.readback, /accepted the event write/);
    assert.match(result.readback, /Do not retry the mutation automatically/);
    assert.doesNotMatch(result.readback, /private readback state|never-print-this-token/);
    assert.match(result.malformedReadback, /accepted the event write/);
    assert.match(result.malformedReadback, /did not match the public response contract/);
    assert.match(result.malformedReadback, /Do not retry the mutation automatically/);
    assert.match(result.mismatchedReadback, /accepted the event write/);
    assert.match(result.mismatchedReadback, /public event readback did not match the saved event/);
    assert.match(result.mismatchedReadback, /Do not retry the mutation automatically/);
  });

  it("rejects write callbacks without a user-delegated scoped principal", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      let mutationCalled = false;
      const handler = createVrdexMcpHandler({
        eventWrites: true,
        authInfo: {
          token: "client-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "events:write"],
          extra: {
            requestId: "request-123",
            subjectType: "client",
            tokenId: "token-123",
          },
        },
        adminConvex: {
          mutation: async () => {
            mutationCalled = true;
          },
        },
      });
      const response = await handler.fetch(new Request("https://app.example.test/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: {
            name: "vrdex_event_create",
            arguments: {
              idempotencyKey: "operator-key-123",
              communitySlug: "afterglow",
              startAt: 1780000000000,
              title: "Afterglow Night",
            },
          },
        }),
      }));

      console.log(JSON.stringify({ body: await response.text(), mutationCalled }));
    `);
    const result = JSON.parse(output) as { body: string; mutationCalled: boolean };

    assert.equal(result.mutationCalled, false);
    assert.match(result.body, /user-delegated VRDex OAuth session/);
  });

  it("requires OAuth when anonymous hosted reads are disabled", () => {
    const output = runMcpProbe(`
      import assert from "node:assert/strict";
      import {
        hostedMcpAnonymousPublicReadsEnabled,
        rejectInvalidOrRateLimitedMcpRequest,
      } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      assert.equal(hostedMcpAnonymousPublicReadsEnabled(undefined), true);
      assert.equal(hostedMcpAnonymousPublicReadsEnabled("true"), true);
      assert.equal(hostedMcpAnonymousPublicReadsEnabled("false"), false);
      assert.throws(() => hostedMcpAnonymousPublicReadsEnabled("sometimes"), /must be true or false/);

      process.env.VRDEX_HOSTED_MCP_ANONYMOUS_READS = "false";
      const response = await rejectInvalidOrRateLimitedMcpRequest(
        new Request("https://app.example.test/mcp"),
      );

      console.log(response?.status);
      console.log(response?.headers.get("www-authenticate"));
      console.log(await response?.text());
    `);

    assert.match(output, /^401/m);
    assert.match(
      output,
      /Bearer resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/mcp", scope="mcp:read"/,
    );
    assert.match(output, /OAuth bearer token is required for this MCP deployment/);
  });

  it("serves OpenAI-compatible search and fetch over public records", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      process.env.VRDEX_OAUTH_ISSUER_URL = "https://app.example.test";

      const handler = createVrdexMcpHandler({
        convex: {
          query: async (query, args) => {
            if ("query" in args) {
              return [
                {
                  entityType: "profile",
                  profileType: "community",
                  routePath: "/c/afterglow",
                  score: 42,
                  slug: "afterglow",
                  summary: "A warm VRChat club night.",
                  title: "Afterglow",
                },
              ];
            }

            if ("profileType" in args) {
              return {
                bio: "A warm VRChat club night.",
                displayName: "Afterglow",
                outboundLinks: [{ label: "Website", url: "https://afterglow.example" }],
                profileType: args.profileType,
                slug: args.slug,
                tags: ["club", "vrchat"],
                trustLabel: "claimed_verified",
              };
            }

            throw new Error("unexpected query");
          },
        },
      });
      const searchResponse = await handler.fetch(new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            arguments: { query: "club" },
            name: "search",
          },
        }),
      }));
      const fetchResponse = await handler.fetch(new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            arguments: { id: "profile:community:afterglow" },
            name: "fetch",
          },
        }),
      }));

      console.log(searchResponse.status);
      console.log(await searchResponse.text());
      console.log(fetchResponse.status);
      console.log(await fetchResponse.text());
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"id":"profile:community:afterglow"/);
    assert.match(output, /"url":"https:\/\/app\.example\.test\/c\/afterglow"/);
    assert.match(output, /"text":"Title: Afterglow\\nEntity type: profile/);
    assert.match(output, /"metadata":\{"entityType":"profile","profileType":"community","slug":"afterglow"/);
  });

  it("returns a public-safe tool error when hosted public data is unavailable", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler({
        convex: {
          query: async () => {
            throw new Error("secret backend failure");
          },
        },
      });
      const request = new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            arguments: { query: "club", type: "all", limit: 1 },
            name: "vrdex_search",
          },
        }),
      });
      const response = await handler.fetch(request);

      console.log(response.status);
      console.log(await response.text());
    `);
    const body = jsonBodyFromProbe(output) as {
      result?: {
        content?: Array<{ text?: string; type?: string }>;
        isError?: boolean;
      };
    };
    const errorText = body.result?.content?.find((entry) => entry.type === "text")?.text ?? "";

    assert.match(output, /^200/m);
    assert.equal(body.result?.isError, true);
    assert.match(errorText, /VRDex public data is temporarily unavailable for search/);
    assert.doesNotMatch(errorText, /secret backend failure/);
  });

  it("returns OAuth discovery details for malformed bearer tokens", () => {
    const output = runMcpProbe(`
      import { rejectInvalidOrRateLimitedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const response = await rejectInvalidOrRateLimitedMcpRequest(new Request("https://app.example.test/mcp", {
        headers: {
          authorization: "Bearer not-a-jwt",
        },
      }));

      console.log(response?.status);
      console.log(response?.headers.get("www-authenticate"));
      console.log(await response?.text());
    `);

    assert.match(output, /^401/m);
    assert.match(
      output,
      /Bearer resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/mcp", scope="mcp:read", error="invalid_token"/,
    );
    assert.match(output, /OAuth bearer token is invalid/);
  });

  it("charges invalid bearer authentication to the anonymous MCP IP bucket", () => {
    const output = runMcpProbe(`
      import assert from "node:assert/strict";
      import { rejectInvalidOrRateLimitedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      process.env.VERCEL = "1";
      process.env.VERCEL_ENV = "preview";
      process.env.VRDEX_DEPLOYMENT_ENV = "preview";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      process.env.VRDEX_RATE_LIMIT_REDIS_PREFIX = "vrdex:test:mcp-failed-auth";

      function request() {
        return new Request("https://app.example.test/mcp", {
          headers: {
            authorization: "Bearer not-a-jwt",
            "x-vercel-forwarded-for": "203.0.113.46",
          },
        });
      }

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await rejectInvalidOrRateLimitedMcpRequest(request());
        assert.equal(response?.status, 401);
      }

      const blocked = await rejectInvalidOrRateLimitedMcpRequest(request());
      console.log(blocked?.status);
      console.log(blocked?.headers.get("ratelimit-limit"));
      console.log(await blocked?.text());
    `);

    assert.match(output, /^429/m);
    assert.match(output, /^60$/m);
    assert.match(output, /MCP rate limit exceeded/);
  });

  it("returns insufficient-scope challenges for valid MCP-resource tokens without mcp:read", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { rejectInvalidOrRateLimitedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";

      const accessToken = signOAuthAccessToken({
        aud: "https://app.example.test/mcp",
        client_id: "vrdx_app_0123456789abcdef01234567",
        exp: Math.floor((Date.now() + 60_000) / 1000),
        iat: Math.floor(Date.now() / 1000),
        iss: "https://app.example.test",
        jti: createOAuthAccessTokenId(),
        scope: "public:read",
        sub: "user_123",
      });
      const response = await rejectInvalidOrRateLimitedMcpRequest(new Request("https://app.example.test/mcp", {
        headers: {
          authorization: \`Bearer \${accessToken}\`,
        },
      }));

      console.log(response?.status);
      console.log(response?.headers.get("www-authenticate"));
      console.log(await response?.text());
    `);

    assert.match(output, /^403/m);
    assert.match(
      output,
      /Bearer resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource\/mcp", scope="mcp:read", error="insufficient_scope"/,
    );
    assert.match(output, /OAuth bearer token scope is insufficient/);
  });
});
