import { expect, test } from "@playwright/test";

import {
  capturedRoutes,
  captureRouteScreenshot,
  expectHomePage,
  prepareVisualPage,
} from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of capturedRoutes) {
  test(`${route.name} @visual`, async ({ page }, testInfo) => {
    await page.goto(route.path);
    await route.expectPage(page);
    await captureRouteScreenshot(page, testInfo, route.name);
  });
}

test("home dark theme @visual", async ({ page }, testInfo) => {
  await page.goto("/");
  await expectHomePage(page);
  await page.evaluate(() => {
    window.localStorage.setItem("vrdex-theme", "light");
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  });
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expectHomePage(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await captureRouteScreenshot(page, testInfo, "home-dark");
});
