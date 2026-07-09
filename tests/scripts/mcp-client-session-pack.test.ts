import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

function runSessionPack(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-mcp-client-smoke-session.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

describe("MCP client smoke session pack", () => {
  it("writes disposable VS Code-family and Gemini CLI MCP configs with recorder guidance", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "vrdex-mcp-client-session-"));

    try {
      const result = runSessionPack([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--output-dir",
        outputDir,
        "--target-environment",
        "staging https://staging.vrdex.net/mcp",
      ]);

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /MCP client smoke session pack/);
      assert.match(result.stdout, /Open required worksheet coverage \| 19 rows/);

      const readme = await readFile(join(outputDir, "README.md"), "utf8");

      assert.match(readme, /## VS Code/);
      assert.match(readme, /Record a pass only after the real client lists tools and calls the expected public read tool/);
      assert.match(readme, /`search` plus `fetch` for OpenAI\/ChatGPT surfaces/);
      assert.match(readme, /record a fail only with sanitized evidence of the exact client-side blocker/);
      assert.match(readme, /## Cursor/);
      assert.match(readme, /## Windsurf/);
      assert.match(readme, /## Gemini CLI/);
      assert.match(readme, /## Manual-Only Evidence Rows/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client vscode --check local-stdio/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client cursor --check hosted-anonymous-read/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client devin-windsurf --check hosted-oauth/);
      assert.match(readme, /pnpm record:mcp-client-smoke -- --client gemini-cli --check hosted-oauth/);
      assert.match(readme, /evidence[\\/]claude-desktop-local-stdio\.md/);
      assert.match(readme, /evidence[\\/]openai-chatgpt-hosted-anonymous-read\.md/);
      assert.match(readme, /evidence[\\/]mcp-inspector-hosted-oauth\.md/);
      assert.match(readme, /Get-Content -Raw/);
      assert.match(readme, /\.Trim\(\)\.Replace/);
      assert.match(readme, /--user-data-dir/);
      assert.match(readme, /isolated user-data/);
      assert.match(readme, /user-data[\\/]vscode[\\/]local-stdio/);
      assert.match(readme, /user-data[\\/]cursor[\\/]hosted-anonymous-read/);
      assert.match(readme, /user-data[\\/]windsurf[\\/]hosted-oauth-token-fallback/);
      assert.doesNotMatch(readme, /--profile vrdex-mcp-smoke/);
      assert.match(readme, /\/mcp auth vrdex/);
      assert.match(readme, /Generated Evidence Templates/);
      assert.match(readme, /## Open Blocker Summary/);
      assert.match(readme, /OAuth smoke credentials/);
      assert.match(readme, /`claude-code\/hosted-oauth`, `mcp-inspector\/hosted-oauth`/);
      assert.match(readme, /Missing client install or account setup/);
      assert.match(readme, /`gemini-cli\/local-stdio`, `gemini-cli\/hosted-anonymous-read`, `gemini-cli\/hosted-oauth`/);
      assert.match(readme, /Installed app tool-call session/);
      assert.match(readme, /`vscode\/local-stdio`, `vscode\/hosted-anonymous-read`/);
      assert.match(readme, /OpenAI-compatible hosted target or product surface access/);
      assert.match(readme, /`openai-chatgpt\/hosted-anonymous-read`, `openai-chatgpt\/hosted-oauth`/);
      assert.match(readme, /Open Matrix Worksheet Coverage/);
      assert.match(readme, /Open required rows covered by generated worksheets: 19/);
      assert.match(readme, /evidence[\\/]vscode-local-stdio\.md/);
      assert.match(readme, /evidence[\\/]gemini-cli-hosted-oauth\.md/);
      assert.match(readme, /ops:mcp-hosted-oauth-prereqs/);

      const localConfig = JSON.parse(
        await readFile(join(outputDir, "configs", "vscode-local-stdio.add-mcp.json"), "utf8"),
      ) as {
        args?: string[];
        env?: Record<string, string>;
        name?: string;
      };

      assert.equal(localConfig.name, "vrdex");
      assert.equal(localConfig.env?.VRDEX_API_BASE_URL, "https://staging.vrdex.net");
      assert.deepEqual(localConfig.args?.slice(-3), ["exec", "tsx", "packages/vrdex-mcp/src/stdio.ts"]);

      const hostedTokenConfig = JSON.parse(
        await readFile(join(outputDir, "configs", "windsurf-hosted-token.add-mcp.json"), "utf8"),
      ) as {
        headers?: Record<string, string>;
        type?: string;
        url?: string;
      };

      assert.equal(hostedTokenConfig.type, "http");
      assert.equal(hostedTokenConfig.url, "https://staging.vrdex.net/mcp");
      assert.equal(hostedTokenConfig.headers?.Authorization, "Bearer <mcp-resource-token>");

      const geminiLocalSettings = JSON.parse(
        await readFile(join(outputDir, "configs", "gemini-cli-local-stdio.settings.json"), "utf8"),
      ) as {
        mcp?: { allowed?: string[] };
        mcpServers?: {
          vrdex?: {
            args?: string[];
            command?: string;
            env?: Record<string, string>;
            name?: string;
            timeout?: number;
            trust?: boolean;
          };
        };
      };

      assert.deepEqual(geminiLocalSettings.mcp?.allowed, ["vrdex"]);
      assert.equal(geminiLocalSettings.mcpServers?.vrdex?.name, undefined);
      assert.equal(geminiLocalSettings.mcpServers?.vrdex?.env?.VRDEX_API_BASE_URL, "https://staging.vrdex.net");
      assert.deepEqual(geminiLocalSettings.mcpServers?.vrdex?.args?.slice(-3), [
        "exec",
        "tsx",
        "packages/vrdex-mcp/src/stdio.ts",
      ]);
      assert.equal(geminiLocalSettings.mcpServers?.vrdex?.timeout, 600_000);
      assert.equal(geminiLocalSettings.mcpServers?.vrdex?.trust, false);

      const geminiHostedSettings = JSON.parse(
        await readFile(join(outputDir, "configs", "gemini-cli-hosted-http.settings.json"), "utf8"),
      ) as {
        mcpServers?: {
          vrdex?: {
            httpUrl?: string;
            timeout?: number;
            trust?: boolean;
          };
        };
      };

      assert.equal(geminiHostedSettings.mcpServers?.vrdex?.httpUrl, "https://staging.vrdex.net/mcp");
      assert.equal(geminiHostedSettings.mcpServers?.vrdex?.timeout, 600_000);
      assert.equal(geminiHostedSettings.mcpServers?.vrdex?.trust, false);

      const geminiHostedTokenSettings = JSON.parse(
        await readFile(join(outputDir, "configs", "gemini-cli-hosted-token.settings.json"), "utf8"),
      ) as {
        mcpServers?: {
          vrdex?: {
            headers?: Record<string, string>;
          };
        };
      };

      assert.equal(
        geminiHostedTokenSettings.mcpServers?.vrdex?.headers?.Authorization,
        "Bearer <mcp-resource-token>",
      );

      const vscodeEvidence = await readFile(join(outputDir, "evidence", "vscode-local-stdio.md"), "utf8");

      assert.match(vscodeEvidence, /Status: pending until a real client session lists tools/);
      assert.match(vscodeEvidence, /Matrix row: vscode\/local-stdio/);
      assert.match(vscodeEvidence, /Client lists the expected VRDex tools/);
      assert.match(vscodeEvidence, /For `pass`, include the tool list/);
      assert.match(vscodeEvidence, /For `fail`, include the exact failed step/);
      assert.match(vscodeEvidence, /--evidence-file/);
      assert.match(vscodeEvidence, /pnpm record:mcp-client-smoke -- --client vscode --check local-stdio/);
      assert.doesNotMatch(vscodeEvidence, /--target-environment "staging https:\/\/staging\.vrdex\.net\/mcp"/);

      const geminiHostedEvidence = await readFile(
        join(outputDir, "evidence", "gemini-cli-hosted-oauth.md"),
        "utf8",
      );

      assert.match(geminiHostedEvidence, /Matrix row: gemini-cli\/hosted-oauth/);
      assert.match(geminiHostedEvidence, /Target environment: staging https:\/\/staging\.vrdex\.net\/mcp/);
      assert.match(geminiHostedEvidence, /No bearer tokens, OAuth client secrets/);
      assert.match(geminiHostedEvidence, /Hosted OAuth Prerequisite Audit/);
      assert.match(geminiHostedEvidence, /pnpm ops:mcp-hosted-oauth-prereqs/);
      assert.match(geminiHostedEvidence, /--evidence-file/);
      assert.match(geminiHostedEvidence, /pnpm record:mcp-client-smoke -- --client gemini-cli --check hosted-oauth/);

      const claudeCodeOauthEvidence = await readFile(
        join(outputDir, "evidence", "claude-code-hosted-oauth.md"),
        "utf8",
      );

      assert.match(claudeCodeOauthEvidence, /Matrix row: claude-code\/hosted-oauth/);
      assert.match(claudeCodeOauthEvidence, /VRDEX_CLAUDE_CODE_OAUTH_CLIENT_ID/);
      assert.match(claudeCodeOauthEvidence, /ops:mcp-hosted-oauth-prereqs -- --require-ready/);
      assert.match(claudeCodeOauthEvidence, /--evidence-file/);
      assert.match(claudeCodeOauthEvidence, /Target environment: staging https:\/\/staging\.vrdex\.net\/mcp/);

      const openAiAnonymousEvidence = await readFile(
        join(outputDir, "evidence", "openai-chatgpt-hosted-anonymous-read.md"),
        "utf8",
      );

      assert.match(openAiAnonymousEvidence, /Matrix row: openai-chatgpt\/hosted-anonymous-read/);
      assert.match(openAiAnonymousEvidence, /pnpm smoke:mcp-openai -- --hosted-url https:\/\/staging\.vrdex\.net\/mcp --hosted-data/);
      assert.match(openAiAnonymousEvidence, /repo-root \.env\.local/);
      assert.match(openAiAnonymousEvidence, /OpenAI Responses API or ChatGPT hosted MCP surface/);
      assert.match(openAiAnonymousEvidence, /anonymous\/no-auth tools/);
      assert.match(openAiAnonymousEvidence, /Client calls `search` with query `club`/);
      assert.match(openAiAnonymousEvidence, /Client calls `fetch` with the first returned result id/);
      assert.match(openAiAnonymousEvidence, /does not force login before the anonymous public-read call/);
      assert.match(openAiAnonymousEvidence, /No bearer tokens, OAuth client secrets/);
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });

  it("fails when an open required matrix row has no generated worksheet", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "vrdex-mcp-client-session-"));
    const matrixPath = join(outputDir, "matrix.json");
    const matrix = JSON.parse(await readFile("docs/developers/mcp-client-smoke-results.json", "utf8")) as {
      clients: Array<{
        checks: Array<{
          id: string;
          manualStatus: string;
          requiredForExternalReadiness: boolean;
        }>;
        id: string;
        name: string;
      }>;
      schemaVersion: 1;
    };

    matrix.clients.push({
      checks: [
        {
          id: "hosted-anonymous-read",
          manualStatus: "pending",
          requiredForExternalReadiness: true,
        },
      ],
      id: "future-client",
      name: "Future MCP Client",
    });

    await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);

    try {
      const result = runSessionPack([
        "--hosted-url",
        "https://staging.vrdex.net/mcp",
        "--output-dir",
        join(outputDir, "pack"),
        "--target-environment",
        "staging https://staging.vrdex.net/mcp",
        "--matrix",
        matrixPath,
      ]);

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /missing evidence worksheets/);
      assert.match(result.stderr, /future-client\/hosted-anonymous-read/);
    } finally {
      await rm(outputDir, { force: true, recursive: true });
    }
  });
});
