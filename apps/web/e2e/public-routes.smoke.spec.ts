import { expect, test } from "@playwright/test";

import { capturedRoutes, expectSearchPage, prepareVisualPage, productionSmokeRoutes } from "./public-routes";

const routes = process.env.PLAYWRIGHT_BASE_URL ? productionSmokeRoutes : capturedRoutes;

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of routes) {
  test(`${route.name} renders`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
  });
}

test("legacy discovery query redirects to search", async ({ page }) => {
  await page.goto("/discover?q=aurora");
  await expect(page).toHaveURL(/\/search\?q=aurora$/);

  if (process.env.PLAYWRIGHT_BASE_URL) {
    await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
    return;
  }

  await expectSearchPage(page);
});

test("lookup suggestions select a public person row", async ({ page }) => {
  await page.goto("/lookup");
  await page.getByLabel("DJ name").fill("bas");
  await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
  await page.getByRole("option", { name: /BASICBIT/i }).click();
  await expect(page).toHaveURL(/\/lookup\?q=BASICBIT$/);
  await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
  await expect(page.getByText("https://stream.vrcdn.live/live/basicbit.live.ts", { exact: true })).toHaveCount(2);
  await expect(page.getByText("rtspt://stream.vrcdn.live/live/basicbit", { exact: true })).toHaveCount(2);
  await expect(page.getByText("BASIC", { exact: true })).toHaveCount(2);
});
