import { expect, test } from "@playwright/test";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("person profile connections @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/connections");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected" })).toBeVisible();
  const account = page.getByRole("listitem").filter({ has: page.getByText("BASICBIT", { exact: true }) });
  await expect(account.getByText("VRChat account \u00b7 Primary", { exact: true })).toBeVisible();
  await expect(account.getByText("Verified VRChat account", { exact: true })).toBeVisible();
  await expect(account.getByRole("img", { name: "Verified VRChat account" })).toBeVisible();
  await expect(account.locator("time")).toHaveAttribute("datetime", "2026-10-25T00:00:00.000Z");
  await expect(account.locator("time")).toHaveText("25 Oct 2026");
  // A person profile has no VRCLinking section and nothing left to connect.
  await expect(page.getByText("Nothing left to connect.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "VRCLinking", exact: true })).toHaveCount(0);
  await captureRouteScreenshot(page, testInfo, "connections-person");
});

test("community profile connections @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/connections?community=1");
  await expect(page.getByText("Discord server · Primary · Verified")).toBeVisible();
  const group = page.getByRole("listitem").filter({ has: page.getByText("Afterglow Harbor", { exact: true }) });
  await expect(group.getByText("VRChat group", { exact: true })).toBeVisible();
  await expect(group.getByText("Verified VRChat group", { exact: true })).toBeVisible();
  await expect(group.getByRole("img", { name: "Verified VRChat group" })).toBeVisible();
  await expect(group.locator("time")).toHaveAttribute("datetime", "2026-10-25T00:00:00.000Z");
  await expect(group.locator("time")).toHaveText("25 Oct 2026");
  await expect(page.getByRole("button", { name: "Connect to this profile" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VRCLinking", exact: true })).toBeVisible();
  // The API key itself, not a reference to a secret store the owner cannot
  // reach. A regression here is the whole point of the section.
  await expect(page.getByLabel("VRCLinking API key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save key" })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "connections-community");
});
