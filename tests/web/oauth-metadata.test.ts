import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runRouteProbe(script: string, env: Record<string, string> = {}) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
    },
  });
}

describe("OAuth metadata routes", () => {
  it("advertises the real issuer endpoints and supported resources", () => {
    const output = runRouteProbe(`
      import { GET } from "./apps/web/src/app/.well-known/oauth-authorization-server/route.ts";

      const response = GET(new Request("https://app.example.test/.well-known/oauth-authorization-server"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"issuer":"https:\/\/app\.example\.test"/);
    assert.match(output, /"authorization_endpoint":"https:\/\/app\.example\.test\/oauth\/authorize"/);
    assert.match(output, /"token_endpoint":"https:\/\/app\.example\.test\/oauth\/token"/);
    assert.match(output, /"registration_endpoint":"https:\/\/app\.example\.test\/oauth\/register"/);
    assert.match(output, /"revocation_endpoint":"https:\/\/app\.example\.test\/oauth\/revoke"/);
    assert.match(output, /"jwks_uri":"https:\/\/app\.example\.test\/oauth\/jwks\.json"/);
    assert.match(output, /"resource_indicators_supported":true/);
    assert.match(output, /"client_id_metadata_document_supported":true/);
    assert.match(output, /"protected_resources":\["https:\/\/app\.example\.test","https:\/\/app\.example\.test\/mcp"\]/);
  });

  it("uses configured issuer, API resource, and MCP resource metadata", () => {
    const output = runRouteProbe(
      `
        import { GET } from "./apps/web/src/app/.well-known/oauth-authorization-server/route.ts";

        const response = GET(new Request("https://app.example.test/.well-known/oauth-authorization-server"));
        console.log(response.status);
        console.log(JSON.stringify(await response.json()));
      `,
      {
        VRDEX_MCP_RESOURCE_URI: "https://mcp.example.test",
        VRDEX_OAUTH_ISSUER_URL: "https://auth.example.test",
        VRDEX_PUBLIC_API_BASE_URL: "https://api.example.test/api/v0",
      },
    );

    assert.match(output, /^200/m);
    assert.match(output, /"issuer":"https:\/\/auth\.example\.test"/);
    assert.match(output, /"authorization_endpoint":"https:\/\/auth\.example\.test\/oauth\/authorize"/);
    assert.match(output, /"protected_resources":\["https:\/\/api\.example\.test","https:\/\/mcp\.example\.test"\]/);
  });

  it("advertises API protected-resource metadata at the base discovery path", () => {
    const output = runRouteProbe(`
      import { GET } from "./apps/web/src/app/.well-known/oauth-protected-resource/route.ts";

      const response = GET(new Request("https://app.example.test/.well-known/oauth-protected-resource"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"resource":"https:\/\/app\.example\.test"/);
    assert.match(output, /"authorization_servers":\["https:\/\/app\.example\.test"\]/);
    assert.match(output, /"scopes_supported":\["public:read"/);
    assert.doesNotMatch(output, /mcp:read/);
    assert.match(output, /"bearer_methods_supported":\["header"\]/);
    assert.match(output, /"resource_name":"VRDex API"/);
  });

  it("advertises MCP protected-resource metadata at its resource-specific path", () => {
    const output = runRouteProbe(`
      import { GET } from "./apps/web/src/app/.well-known/oauth-protected-resource/mcp/route.ts";

      const response = GET(new Request("https://app.example.test/.well-known/oauth-protected-resource"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"resource":"https:\/\/app\.example\.test\/mcp"/);
    assert.match(output, /"authorization_servers":\["https:\/\/app\.example\.test"\]/);
    // Every write scope, so a client can request only the resource it means to
    // write. There is no deployment switch that removes them. `profile:read` is
    // here too: a client that cannot discover it registers without it and is
    // refused by the owned-inventory tool it can see listed.
    assert.match(
      output,
      /"scopes_supported":\["mcp:read","profile:read","mcp:write","events:write","profile:write","profile:contribute"\]/,
    );
    assert.match(output, /"bearer_methods_supported":\["header"\]/);
    assert.match(output, /"resource_name":"VRDex MCP"/);
    assert.match(output, /"resource_documentation":"https:\/\/app\.example\.test\/developers\/api"/);
  });

  it("serves constrained public MCP client metadata for CIMD smoke tests", () => {
    const output = runRouteProbe(`
      import { GET } from "./apps/web/src/app/.well-known/oauth-client/vrdex-mcp-public-client/route.ts";

      const response = GET(new Request("https://app.example.test/.well-known/oauth-client/vrdex-mcp-public-client"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"client_id":"https:\/\/app\.example\.test\/\.well-known\/oauth-client\/vrdex-mcp-public-client"/);
    assert.match(output, /"client_name":"VRDex MCP Public Client"/);
    assert.match(output, /"redirect_uris":\["http:\/\/localhost:8765\/callback"\]/);
    assert.match(output, /"grant_types":\["authorization_code","refresh_token"\]/);
    assert.match(output, /"response_types":\["code"\]/);
    assert.match(output, /"token_endpoint_auth_method":"none"/);
    assert.match(output, /"scope":"mcp:read public:read"/);
  });
});
