import { expect, test } from "@playwright/test";
import { gotoComponentStory, prepareStorybookVisualPage, captureStorybookScreenshot } from "./storybook-components";

test.beforeEach(async ({ page }) => { await prepareStorybookVisualPage(page); });
test("available contribution form keeps the credit URL limit @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "profiles-media-contribution-editor--inline");
  await expect(page.getByRole("heading", { name: "Media contributions" })).toBeVisible();
  await expect(page.locator('input[name="creditUrl"]')).toHaveAttribute("maxlength", "2048");
  await captureStorybookScreenshot(page, testInfo, "contribution-intake-available");
});
test("unavailable kit hides contribution intake @storybook-visual", async ({ page }, testInfo) => {
  await gotoComponentStory(page, "profiles-media-contribution-editor--unavailable");
  await expect(page.getByRole("heading", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Media contributions" })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator('input[name="creditUrl"]')).toHaveCount(0);
  await captureStorybookScreenshot(page, testInfo, "contribution-intake-unavailable");
});
