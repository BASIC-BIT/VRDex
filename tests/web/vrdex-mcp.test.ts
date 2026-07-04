import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function runMcpProbe(script: string) {
  return execFileSync(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
    },
  });
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
  });
});
