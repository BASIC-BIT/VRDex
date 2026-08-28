import { expect, test } from "@playwright/test";

import {
  capturedRoutes,
  captureRouteScreenshot,
  expectHomePage,
  expectProfileEditSignedOutPage,
  prepareVisualPage,
  visualProfilePaths,
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

test("profile edit signed out @visual", async ({ page }, testInfo) => {
  await page.goto(`${visualProfilePaths.personPath}/contribute-media`);
  await expect(page).toHaveURL(`${visualProfilePaths.personPath}/edit?section=media#media-contributions`);
  await expectProfileEditSignedOutPage(page);
  await captureRouteScreenshot(page, testInfo, "profile-edit-signed-out");
});

test("unified BASICBIT search views @visual", async ({ page }, testInfo) => {
  await page.goto("/search?q=BASICBIT");
  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Results for BASICBIT" })).toBeVisible();
  await expect(page.getByText("Software Dev | 3D Designer | VRDJ")).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "search-basicbit-standard");

  await page.goto("/search?q=BASICBIT&view=dj");
  await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "search-basicbit-dj");
});

test("unified sparse import search views @visual", async ({ page }, testInfo) => {
  await page.goto("/search?q=Sparse%20Import");
  await expect(page.getByText("Sparse Import", { exact: true })).toBeVisible();
  await expect(page.getByText("Imported profile seed", { exact: true })).toHaveCount(0);
  await captureRouteScreenshot(page, testInfo, "search-sparse-import-standard");

  await page.goto("/search?q=Sparse%20Import&view=dj");
  await expect(page.getByRole("link", { name: "Sparse Import", exact: true })).toBeVisible();
  await expect(page.getByText(/Imported profile seed|Unclaimed/, { exact: true })).toHaveCount(0);
  await captureRouteScreenshot(page, testInfo, "search-sparse-import-dj");
});
