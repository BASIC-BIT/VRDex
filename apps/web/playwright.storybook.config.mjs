import { defineConfig, devices } from "@playwright/test";

const parsedPort = Number(process.env.PLAYWRIGHT_STORYBOOK_PORT);
const port = Number.isFinite(parsedPort) ? parsedPort : 6006;
const hostedBaseURL = process.env.PLAYWRIGHT_STORYBOOK_URL?.trim().replace(/\/+$/, "");
const baseURL = hostedBaseURL || `http://127.0.0.1:${port}`;
const skipStorybookServer = process.env.PLAYWRIGHT_SKIP_STORYBOOK === "true" || Boolean(hostedBaseURL);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-storybook" }]],
  expect: {
    toHaveScreenshot: {
      pathTemplate: "{testDir}/__screenshots__{/projectName}/{arg}{ext}",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.PLAYWRIGHT_RECORD_VIDEO === "true" ? "on" : "retain-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  webServer: skipStorybookServer
    ? []
    : [
        {
          command: `pnpm exec storybook dev --ci --host 127.0.0.1 --port ${port}`,
          cwd: ".",
          url: baseURL,
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_STORYBOOK === "true",
          timeout: 180_000,
        },
      ],
  projects: [
    {
      name: "storybook-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "storybook-mobile",
      use: {
        ...devices["Pixel 7"],
      },
    },
  ],
});
