import { expect, test } from "@playwright/test";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("profile-scoped claim journey @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/claim");
  await expect(page.getByRole("heading", { name: "Claim BASICBIT" })).toBeVisible();
  await expect(page.getByText("vrdex.net/p/basicbit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Verify with VRChat/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("VRChat profile URL or user ID")).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "claim-profile");
});
