import { defineConfig, devices } from "@playwright/test";

import baseConfig from "./playwright.config.mjs";

process.env.VRDEX_AUTH_MATRIX_RUN_ID ??= `${Date.now()}-${process.pid}`;

const authProject = (name, device, dependencies = []) => ({
  name,
  dependencies,
  testMatch: "auth-session.flow.spec.ts",
  grep: /@auth-session-matrix/,
  use: {
    ...device,
    serviceWorkers: "block",
  },
});

export default defineConfig({
  ...baseConfig,
  failOnFlakyTests: true,
  fullyParallel: false,
  globalTeardown: "./e2e/auth-session-matrix.global-teardown.ts",
  retries: 1,
  workers: 1,
  projects: [
    authProject("auth-chromium", devices["Desktop Chrome"]),
    authProject(
      "auth-firefox",
      devices["Desktop Firefox"],
      ["auth-chromium"],
    ),
    authProject(
      "auth-webkit",
      devices["Desktop Safari"],
      ["auth-firefox"],
    ),
  ],
});
