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

test("event editor @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-editor");
  await expect(page.getByRole("heading", { name: "Add event" })).toBeVisible();
  await expect(page.getByLabel("Start", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Community", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("World", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Session [1-4]$/ })).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByLabel("Break between")).toHaveCount(0);
  await expect(page.getByLabel("Description")).toBeVisible();
  await expect(page.getByLabel("Private notes")).toHaveCount(1);
  await expect(page.locator("details").filter({ hasText: "Private notes" })).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Generate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
  await expect(page.getByLabel("Slug", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish event" })).toBeVisible();
  await expect(page.locator("details").filter({ hasText: "Media and links" })).not.toHaveAttribute("open");

  await page.locator("details").filter({ hasText: /^Details/ }).first().locator("summary").click();
  await page.getByLabel("Display name").first().fill("Aurora");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Replace edited schedule?");
    await dialog.dismiss();
  });
  await page.getByLabel("Sessions").fill("5");
  await expect(page.getByLabel("Display name").first()).toHaveValue("Aurora");
  await expect(page.getByRole("heading", { name: /^Session [1-4]$/ })).toHaveCount(4);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Sessions").fill("0");
  await expect(page.getByRole("heading", { name: /^Session \d+$/ })).toHaveCount(0);
  await page.getByLabel("Sessions").fill("4");
  await expect(page.getByRole("heading", { name: /^Session [1-4]$/ })).toHaveCount(4);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Sessions").fill("5");
  await expect(page.getByRole("heading", { name: /^Session [1-5]$/ })).toHaveCount(5);
  await page.getByLabel("Sessions").fill("4");
  await expect(page.getByRole("heading", { name: /^Session [1-4]$/ })).toHaveCount(4);
  await page.getByLabel("Sessions").fill("81");
  await expect(page.getByLabel("Sessions")).toHaveValue("80");
  await page.getByLabel("Sessions").fill("4");
  await expect(page.getByRole("heading", { name: /^Session [1-4]$/ })).toHaveCount(4);
  await page.getByLabel("Sessions").fill("");
  await expect(page.getByRole("button", { name: "Publish event" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await page.getByLabel("Sessions").fill("4");
  await page.getByLabel("Minutes each").fill("");
  await expect(page.getByRole("button", { name: "Publish event" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  await page.getByLabel("Minutes each").fill("60.5");
  await expect(page.getByRole("button", { name: "Publish event" })).toBeDisabled();
  await page.getByLabel("Minutes each").fill("60");
  await expect(page.getByRole("button", { name: "Publish event" })).toBeEnabled();
  await captureRouteScreenshot(page, testInfo, "event-editor");
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
