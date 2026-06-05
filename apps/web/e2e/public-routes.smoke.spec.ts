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
  await expectSearchPage(page);
});
