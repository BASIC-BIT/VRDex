import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";
import { captureRouteScreenshot } from "./public-routes";
import { captureStorybookScreenshot } from "./storybook-components";

test.describe.configure({ mode: "serial" });
for (const capture of ["false", "true", undefined]) {
  test(`review capture ${capture ?? "local default"} preserves browser assertions @capture-contract`, async ({ page }, info) => {
    const previous = process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS;
    if (capture === undefined) delete process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS;
    else process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS = capture;
    const name = `capture-contract-${Date.now()}-${info.workerIndex}`;
    const prefix = info.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const before = info.attachments.length;
    try {
      await page.setContent('<button onclick="this.textContent=\'Saved\'">Save</button>');
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await captureRouteScreenshot(page, info, name);
      await captureStorybookScreenshot(page, info, name);
      await expect(page.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
      const enabled = capture !== "false";
      expect(existsSync(path.join("playwright-artifacts", "screenshots", `${prefix}-${name}.png`))).toBe(enabled);
      expect(existsSync(path.join("playwright-artifacts", "storybook", `${prefix}-${name}.png`))).toBe(enabled);
      expect(info.attachments.length - before).toBe(enabled ? 2 : 0);
    } finally {
      if (previous === undefined) delete process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS;
      else process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS = previous;
      await page.setContent("<p>Cleaned up</p>");
      await expect(page.getByText("Cleaned up")).toBeVisible();
    }
  });
}
