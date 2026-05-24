import { test } from "@playwright/test";

import { capturedRoutes } from "./public-routes";

for (const route of capturedRoutes) {
  test(`${route.name} renders`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
  });
}
