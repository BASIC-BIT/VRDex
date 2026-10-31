import { expect, test } from "@playwright/test";
import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test("My events with one new draft, one proposed update, and one flagged event @visual", async ({ page }, testInfo) => {
  await prepareVisualPage(page);
  await page.goto("/playwright/event-inventory?held=1");
  const section = page.getByRole("region", { name: "Waiting for review" });
  await expect(section.getByRole("row")).toHaveCount(4);
  await expect(section.getByText("Update to", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await captureRouteScreenshot(page, testInfo, "my-events-held-imports");
});
