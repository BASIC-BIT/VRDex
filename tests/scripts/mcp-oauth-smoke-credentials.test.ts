import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import {
  parseMcpOAuthVerificationResponse,
  parseOAuthTokenResponse,
  resolvePlaywrightChromium,
} from "../../scripts/prepare-mcp-oauth-smoke-credentials";

function runCredentialHelper(args: string[], env: NodeJS.ProcessEnv = {}) {
  const mergedEnv = { ...process.env, ...env };

  if (!("VRDEX_E2E_BROWSER_TOKEN" in env)) {
    delete mergedEnv.VRDEX_E2E_BROWSER_TOKEN;
  }

  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/prepare-mcp-oauth-smoke-credentials.ts", "--", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: mergedEnv,
    },
  );
}

describe("MCP OAuth smoke credential helper", () => {
  it("loads Chromium from direct ESM and CommonJS-default Playwright exports", () => {
    const directChromium = { source: "direct" };
    const defaultChromium = { source: "default" };

    assert.equal(resolvePlaywrightChromium({ chromium: directChromium }).chromium, directChromium);
    assert.equal(resolvePlaywrightChromium({ default: { chromium: defaultChromium } }).chromium, defaultChromium);
    assert.throws(
      () => resolvePlaywrightChromium({}),
      /does not expose chromium directly or through its default export/,
    );
  });

  it("reports token endpoint HTTP and response-shape failures clearly", () => {
    assert.throws(
      () => parseOAuthTokenResponse({ ok: false, status: 500, text: "" }),
      /failed with HTTP 500: <empty response body>/,
    );
    assert.throws(
      () => parseOAuthTokenResponse({ ok: true, status: 200, text: "not-json" }),
      /returned non-JSON with HTTP 200: not-json/,
    );
    assert.deepEqual(parseOAuthTokenResponse({ ok: true, status: 200, text: '{"token_type":"Bearer"}' }), {
      token_type: "Bearer",
    });
  });

  it("requires the issued bearer token to authenticate against hosted MCP", () => {
    assert.throws(
      () => parseMcpOAuthVerificationResponse({ ok: false, status: 401, text: "" }),
      /failed with HTTP 401: <empty response body>/,
    );
    assert.throws(
      () => parseMcpOAuthVerificationResponse({ ok: true, status: 200, text: "not-json" }),
      /returned no JSON or SSE data: not-json/,
    );
    assert.throws(
      () => parseMcpOAuthVerificationResponse({ ok: true, status: 200, text: '{"result":{}}' }),
      /did not return a tools array/,
    );
    assert.deepEqual(
      parseMcpOAuthVerificationResponse({
        ok: true,
        status: 200,
        text: '{"jsonrpc":"2.0","id":"smoke","result":{"tools":[]}}',
      }),
      { jsonrpc: "2.0", id: "smoke", result: { tools: [] } },
    );
    assert.deepEqual(
      parseMcpOAuthVerificationResponse({
        ok: true,
        status: 200,
        text: 'event: message\ndata: {"jsonrpc":"2.0","id":"smoke","result":{"tools":[]}}\n\n',
      }),
      { jsonrpc: "2.0", id: "smoke", result: { tools: [] } },
    );
  });

  it("prints help without requiring hosted secrets", () => {
    const result = runCredentialHelper(["--help"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ops:mcp-oauth-smoke-credentials/);
    assert.match(result.stdout, /VRDEX_E2E_BROWSER_TOKEN/);
  });

  it("refuses to run at all until it is ported to Clerk", () => {
    const result = runCredentialHelper(
      ["--base-url", "https://staging.vrdex.net"],
      { VRDEX_E2E_BROWSER_TOKEN: "test-token" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is unavailable/);
    assert.match(result.stderr, /#226/);
  });

  // The two guards below are the reason the retirement is a condition rather
  // than a bare throw: they are real safety behaviour that has to survive the
  // port, so they stay exercised against the original code path instead of
  // being deleted and rewritten later from memory.
  const ported = { VRDEX_MCP_SMOKE_GENERATOR_PORTED: "true" };

  it("fails closed when the E2E browser token is absent", () => {
    const result = runCredentialHelper(["--base-url", "https://staging.vrdex.net"], ported);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VRDEX_E2E_BROWSER_TOKEN is required/);
  });

  it("refuses production origins unless explicitly allowed", () => {
    const result = runCredentialHelper(
      ["--base-url", "https://vrdex.net"],
      { ...ported, VRDEX_E2E_BROWSER_TOKEN: "test-token" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to use E2E helpers against production/);
  });
});
