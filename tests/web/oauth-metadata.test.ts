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

  it("advertises MCP protected-resource metadata for hosted OAuth", () => {
    const output = runRouteProbe(`
      import { GET } from "./apps/web/src/app/.well-known/oauth-protected-resource/route.ts";

      const response = GET(new Request("https://app.example.test/.well-known/oauth-protected-resource"));
      console.log(response.status);
      console.log(JSON.stringify(await response.json()));
    `);

    assert.match(output, /^200/m);
    assert.match(output, /"resource":"https:\/\/app\.example\.test\/mcp"/);
    assert.match(output, /"authorization_servers":\["https:\/\/app\.example\.test"\]/);
    assert.match(output, /"scopes_supported":\["mcp:read"\]/);
    assert.match(output, /"bearer_methods_supported":\["header"\]/);
    assert.match(output, /"resource_name":"VRDex MCP"/);
    assert.match(output, /"resource_documentation":"https:\/\/app\.example\.test\/developers\/api"/);
  });
});
