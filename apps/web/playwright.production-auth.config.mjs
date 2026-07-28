import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

import baseConfig from "./playwright.config.mjs";

export default defineConfig({
  ...baseConfig,
  testMatch: "production-auth.smoke.spec.ts",
  grep: /@production-auth-one-shot/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["null"]],
  outputDir: path.join(tmpdir(), "vrdex-production-auth-playwright-output"),
  use: {
    ...baseConfig.use,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "production-auth-chromium",
      use: {
        ...devices["Desktop Chrome"],
        trace: "off",
        screenshot: "off",
        video: "off",
      },
    },
  ],
});
