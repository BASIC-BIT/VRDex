import { test, expect } from "@playwright/test";
import { prepareVisualPage, waitForVisualReady } from "./public-routes";
for (const state of [
  "mixed",
  "cold-start",
  "sparse",
  "empty",
  "partial",
  "failed",
  "loading",
  "missing-artwork",
  "missing-public-genres",
  "long-custom-labels",
]) {
  test(`discovery ${state} presentation @storybook-snapshot`, async ({
    page,
  }) => {
    await prepareVisualPage(page);
    await page.goto(`/iframe.html?id=home-discovery--${state}&viewMode=story`);
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeVisible();
    await waitForVisualReady(page);
    await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(
        images.map(async (image) => {
          if (image instanceof HTMLImageElement) {
            image.loading = "eager";
            await image.decode();
          }
        }),
      );
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await expect(page).toHaveScreenshot(`home-discovery-state-${state}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      threshold: 0.2,
      scale: "css",
    });
  });
}
