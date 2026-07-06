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

describe("VRDex MCP server", () => {
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
      /Bearer resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource", scope="mcp:read", error="invalid_token"/,
    );
    assert.match(output, /OAuth bearer token is invalid/);
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
      /Bearer resource_metadata="https:\/\/app\.example\.test\/\.well-known\/oauth-protected-resource", scope="mcp:read", error="insufficient_scope"/,
    );
    assert.match(output, /OAuth bearer token scope is insufficient/);
  });
});
