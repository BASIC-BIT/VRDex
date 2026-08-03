import { defineConfig, devices } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, "..", "..");
const parsedPort = Number(process.env.PLAYWRIGHT_TEST_PORT);
const port = Number.isFinite(parsedPort) ? parsedPort : 3002;
const hostedBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim().replace(/\/+$/, "");
const baseURL = hostedBaseURL || `http://127.0.0.1:${port}`;
const convexUrl = process.env.PLAYWRIGHT_CONVEX_URL ?? "http://127.0.0.1:3210";
const convexPort = Number(new URL(convexUrl).port) || 3210;
const reuseNextServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";
const reuseConvexServer = process.env.PLAYWRIGHT_REUSE_CONVEX === "true";
const skipWebServers = process.env.PLAYWRIGHT_SKIP_WEBSERVERS === "true" || Boolean(hostedBaseURL);
const skipConvexServer = skipWebServers || process.env.PLAYWRIGHT_SKIP_CONVEX_DEV === "true";
const recordVideo = process.env.PLAYWRIGHT_RECORD_VIDEO === "true";
const e2eHelpersEnabled = process.env.VRDEX_ENABLE_E2E_HELPERS ?? (hostedBaseURL ? undefined : "true");
const localApiCredentialEnv = hostedBaseURL
  ? {}
  : (() => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const oauthSigningKey = privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString()
        .trimEnd()
        .replace(/\n/g, "\\n");

      return {
        VRDEX_API_TOKEN_PEPPER: process.env.VRDEX_API_TOKEN_PEPPER ?? "local-playwright-api-token-pepper",
        VRDEX_OAUTH_CLIENT_SECRET_PEPPER:
          process.env.VRDEX_OAUTH_CLIENT_SECRET_PEPPER ?? "local-playwright-oauth-client-secret-pepper",
        VRDEX_OAUTH_REFRESH_TOKEN_PEPPER:
          process.env.VRDEX_OAUTH_REFRESH_TOKEN_PEPPER ?? "local-playwright-oauth-refresh-token-pepper",
        VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY:
          process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KEY ?? oauthSigningKey,
        VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID:
          process.env.VRDEX_OAUTH_ACCESS_TOKEN_SIGNING_KID ?? "local-playwright-oauth",
        VRDEX_OAUTH_ISSUER_URL: process.env.VRDEX_OAUTH_ISSUER_URL ?? baseURL,
        VRDEX_PUBLIC_API_BASE_URL: process.env.VRDEX_PUBLIC_API_BASE_URL ?? baseURL,
        VRDEX_MCP_RESOURCE_URI: process.env.VRDEX_MCP_RESOURCE_URI ?? `${baseURL}/mcp`,
        VRDEX_RATE_LIMIT_STORE: process.env.VRDEX_RATE_LIMIT_STORE ?? "memory",
      };
    })();
const allowFixtureSearchFallthrough =
  process.env.VRDEX_ALLOW_PLAYWRIGHT_FIXTURE_SEARCH_FALLTHROUGH === "true" ||
  e2eHelpersEnabled === "true";
const localE2eHelperEnv = hostedBaseURL
  ? {}
  : {
      VRDEX_ENABLE_E2E_HELPERS: e2eHelpersEnabled ?? "true",
      VRDEX_ENABLE_E2E_AUTH_HELPERS: process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS ?? "true",
      VRDEX_ENABLE_E2E_ADAPTER_HELPERS: process.env.VRDEX_ENABLE_E2E_ADAPTER_HELPERS ?? "true",
      VRDEX_E2E_BROWSER_TOKEN: process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token",
      VRDEX_E2E_CONVEX_SECRET: process.env.VRDEX_E2E_CONVEX_SECRET ?? "local-convex-e2e-secret",
      DISCORD_API_BASE_URL: process.env.DISCORD_API_BASE_URL ?? `${baseURL}/api/e2e/adapters/discord`,
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN ?? "local-discord-adapter-token",
      VRCHAT_PROOF_ADAPTER_URL: process.env.VRCHAT_PROOF_ADAPTER_URL ?? `${baseURL}/api/e2e/adapters/vrchat-proof`,
      VRCLINKING_PROOF_ADAPTER_URL: process.env.VRCLINKING_PROOF_ADAPTER_URL ?? `${baseURL}/api/e2e/adapters/vrchat-proof`,
      VRCHAT_PROOF_ADAPTER_BEARER_TOKEN: process.env.VRCHAT_PROOF_ADAPTER_BEARER_TOKEN ?? "local-proof-adapter-token",
      VRCLINKING_ADAPTER_CAPABILITY_KEY:
        process.env.VRCLINKING_ADAPTER_CAPABILITY_KEY ?? "local-vrclinking-capability-key",
    };

if (!hostedBaseURL) {
  process.env.CONVEX_URL = convexUrl;
  process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl;
}

const sharedEnv = {
  ...process.env,
  CONVEX_URL: convexUrl,
  NEXT_PUBLIC_CONVEX_URL: convexUrl,
  SITE_URL: process.env.SITE_URL ?? baseURL,
  ...localApiCredentialEnv,
  VRDEX_ENABLE_PLAYWRIGHT_FIXTURES: "true",
  ...localE2eHelperEnv,
  ...(allowFixtureSearchFallthrough
    ? { VRDEX_ALLOW_PLAYWRIGHT_FIXTURE_SEARCH_FALLTHROUGH: "true" }
    : {}),
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  // Overridable so two Playwright runs in one job do not share these. Playwright
  // clears both when a run starts, so the staging deploy's second invocation was
  // deleting the first run's report, traces, and always-recorded videos before
  // the upload step collected them — the artifact showed only the later run.
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.PLAYWRIGHT_HTML_REPORT_DIR ?? "playwright-report",
      },
    ],
  ],
  expect: {
    toHaveScreenshot: {
      pathTemplate: "{testDir}/__screenshots__{/projectName}/{arg}{ext}",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: recordVideo ? "on" : "retain-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  webServer: [
    ...(skipConvexServer
      ? []
      : [
          {
            command: "node scripts/run-convex-local.mjs dev --local",
            cwd: repoRoot,
            port: convexPort,
            reuseExistingServer: reuseConvexServer,
            timeout: 300_000,
            env: sharedEnv,
          },
        ]),
    ...(skipWebServers
      ? []
      : [
          {
            command: `node ../../scripts/sync-convex-local-env.mjs && node ../../scripts/run-next-with-convex-local-admin.mjs dev --webpack --hostname 127.0.0.1 --port ${port}`,
            cwd: configDir,
            url: baseURL,
            reuseExistingServer: reuseNextServer,
            timeout: 300_000,
            env: sharedEnv,
          },
        ]),
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
