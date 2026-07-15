import assert from "node:assert/strict";
import test from "node:test";

import { loadVrdexMcpConfig, normalizeApiBaseUrl } from "../src/config";

test("normalizes hosted and self-hosted API base URLs", () => {
  assert.equal(normalizeApiBaseUrl(undefined), "https://vrdex.net/api/v0");
  assert.equal(normalizeApiBaseUrl("https://vrdex.example"), "https://vrdex.example/api/v0");
  assert.equal(normalizeApiBaseUrl("https://vrdex.example/root/"), "https://vrdex.example/root/api/v0");
  assert.equal(normalizeApiBaseUrl("https://vrdex.example/api/v0/"), "https://vrdex.example/api/v0");
});

test("loads direct bearer credentials and output mode from environment", () => {
  const config = loadVrdexMcpConfig({
    VRDEX_API_BASE_URL: "https://self-hosted.example",
    VRDEX_API_TOKEN: "  vrdx_test_token  ",
    VRDEX_MCP_OUTPUT_MODE: "detail",
  });

  assert.deepEqual(config, {
    apiBaseUrl: "https://self-hosted.example/api/v0",
    bearerToken: "vrdx_test_token",
    outputMode: "detail",
  });
});

test("loads OAuth access token JSON from a local token file", () => {
  const config = loadVrdexMcpConfig(
    {
      VRDEX_PUBLIC_API_BASE_URL: "http://127.0.0.1:3000/api/v0",
      VRDEX_OAUTH_TOKEN_FILE: "tokens.json",
    },
    {
      readTokenFile(path) {
        assert.equal(path, "tokens.json");

        return JSON.stringify({ access_token: "oauth_access_token" });
      },
    },
  );

  assert.equal(config.apiBaseUrl, "http://127.0.0.1:3000/api/v0");
  assert.equal(config.bearerToken, "oauth_access_token");
  assert.equal(config.outputMode, "compact");
});
