import { expect, test } from "@playwright/test";
import { manualPerformer } from "./event-performer-helpers";

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
  const steps = page.getByRole("navigation", { name: "Event editor" });
  await expect(page.getByRole("heading", { name: "Details", exact: true })).toBeVisible();
  await expect(page.locator("summary", { hasText: "Source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish event" })).toHaveCount(0);
  await captureRouteScreenshot(page, testInfo, "event-editor-initial");
  await steps.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByLabel("Starts", { exact: true })).toBeVisible();
  await page.getByLabel("Starts", { exact: true }).fill("2026-09-12T22:00");
  await expect(page.locator('[data-editor-step="Details"]').getByLabel("Community", { exact: true })).toContainText("Afterglow");
  await expect(page.getByRole("combobox", { name: "Where", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timing", exact: true })).toBeVisible();
  await expect(page.getByLabel("Break between")).toHaveCount(0);
  await expect(page.getByLabel("Description")).toBeVisible();
  await expect(page.getByLabel("Private notes")).toHaveCount(1);
  await expect(page.locator("details").filter({ hasText: "Private notes" })).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Generate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Customize" })).toHaveCount(0);
  await expect(page.getByLabel("Slug", { exact: true })).toHaveCount(0);

  await expect(page.getByLabel("Doors open", { exact: true })).toBeHidden();
  await page.locator("summary", { hasText: "Add doors-open time" }).click();
  await page.getByLabel("Doors open", { exact: true }).fill("2026-09-12T21:45");
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2026-09-12T21:45");

  await captureRouteScreenshot(page, testInfo, "event-editor-details");
  await steps.getByRole("button", { name: "Lineup", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Slot [1-4]$/ })).toHaveCount(0);
  await page.getByLabel("Slots", { exact: true }).fill("81");
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
  await page.getByLabel("Slots", { exact: true }).fill("4");
  await page.getByLabel("Minutes each", { exact: true }).fill("60.5");
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeDisabled();
  await page.getByLabel("Minutes each", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Slot [1-4]$/ })).toHaveCount(4);
  const firstPerformer = page.locator('[data-lineup-row]').first().locator("[data-performer-field]");
  await manualPerformer(firstPerformer, "Aurora");
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstPerformer.getByRole("textbox", { name: "Performer", exact: true })).toHaveValue("Aurora");
  await captureRouteScreenshot(page, testInfo, "event-editor-lineup");
  await steps.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish event" })).toBeEnabled();
  await expect(page.locator("details").filter({ has: page.locator("summary", { hasText: /^Advanced/ }) })).not.toHaveAttribute("open");
  await captureRouteScreenshot(page, testInfo, "event-editor");
});

test("unified BASICBIT search views @visual", async ({ page }, testInfo) => {
  await page.goto("/search?q=BASICBIT");
  await expect(page.getByRole("heading", { name: "Search results", exact: true })).toBeVisible();
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
