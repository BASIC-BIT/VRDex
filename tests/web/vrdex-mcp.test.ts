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
        annotations?: unknown;
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

function isWriteToolName(name: string | undefined) {
  return name === "vrdex_profile_media_manage" || name === "vrdex_profile_media_submit" ||
    (name !== undefined && /^vrdex_(event|profile)_(create|update|submit)$/.test(name));
}

// A read, but of the caller's own inventory, so it carries a scope pair rather
// than the public-read schemes every other read tool advertises.
function isOwnedReadToolName(name: string | undefined) {
  return name === "vrdex_list_my_profiles" || name === "vrdex_list_my_media_submissions";
}

function assertWriteSecuritySchemes(value: unknown, resourceScope: string) {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);

  const metadata = value as {
    securitySchemes?: Array<{
      scopes?: unknown;
      type?: unknown;
    }>;
  };

  assert.deepEqual(metadata.securitySchemes, [
    { scopes: ["mcp:write", resourceScope], type: "oauth2" },
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

    for (
      const tool of tools.filter((candidate) =>
        !isWriteToolName(candidate.name) && !isOwnedReadToolName(candidate.name)
      )
    ) {
      assertPublicReadSecuritySchemes(tool._meta);
    }

    // The owned-inventory read is listed anonymously like every other tool, but
    // it must never advertise `noauth`: a session with no user behind it has no
    // inventory to read.
    const ownedReadScopes = {
      vrdex_list_my_profiles: "profile:read",
      vrdex_list_my_media_submissions: "assets:contribute",
    } as const;
    for (const [name, resourceScope] of Object.entries(ownedReadScopes)) {
      const ownedRead = tools.find((candidate) => candidate.name === name);
      assert.notEqual(ownedRead, undefined);
      assert.deepEqual((ownedRead?._meta as { securitySchemes?: unknown }).securitySchemes, [
        { scopes: ["mcp:read", resourceScope], type: "oauth2" },
      ]);
    }

    // A status read of rows VRDex already holds: nothing is written, repeating
    // it changes nothing, and it reaches no third-party host.
    assert.deepEqual(
      tools.find((candidate) => candidate.name === "vrdex_list_my_media_submissions")?.annotations,
      {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    );
  });

  it("advertises every write tool, scoped to the resource it writes", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler();
      const response = await handler.fetch(new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/list",
          params: {},
        }),
      }));

      console.log(response.status);
      console.log(await response.text());
    `);
    const tools = (jsonBodyFromProbe(output).result?.tools ?? []);
    const writeTools = tools.filter((tool) => isWriteToolName(tool.name));

    // No deployment switch: the write tools are always listed, and the harness
    // connecting decides which of them it exposes.
    assert.deepEqual(writeTools.map((tool) => tool.name), [
      "vrdex_event_create",
      "vrdex_event_update",
      "vrdex_profile_update",
      "vrdex_profile_submit",
      "vrdex_profile_media_submit",
      "vrdex_profile_media_manage",
    ]);

    // Per resource, not one blanket write scope: a token that may set a DJ's
    // links must not thereby be able to publish events under their name.
    // Submitting is the outlier: it writes a profile nobody owns, so it asks for
    // the contribution grant rather than the edit-your-own-profiles one.
    const expectedResourceScope: Record<string, string> = {
      vrdex_event_create: "events:write",
      vrdex_event_update: "events:write",
      vrdex_profile_update: "profile:write",
      vrdex_profile_submit: "profile:contribute",
      vrdex_profile_media_manage: "assets:write",
      vrdex_profile_media_submit: "assets:contribute",
    };

    for (const tool of writeTools) {
      assertWriteSecuritySchemes(tool._meta, expectedResourceScope[tool.name ?? ""] ?? "");
    }

    // Not idempotent even though it takes an idempotency key: a second key over
    // the same image is a second proposal a reviewer has to dispose of. And it
    // fetches a caller-supplied public URL, so it reaches the open world.
    assert.deepEqual(
      tools.find((tool) => tool.name === "vrdex_profile_media_submit")?.annotations,
      {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    );
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
    const readTools = tools.filter((tool) => !isWriteToolName(tool.name) && !isOwnedReadToolName(tool.name));

    assert.match(output, /^200/m);
    assert.equal(readTools.length, 8);

    for (const tool of readTools) {
      assertAuthenticatedReadSecuritySchemes(tool._meta);
    }
  });

  it("challenges anonymous hosted writes with the exact write scopes", () => {
    const output = runMcpProbe(`
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

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
    assert.match(output, /OAuth bearer token is required for hosted MCP writes/);
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

  it("challenges an owned-inventory read before dispatch, not inside the tool", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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
          params: { name: "vrdex_list_my_profiles", arguments: {} },
        }),
      }));

      console.log(authorization.response?.status);
      console.log(authorization.response?.headers.get("www-authenticate"));
    `);

    // Classified as an ordinary read, this token passed authorization, was
    // counted as an accepted invocation, and was refused inside the tool -- so
    // the caller never learned which grant to go and obtain.
    assert.match(output, /^403/m);
    assert.match(output, /scope="mcp:read profile:read"/);
    assert.match(output, /error="insufficient_scope"/);
  });

  it("requires the union of read and write scopes for mixed MCP batches", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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

  it("rejects authenticated batches containing multiple hosted writes", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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
    assert.match(output, /MCP batches may contain at most one hosted write/);
  });

  it("rejects authenticated batches pairing a media submission with another hosted write", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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
        scope: "mcp:write events:write assets:contribute",
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
              name: "vrdex_profile_media_submit",
              arguments: {
                slug: "community-dj",
                sourceUrl: "https://media.example.test/press.webp",
                credit: "Artist press kit",
                expectedUpdatedAt: 123,
                idempotencyKey: "submit-key-123",
              },
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
          scopes: ["mcp:write", "events:write", "assets:contribute"],
          subjectType: "user",
          tokenId: input.tokenId,
          trustTier: "standard",
          userId: "user_123",
        }),
      });

      console.log(authorization.response?.status);
      console.log(await authorization.response?.text());
    `);

    // Fully scoped for both writes, so the refusal is the one-write batch rule
    // rather than a scope challenge.
    assert.match(output, /^400/m);
    assert.match(output, /MCP batches may contain at most one hosted write/);
  });

  it("refuses under-scoped media submission and status tokens before dispatch", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import {
        authorizeHostedMcpRequest,
        createVrdexMcpHandler,
      } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      const clientId = "vrdx_app_0123456789abcdef01234567";
      const resource = "https://app.example.test/mcp";

      const convexCalls = [];
      const adminConvex = {
        mutation: async () => { convexCalls.push("mutation"); return {}; },
        query: async () => { convexCalls.push("query"); return null; },
      };

      async function attempt(scope, name, args) {
        const now = Math.floor(Date.now() / 1000);
        const tokenId = createOAuthAccessTokenId();
        const accessToken = signOAuthAccessToken({
          aud: resource,
          client_id: clientId,
          exp: now + 60,
          iat: now,
          iss: "https://app.example.test",
          jti: tokenId,
          scope,
          sub: "user_123",
        });
        const request = new Request(resource, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: \`Bearer \${accessToken}\`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 44,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        });
        const authorization = await authorizeHostedMcpRequest(request, {
          validateAccessTokenRecord: async () => ({
            ok: true,
            accessTokenRecordId: "token_record_123",
            clientId,
            dynamicClientId: "dynamic_client_123",
            resource,
            scopes: scope.split(" "),
            subjectType: "user",
            tokenId,
            trustTier: "standard",
            userId: "user_123",
          }),
        });
        if (authorization.response !== undefined) {
          return {
            challenge: authorization.response.headers.get("www-authenticate"),
            dispatched: false,
            status: authorization.response.status,
          };
        }
        // Authorization let it through, so the tool itself ran against Convex.
        const handler = createVrdexMcpHandler({ adminConvex, eventWrites: true });
        const response = await handler.fetch(request);
        return { body: await response.text(), dispatched: true, status: response.status };
      }

      const submitArgs = {
        slug: "community-dj",
        sourceUrl: "https://media.example.test/press.webp",
        credit: "Artist press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-123",
      };
      console.log(JSON.stringify({
        convexCalls,
        statusWithoutContribute: await attempt("mcp:read", "vrdex_list_my_media_submissions", {}),
        submitWithoutContribute: await attempt("mcp:write", "vrdex_profile_media_submit", submitArgs),
        submitWithoutWrite: await attempt("assets:contribute", "vrdex_profile_media_submit", submitArgs),
      }));
    `);
    const result = JSON.parse(output) as {
      convexCalls: string[];
      statusWithoutContribute: { challenge: string; dispatched: boolean; status: number };
      submitWithoutContribute: { challenge: string; dispatched: boolean; status: number };
      submitWithoutWrite: { challenge: string; dispatched: boolean; status: number };
    };

    // The resource scope is dual-use, so each half of the pair has to be
    // checked on its own; holding either one alone reaches nothing.
    assert.equal(result.submitWithoutContribute.dispatched, false);
    assert.equal(result.submitWithoutContribute.status, 403);
    assert.match(result.submitWithoutContribute.challenge, /scope="mcp:write assets:contribute"/);
    assert.match(result.submitWithoutContribute.challenge, /error="insufficient_scope"/);

    assert.equal(result.submitWithoutWrite.dispatched, false);
    assert.equal(result.submitWithoutWrite.status, 403);
    assert.match(result.submitWithoutWrite.challenge, /scope="mcp:write assets:contribute"/);

    assert.equal(result.statusWithoutContribute.dispatched, false);
    assert.equal(result.statusWithoutContribute.status, 403);
    assert.match(result.statusWithoutContribute.challenge, /scope="mcp:read assets:contribute"/);

    // Refused at the boundary, so no proposal, intent, or audit row was even
    // considered.
    assert.deepEqual(result.convexCalls, []);
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
              eventPath: "/afterglow/events/afterglow-night",
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
    assert.match(result.body, /"canonicalUrl":"https:\/\/app\.example\.test\/afterglow\/events\/afterglow-night"/);
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
        eventPath: "/afterglow/events/afterglow-night",
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
            throw new ConvexError({ code: "MCP_WRITE_DENIED" });
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

  it("serves an owner's own drafts and refuses a session without the scope", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const inventory = {
        profiles: [{
          id: "profile_draft",
          slug: "dj-draft",
          profileType: "person",
          displayName: "DJ Draft",
          claimState: "claimed_verified",
          publicationState: "draft_private",
          publicSurfacingState: "opted_out",
          creationSource: "community",
          updatedAt: 7,
        }],
      };

      function authInfo(scopes) {
        return {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes,
          resource: new URL("https://app.example.test/mcp"),
          extra: {
            requestId: "request-123",
            subjectType: "user",
            tokenId: "token-123",
            userId: "user_123",
          },
        };
      }

      async function call(options, id) {
        const handler = createVrdexMcpHandler({
          ...options,
          adminConvex: { mutation: async () => ({}), query: async () => inventory.profiles },
        });
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
            params: { name: "vrdex_list_my_profiles", arguments: {} },
          }),
        }));

        return await response.text();
      }

      const granted = await call({ authInfo: authInfo(["mcp:read", "profile:read"]) }, 31);
      const underScoped = await call({ authInfo: authInfo(["mcp:read"]) }, 32);
      const anonymous = await call({}, 33);

      console.log(JSON.stringify({ anonymous, granted, underScoped }));
    `);
    const result = JSON.parse(output) as {
      anonymous: string;
      granted: string;
      underScoped: string;
    };

    // The whole point of the tool: a profile no public read will ever return,
    // carrying the revision its owner's next update has to pin.
    assert.match(result.granted, /dj-draft/);
    assert.match(result.granted, /"updatedAt":7/);
    // `mcp:read` alone must not reach it. That scope says a hosted session may
    // read; it must not also mean any such session enumerates someone's drafts.
    assert.match(result.underScoped, /user-delegated VRDex OAuth session/);
    assert.doesNotMatch(result.underScoped, /dj-draft/);
    assert.match(result.anonymous, /user-delegated VRDex OAuth session/);
    assert.doesNotMatch(result.anonymous, /dj-draft|never-print-this-token/);
  });

  it("returns owner media inventory without private storage or upload fields", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const profile = {
        id: "profile_media",
        slug: "dj-media",
        profileType: "person",
        displayName: "DJ Media",
        claimState: "claimed_verified",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "self",
        updatedAt: 7,
      };
      const media = {
        profileId: "profile_media",
        profileType: "person",
        slug: "dj-media",
        displayName: "DJ Media",
        mediaVersion: "a".repeat(64),
        activePublicAssetCount: 1,
        assets: [{
          assetId: "asset_123",
          state: "active",
          source: "owner_authored",
          label: "Press photo",
          mimeType: "image/webp",
          byteSize: 1024,
          sourcePreserved: true,
          width: 1200,
          height: 800,
          placements: [{ placement: "gallery", position: 0 }],
        }],
      };
      let queryCount = 0;
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:read", "profile:read"],
          resource: new URL("https://app.example.test/mcp"),
          extra: {
            requestId: "request-123",
            subjectType: "user",
            tokenId: "token-123",
            userId: "user_123",
          },
        },
        adminConvex: {
          mutation: async () => ({}),
          query: async () => ++queryCount === 1 ? profile : media,
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
          id: 34,
          method: "tools/call",
          params: {
            name: "vrdex_list_my_profiles",
            arguments: { mediaSlug: "dj-media" },
          },
        }),
      }));

      console.log(JSON.stringify({ body: await response.text(), queryCount }));
    `);
    const result = JSON.parse(output) as { body: string; queryCount: number };

    assert.equal(result.queryCount, 2);
    assert.match(result.body, /mediaVersion.*a{64}/);
    assert.match(result.body, /assetId.*asset_123/);
    assert.doesNotMatch(
      result.body,
      /storageKey|sourceUrl|uploadToken|processingToken|contentSha256|originalFileName|never-print-this-token/,
    );
  });

  it("imports and updates owner media through one scoped tool with minimal replay fields", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const media = {
        profileId: "profile_media",
        profileType: "person",
        slug: "dj-media",
        displayName: "DJ Media",
        mediaVersion: "b".repeat(64),
        activePublicAssetCount: 1,
        assets: [{
          assetId: "asset_123",
          state: "active",
          source: "owner_authored",
          label: "Press photo",
          mimeType: "image/webp",
          byteSize: 1024,
          sourcePreserved: true,
          placements: [{ placement: "gallery", position: 0 }],
        }],
      };
      const mutationArgs = [];
      const importedIntentIds = [];
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "assets:write"],
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
            mutationArgs.push(args);
            if (args.sourceUrl) {
              return { status: "pending", intentId: "intent_private_123" };
            }
            if (args.expectedMediaVersion) {
              return media;
            }
            return {};
          },
          query: async () => media,
        },
        completeProfileMediaImport: async (intentId) => {
          importedIntentIds.push(intentId);
          return { assetIds: ["asset_123"] };
        },
      });

      async function call(id, args) {
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
            params: { name: "vrdex_profile_media_manage", arguments: args },
          }),
        }));
        return await response.text();
      }

      const added = await call(35, {
        operation: "add_from_url",
        slug: "dj-media",
        expectedMediaVersion: "a".repeat(64),
        idempotencyKey: "operator-key-123",
        sourceUrl: "https://media.example.test/press.webp",
        metadata: { label: "Press photo" },
        placements: ["gallery"],
      });
      const updated = await call(36, {
        operation: "update",
        slug: "dj-media",
        expectedMediaVersion: "b".repeat(64),
        asset: {
          assetId: "asset_123",
          metadata: { caption: null },
          placements: ["gallery", "featured"],
        },
        galleryOrder: ["asset_123"],
      });
      const invalidCredit = await call(37, {
        operation: "update",
        slug: "dj-media",
        expectedMediaVersion: "b".repeat(64),
        asset: {
          assetId: "asset_123",
          metadata: { creditUrl: "ftp://media.example.test/credit" },
        },
      });

      console.log(JSON.stringify({ added, importedIntentIds, invalidCredit, mutationArgs, updated }));
    `);
    const result = JSON.parse(output) as {
      added: string;
      importedIntentIds: string[];
      invalidCredit: string;
      mutationArgs: Array<Record<string, unknown>>;
      updated: string;
    };
    const importMutation = result.mutationArgs.find((args) => "sourceUrl" in args)!;
    const updateMutation = result.mutationArgs.find(
      (args) => "expectedMediaVersion" in args && "asset" in args,
    )!;

    assert.deepEqual(result.importedIntentIds, ["intent_private_123"]);
    assert.match(String(importMutation.idempotencyKeyHash), /^[0-9a-f]{64}$/);
    assert.match(String(importMutation.requestFingerprint), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(importMutation).includes("operator-key-123"), false);
    assert.equal("operation" in importMutation, false);
    assert.equal("idempotencyKey" in updateMutation, false);
    assert.equal("idempotencyKeyHash" in updateMutation, false);
    assert.deepEqual(updateMutation.asset, {
      assetId: "asset_123",
      metadata: { caption: null },
      placements: ["gallery", "featured"],
    });
    assert.match(result.added, /"operation":"add_from_url"/);
    assert.match(result.updated, /"operation":"update"/);
    assert.match(result.invalidCredit, /Credit URL must use HTTP or HTTPS/);
    assert.equal(JSON.stringify(result.mutationArgs).includes("ftp://"), false);
    assert.doesNotMatch(
      result.added + result.updated,
      /intent_private_123|uploadToken|processingToken|storageKey|never-print-this-token/,
    );
  });

  it("submits private profile media proposals and reads only the caller's status", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const submission = {
        submissionId: "submission_123",
        profileSlug: "community-dj",
        profileDisplayName: "Community DJ",
        requestedPlacement: "profile_image",
        status: "submitted",
        createdAt: 1,
        updatedAt: 2,
      };
      const mutationArgs = [];
      const queryArgs = [];
      const importedIntentIds = [];
      const statusAuditResults = [];
      let verificationChecks = 0;
      const prepareCounts = new Map();
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:read", "mcp:write", "assets:contribute"],
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
            if (args.toolName === "vrdex_list_my_media_submissions") {
              statusAuditResults.push(args.result);
              return {};
            }
            mutationArgs.push(args);
            const count = (prepareCounts.get(args.idempotencyKeyHash) ?? 0) + 1;
            prepareCounts.set(args.idempotencyKeyHash, count);
            if (count % 2 === 1) return { status: "verification_required" };
            if (args.sourceUrl.includes("unsupported")) {
              return { status: "failed", errorCode: "MCP_MEDIA_IMPORT_UNSUPPORTED" };
            }
            return { status: "pending", intentId: "intent_private_123", submissionId: "submission_123" };
          },
          query: async (_query, args) => {
            queryArgs.push(args);
            return queryArgs.length === 1
              ? { submissions: [submission] }
              : { submissions: [{ status: "not-a-real-status" }] };
          },
        },
        completeProfileMediaSubmissionImport: async (intentId) => {
          importedIntentIds.push(intentId);
          return { replayed: false, submission };
        },
        verifyContributorEmail: async (actorUserId) => {
          verificationChecks += 1;
          return actorUserId === "user_123";
        },
      });

      async function call(id, name, args) {
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
            params: { name, arguments: args },
          }),
        }));
        return await response.text();
      }

      const submitted = await call(38, "vrdex_profile_media_submit", {
        slug: "community-dj",
        sourceUrl: "https://cdn.discordapp.com/attachments/123/456/press.webp?hm=AbCd&ex=2&is=1&",
        credit: "Artist   press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-123",
      });
      const status = await call(39, "vrdex_list_my_media_submissions", {});
      const invalid = await call(40, "vrdex_profile_media_submit", {
        slug: "community-dj",
        sourceUrl: "https://media.example.test/press.webp",
        credit: "Artist press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-456",
        placement: "gallery",
      });
      const invalidStatus = await call(41, "vrdex_list_my_media_submissions", {});
      const unsupported = await call(42, "vrdex_profile_media_submit", {
        slug: "community-dj",
        sourceUrl: "https://media.example.test/unsupported.bin",
        credit: "Artist press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-unsupported",
      });
      const unsupportedReplay = await call(43, "vrdex_profile_media_submit", {
        slug: "community-dj",
        sourceUrl: "https://media.example.test/unsupported.bin",
        credit: "Artist press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-unsupported",
      });
      await call(44, "vrdex_profile_media_submit", {
        slug: "community-dj",
        sourceUrl: "https://cdn.discordapp.com/attachments/123/456/press.webp?hm=AbCe&ex=2&is=1&",
        credit: "Artist press kit",
        expectedUpdatedAt: 123,
        idempotencyKey: "operator-key-123",
      });
      console.log(JSON.stringify({
        importedIntentIds,
        invalid,
        invalidStatus,
        mutationArgs,
        queryArgs,
        status,
        statusAuditResults,
        submitted,
        unsupported,
        unsupportedReplay,
        verificationChecks,
      }));
    `);
    const result = JSON.parse(output) as {
      importedIntentIds: string[];
      invalid: string;
      invalidStatus: string;
      mutationArgs: Array<Record<string, unknown>>;
      queryArgs: Array<Record<string, unknown>>;
      status: string;
      statusAuditResults: string[];
      submitted: string;
      unsupported: string;
      unsupportedReplay: string;
      verificationChecks: number;
    };

    assert.deepEqual(result.importedIntentIds, ["intent_private_123", "intent_private_123"]);
    assert.equal(result.mutationArgs.length, 8);
    assert.equal(result.verificationChecks, 4);
    assert.equal(result.mutationArgs[0]?.idempotencyKeyHash, result.mutationArgs[6]?.idempotencyKeyHash);
    assert.notEqual(result.mutationArgs[0]?.requestFingerprint, result.mutationArgs[6]?.requestFingerprint);
    assert.deepEqual(result.statusAuditResults, ["accepted", "readback_warning"]);
    assert.equal(result.mutationArgs[0]?.actorUserId, "user_123");
    assert.equal("ownerUserId" in (result.mutationArgs[0] ?? {}), false);
    assert.equal(result.mutationArgs[0]?.sourceUrl, "https://cdn.discordapp.com/attachments/123/456/press.webp?hm=AbCd&ex=2&is=1&");
    assert.equal(result.mutationArgs[0]?.credit, "Artist press kit");
    assert.equal(result.mutationArgs[1]?.emailVerified, true);
    assert.equal(typeof result.mutationArgs[1]?.emailVerificationAttestedAt, "number");
    assert.match(String(result.mutationArgs[0]?.idempotencyKeyHash), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(result.mutationArgs).includes("operator-key-123"), false);
    assert.deepEqual(result.queryArgs, [
      { actorUserId: "user_123" },
      { actorUserId: "user_123" },
    ]);
    assert.match(result.submitted, /"operation":"submit"/);
    assert.match(result.submitted, /"replayed":false/);
    assert.match(result.status, /"submissions"/);
    assert.match(result.status, /"status":"submitted"/);
    assert.match(result.invalid, /unrecognized|invalid/i);
    assert.match(result.invalidStatus, /temporarily unavailable/i);
    assert.match(result.unsupported, /supported valid still image/i);
    assert.match(result.unsupportedReplay, /supported valid still image/i);
    assert.doesNotMatch(
      result.submitted + result.status,
      /intent_private_123|sourceUrl|uploadToken|storageKey|contentSha256|never-print-this-token/,
    );
  });

  it("sends every uncertain media submission back to status and the same key", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";
      import { McpProfileMediaImportError } from "./apps/web/src/lib/server/profile-media-mcp-import.ts";

      let mode = "prepare_uncertain";
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "assets:contribute"],
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
            if (mode === "prepare_uncertain") throw new Error("transport ended mid-prepare");
            if (args.emailVerified === undefined) return { status: "verification_required" };
            if (mode === "processing") return { status: "processing" };
            return { status: "pending", intentId: "intent_private_123", submissionId: "submission_123" };
          },
          query: async () => null,
        },
        completeProfileMediaSubmissionImport: async () => {
          throw new McpProfileMediaImportError("transport ended after maybe committing", "indeterminate");
        },
        verifyContributorEmail: async () => true,
      });

      async function submit(id, key) {
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
              name: "vrdex_profile_media_submit",
              arguments: {
                slug: "community-dj",
                sourceUrl: "https://media.example.test/press.webp",
                credit: "Artist press kit",
                expectedUpdatedAt: 123,
                idempotencyKey: key,
              },
            },
          }),
        }));
        return await response.text();
      }

      const prepareUncertain = await submit(44, "operator-key-prepare");
      mode = "processing";
      const processing = await submit(45, "operator-key-processing");
      mode = "import_uncertain";
      const importUncertain = await submit(46, "operator-key-import");

      console.log(JSON.stringify({ importUncertain, prepareUncertain, processing }));
    `);
    const result = JSON.parse(output) as {
      importUncertain: string;
      prepareUncertain: string;
      processing: string;
    };

    // An unknown commit outcome sends the operator to status and back to the
    // same key. A new key would propose the image a second time.
    assert.match(result.prepareUncertain, /Check your media submission status, then replay only the same idempotency key/);
    assert.doesNotMatch(result.prepareUncertain, /new idempotency key/);

    assert.match(result.processing, /Check your media submission status and do not retry automatically/);
    assert.doesNotMatch(result.processing, /new idempotency key/);

    assert.match(result.importUncertain, /Check your media submission status, then replay only the same idempotency key/);
    assert.doesNotMatch(result.importUncertain, /new idempotency key/);
  });

  it("reports a Clerk verification failure as nothing submitted with same-key retry guidance", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const prepareArgs = [];
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "assets:contribute"],
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
            if (args.toolName !== undefined) return {};
            prepareArgs.push(args);
            return { status: "verification_required" };
          },
          query: async () => null,
        },
        completeProfileMediaSubmissionImport: async () => {
          throw new Error("importer must not run");
        },
        verifyContributorEmail: async () => {
          throw new Error("clerk is unavailable");
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
          id: 47,
          method: "tools/call",
          params: {
            name: "vrdex_profile_media_submit",
            arguments: {
              slug: "community-dj",
              sourceUrl: "https://media.example.test/press.webp",
              credit: "Artist press kit",
              expectedUpdatedAt: 123,
              idempotencyKey: "operator-key-clerk-down",
            },
          },
        }),
      }));
      const body = await response.text();
      const marker = "data: ";
      const markerAt = body.indexOf(marker);
      const payload = markerAt === -1
        ? body
        : body.slice(markerAt + marker.length).split(String.fromCharCode(10))[0];
      const result = JSON.parse(payload).result;

      console.log(JSON.stringify({
        isError: result.isError,
        prepareCalls: prepareArgs.length,
        text: result.content.map((entry) => entry.text).join(" "),
      }));
    `);
    const result = JSON.parse(output) as {
      isError: boolean;
      prepareCalls: number;
      text: string;
    };

    // A Clerk outage before any write is deterministic: nothing landed, so the
    // same key is the only safe retry.
    assert.equal(result.isError, true);
    assert.match(result.text, /nothing was submitted/i);
    assert.match(result.text, /same idempotency key/i);
    assert.doesNotMatch(result.text, /may have started/);
    assert.equal(result.prepareCalls, 1);
  });

  it("rejects stale media updates definitively and does not invoke the importer", () => {
    const output = runMcpProbe(`
      import { ConvexError } from "convex/values";
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      let importerCalled = false;
      const handler = createVrdexMcpHandler({
        authInfo: {
          token: "never-print-this-token",
          clientId: "vrdx_app_test",
          scopes: ["mcp:write", "assets:write"],
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
            if (args.expectedMediaVersion) {
              throw new ConvexError({ code: "MCP_MEDIA_VERSION_CONFLICT" });
            }
            return {};
          },
          query: async () => null,
        },
        completeProfileMediaImport: async () => {
          importerCalled = true;
          return { assetIds: [] };
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
          id: 37,
          method: "tools/call",
          params: {
            name: "vrdex_profile_media_manage",
            arguments: {
              operation: "add_from_url",
              slug: "dj-media",
              expectedMediaVersion: "a".repeat(64),
              idempotencyKey: "operator-key-123",
              sourceUrl: "https://media.example.test/press.webp",
              metadata: { label: "Press photo" },
              placements: ["gallery"],
            },
          },
        }),
      }));

      console.log(JSON.stringify({ body: await response.text(), importerCalled }));
    `);
    const result = JSON.parse(output) as { body: string; importerCalled: boolean };

    assert.equal(result.importerCalled, false);
    assert.match(result.body, /Profile media changed after it was read/);
    assert.match(result.body, /new idempotency key/);
    assert.doesNotMatch(result.body, /may have completed|never-print-this-token/);
  });

  it("confirms a public profile write against the projection the API actually returns", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";
      import { toPublicProfile } from "./convex/_profilePublic.ts";

      const authInfo = {
        token: "never-print-this-token",
        clientId: "vrdx_app_test",
        scopes: ["mcp:write", "profile:write", "profile:contribute"],
        resource: new URL("https://app.example.test/mcp"),
        extra: {
          requestId: "request-123",
          subjectType: "user",
          tokenId: "token-123",
          userId: "user_123",
        },
      };
      const write = {
        profileId: "profile_abc",
        slug: "dj-readback",
        profileType: "person",
        profilePath: "/dj-readback",
        publiclyViewable: true,
      };
      // The real projection, not a stand-in shaped to the assertion: a stub with
      // an id hand-written into it would have passed while every live write came
      // back a warning.
      const saved = toPublicProfile({
        _id: "profile_abc",
        profileType: "person",
        slug: "dj-readback",
        displayName: "DJ Readback",
        sortName: "dj readback",
        aliases: [],
        tags: [],
        outboundLinks: [],
        claimState: "unclaimed",
        publicationState: "published",
        publicSurfacingState: "public",
        creationSource: "community",
        person: { roleTags: ["DJ"] },
        publishedAt: 1,
        updatedAt: 7,
      });

      async function call(query, id) {
        const handler = createVrdexMcpHandler({
          authInfo,
          adminConvex: { mutation: async () => write },
          convex: { query },
        });
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
              name: "vrdex_profile_update",
              arguments: {
                idempotencyKey: "operator-key-123",
                slug: "dj-readback",
                update: { expectedUpdatedAt: 7, headline: "Bass, mostly" },
              },
            },
          }),
        }));

        return await response.text();
      }

      const confirmed = await call(async () => saved, 21);
      const mismatched = await call(async () => ({ ...saved, id: "profile_other" }), 22);

      console.log(JSON.stringify({ confirmed, mismatched }));
    `);
    const result = JSON.parse(output) as { confirmed: string; mismatched: string };

    // The bug this guards: `PublicProfile` is passthrough, so while the
    // projection carried no `id` the identity check compared `undefined` against
    // the saved id and every publicly viewable profile write came back a warning.
    assert.doesNotMatch(result.confirmed, /readback did not complete cleanly/);
    assert.match(result.confirmed, /dj-readback/);
    assert.match(result.mismatched, /accepted the profile write/);
    assert.match(result.mismatched, /did not match the saved profile/);
    assert.match(result.mismatched, /Do not retry the mutation automatically/);
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

  it("refuses client credentials for contributor status before dispatch", () => {
    const output = runMcpProbe(`
      import { generateKeyPairSync } from "node:crypto";
      import { createOAuthAccessTokenId, signOAuthAccessToken } from "./apps/web/src/lib/server/oauth-jwt.ts";
      import { authorizeHostedMcpRequest } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY =
        privateKey.export({ format: "pem", type: "pkcs8" }).toString();
      process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID = "test-key";
      process.env.VRDEX_RATE_LIMIT_STORE = "memory";
      const clientId = "vrdx_app_0123456789abcdef01234567";
      const resource = "https://app.example.test/mcp";
      const tokenId = createOAuthAccessTokenId();
      const accessToken = signOAuthAccessToken({
        aud: resource,
        client_id: clientId,
        exp: Math.floor(Date.now() / 1000) + 60,
        iat: Math.floor(Date.now() / 1000),
        iss: "https://app.example.test",
        jti: tokenId,
        scope: "mcp:read assets:contribute",
        sub: "client_123",
      });
      const request = new Request(resource, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: \`Bearer \${accessToken}\`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 41,
          method: "tools/call",
          params: { name: "vrdex_list_my_media_submissions", arguments: {} },
        }),
      });
      const authorization = await authorizeHostedMcpRequest(request, {
        validateAccessTokenRecord: async () => ({
          ok: true,
          accessTokenRecordId: "token_record_123",
          clientId,
          dynamicClientId: "dynamic_client_123",
          resource,
          scopes: ["mcp:read", "assets:contribute"],
          subjectType: "client",
          tokenId,
          trustTier: "standard",
        }),
      });

      console.log(JSON.stringify({
        body: await authorization.response?.text(),
        status: authorization.response?.status,
      }));
    `);
    const result = JSON.parse(output) as { body: string; status: number };

    assert.equal(result.status, 403);
    assert.match(result.body, /user-delegated OAuth token/);
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
                  routePath: "/afterglow",
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
    assert.match(output, /"url":"https:\/\/app\.example\.test\/afterglow"/);
    assert.match(output, /"text":"Title: Afterglow\\nEntity type: profile/);
    assert.match(output, /"metadata":\{"entityType":"profile","profileType":"community","slug":"afterglow"/);
  });

  it("does not fabricate a root URL for an event without a public community", () => {
    const output = runMcpProbe(`
      import { createVrdexMcpHandler } from "./apps/web/src/lib/server/vrdex-mcp.ts";

      const handler = createVrdexMcpHandler({
        convex: {
          query: async () => ({
            id: "event_123",
            slug: "hidden-host-night",
            title: "Hidden Host Night",
            startAt: 1780000000000,
            source: { label: "Community submitted", sourceType: "community" },
            watchSurfaceEnabled: false,
            mediaLinks: [],
            participantLinks: [],
            slotLinks: [],
            worlds: [],
          }),
        },
      });
      const response = await handler.fetch(new Request("http://localhost:3000/mcp", {
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
            arguments: { id: "event:hidden-host-night" },
            name: "fetch",
          },
        }),
      }));

      console.log(await response.text());
    `);

    assert.match(output, /Search result was not found/);
    assert.doesNotMatch(output, /\/events\/hidden-host-night/);
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
