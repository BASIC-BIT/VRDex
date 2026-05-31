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
const localJwtKeys = hostedBaseURL
  ? {}
  : (() => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwtPrivateKey = privateKey.export({ format: "pem", type: "pkcs8" }).toString().trimEnd().replace(/\n/g, " ");
      const jwk = publicKey.export({ format: "jwk" });

      return {
        JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY ?? jwtPrivateKey,
        JWKS: process.env.JWKS ?? JSON.stringify({ keys: [{ use: "sig", ...jwk }] }),
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
      VRDEX_E2E_BROWSER_TOKEN: process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token",
      VRDEX_E2E_CONVEX_SECRET: process.env.VRDEX_E2E_CONVEX_SECRET ?? "local-convex-e2e-secret",
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
  ...localJwtKeys,
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
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
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
            command: `node ../../scripts/sync-convex-local-env.mjs && node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
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
