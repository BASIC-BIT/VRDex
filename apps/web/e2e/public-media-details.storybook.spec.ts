import { expect, test } from "@playwright/test";
import path from "node:path";
import { prepareVisualPage, waitForVisualReady } from "./public-routes";
test.beforeEach(async ({ page }) => { await prepareVisualPage(page); });

for (const state of ["collapsed", "expanded"]) {
  test(`public media card ${state} @storybook-visual`, async ({ page }, testInfo) => {
    await page.goto(`/iframe.html?id=public-media-asset-card--${state}&viewMode=story`);
    const card = page.locator("article");
    await expect(card.getByRole("link", { name: "View source" })).toBeVisible();
    if (state === "expanded") {
      await expect(card.getByText("Uploaded by", { exact: true })).toBeVisible();
      await expect(card.getByText("Shared by Karly", { exact: true })).toBeVisible();
    } else {
      await expect(card.getByText("Shared by Karly", { exact: true })).toHaveCount(0);
    }
    await waitForVisualReady(page);
    await card.locator("img").evaluate(async image => { if (image instanceof HTMLImageElement) await image.decode(); });
    await expect(card.locator("img")).toHaveClass(/opacity-100/);
    await expect(card.getByRole("status", { name: "Loading image" })).toHaveCount(0);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await card.screenshot({ path: path.resolve(process.cwd(), "../../.cache/artifacts", `public-media-story-${testInfo.project.name}-${state}.png`) });
  });
}

