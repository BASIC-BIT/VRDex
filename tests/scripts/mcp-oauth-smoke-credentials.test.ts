import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { resolvePlaywrightChromium } from "../../scripts/prepare-mcp-oauth-smoke-credentials";

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

  it("prints help without requiring hosted secrets", () => {
    const result = runCredentialHelper(["--help"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ops:mcp-oauth-smoke-credentials/);
    assert.match(result.stdout, /VRDEX_E2E_BROWSER_TOKEN/);
  });

  it("fails closed when the E2E browser token is absent", () => {
    const result = runCredentialHelper(["--base-url", "https://staging.vrdex.net"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VRDEX_E2E_BROWSER_TOKEN is required/);
  });

  it("refuses production origins unless explicitly allowed", () => {
    const result = runCredentialHelper(
      ["--base-url", "https://vrdex.net"],
      { VRDEX_E2E_BROWSER_TOKEN: "test-token" },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to use E2E helpers against production/);
  });
});
