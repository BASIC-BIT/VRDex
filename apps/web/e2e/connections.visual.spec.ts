import { expect, test } from "@playwright/test";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("person profile connections @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/connections");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  await expect(page.getByText("VRChat account · Primary · Verified")).toBeVisible();
  // A person profile has no VRCLinking section and nothing left to connect.
  await expect(page.getByText("Nothing left to connect.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "VRCLinking delegation" })).toHaveCount(0);
  await captureRouteScreenshot(page, testInfo, "connections-person");
});

test("community profile connections @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/connections?community=1");
  await expect(page.getByText("Discord server · Primary · Verified")).toBeVisible();
  await expect(page.getByText("VRChat group · Verified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to this profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VRCLinking delegation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save delegation" })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "connections-community");
});
