import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

function runPlan(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/plan-mcp-client-smokes.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

describe("MCP client smoke planner", () => {
  it("prints client-specific VS Code setup hints with the hosted origin for local stdio", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "vscode",
      "--check",
      "local-stdio",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Setup hint/);
    assert.match(result.stdout, /code --profile vrdex-mcp-smoke --add-mcp/);
    assert.match(result.stdout, /"VRDEX_API_BASE_URL":"https:\/\/staging\.vrdex\.net"/);
  });

  it("prints hosted HTTP setup hints for Cursor without treating them as evidence", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "cursor",
      "--check",
      "hosted-anonymous-read",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /cursor --add-mcp/);
    assert.match(result.stdout, /"type":"http"/);
    assert.match(result.stdout, /Configure the current client release against hosted \/mcp and call vrdex_search without a bearer token/);
    assert.match(result.stdout, /--status pass/);
  });

  it("prints OAuth-specific setup guidance for Claude Code", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "claude-code",
      "--check",
      "hosted-oauth",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID=<reviewed-client-id> VRDEX_CLAUDE_CODE_OAUTH_CLIENT_SECRET=<secret> pnpm smoke:mcp-claude-code -- --mode hosted-http --hosted-url https:\/\/staging\.vrdex\.net\/mcp --hosted-data/);
    assert.match(result.stdout, /VRDEX_CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(result.stdout, /claude mcp add --transport http --callback-port 8765 vrdex https:\/\/staging\.vrdex\.net\/mcp/);
    assert.match(result.stdout, /claude mcp login vrdex/);
    assert.match(result.stdout, /Run Claude Code with a reviewed OAuth app client-credentials token acquisition/);
  });

  it("prints client-credentials hosted OAuth setup guidance for MCP Inspector", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "mcp-inspector",
      "--check",
      "hosted-oauth",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_ID/);
    assert.match(result.stdout, /VRDEX_MCP_INSPECTOR_OAUTH_CLIENT_SECRET/);
    assert.match(result.stdout, /VRDEX_MCP_INSPECTOR_OAUTH_TOKEN/);
    assert.match(result.stdout, /pnpm smoke:mcp-inspector -- --hosted-url https:\/\/staging\.vrdex\.net\/mcp --hosted-data/);
    assert.match(result.stdout, /pnpm smoke:mcp-compat -- --hosted-only --hosted-url https:\/\/staging\.vrdex\.net\/mcp --hosted-data --dcr --cimd/);
  });
});
