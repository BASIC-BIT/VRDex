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
  it("groups open manual rows by the operator prerequisite that unblocks them", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /## Open Blocker Summary/);
    assert.match(result.stdout, /OAuth smoke credentials/);
    assert.match(result.stdout, /`claude-code\/hosted-oauth`, `mcp-inspector\/hosted-oauth`/);
    assert.match(result.stdout, /Missing client install or account setup/);
    assert.match(result.stdout, /`gemini-cli\/local-stdio`, `gemini-cli\/hosted-anonymous-read`, `gemini-cli\/hosted-oauth`/);
    assert.match(result.stdout, /Installed app tool-call session/);
    assert.match(result.stdout, /`vscode\/local-stdio`, `vscode\/hosted-anonymous-read`/);
    assert.match(result.stdout, /Installed app OAuth session/);
    assert.match(result.stdout, /`vscode\/hosted-oauth`, `cursor\/hosted-oauth`, `devin-windsurf\/hosted-oauth`/);
    assert.match(result.stdout, /Desktop or custom connector session/);
    assert.match(result.stdout, /`claude-desktop\/local-stdio`, `claude-desktop\/hosted-anonymous-read`, `claude-desktop\/hosted-oauth`/);
    assert.match(result.stdout, /OpenAI API key or hosted product surface access/);
    assert.match(result.stdout, /`openai-chatgpt\/hosted-anonymous-read`, `openai-chatgpt\/hosted-oauth`/);
  });

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
    assert.match(result.stdout, /code --user-data-dir \.tmp-gh-artifacts\/mcp-client-smoke-session\/user-data\/vscode --add-mcp \$mcpJson/);
    assert.doesNotMatch(result.stdout, /--profile vrdex-mcp-smoke/);
    assert.match(result.stdout, /\\?"VRDEX_API_BASE_URL\\?":\\?"https:\/\/staging\.vrdex\.net\\?"/);
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
    assert.match(result.stdout, /cursor --user-data-dir \.tmp-gh-artifacts\/mcp-client-smoke-session\/user-data\/cursor --add-mcp \$mcpJson/);
    assert.match(result.stdout, /\\?"type\\?":\\?"http\\?"/);
    assert.match(result.stdout, /Configure the current client release against hosted \/mcp and call vrdex_search without a bearer token/);
    assert.match(result.stdout, /--status pass/);
  });

  it("prints OpenAI Responses API hosted anonymous guidance separately from ChatGPT UI evidence", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "openai-chatgpt",
      "--check",
      "hosted-anonymous-read",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OPENAI_API_KEY=<api-key> pnpm smoke:mcp-openai -- --hosted-url https:\/\/staging\.vrdex\.net\/mcp --hosted-data/);
    assert.match(result.stdout, /Responses API remote MCP search\/fetch integration evidence/);
    assert.match(result.stdout, /ChatGPT Apps\/Connectors UI evidence separately/);
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
    assert.match(result.stdout, /ops:mcp-hosted-oauth-prereqs/);
  });

  it("prints Gemini CLI settings guidance for Streamable HTTP OAuth", () => {
    const result = runPlan([
      "--hosted-url",
      "https://staging.vrdex.net/mcp",
      "--client",
      "gemini-cli",
      "--check",
      "hosted-oauth",
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Gemini CLI/);
    assert.match(result.stdout, /"httpUrl":"https:\/\/staging\.vrdex\.net\/mcp"/);
    assert.match(result.stdout, /\/mcp auth vrdex/);
    assert.match(result.stdout, /Dynamic Client Registration|DCR/);
    assert.match(result.stdout, /ops:mcp-hosted-oauth-prereqs/);
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
    assert.match(result.stdout, /ops:mcp-hosted-oauth-prereqs/);
  });
});
