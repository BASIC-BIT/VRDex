import { expect, test } from "@playwright/test";

import { captureRouteScreenshot, prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("profile-scoped claim journey @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright/claim");
  await expect(page.getByRole("heading", { name: "Claim BASICBIT" })).toBeVisible();
  await expect(page.getByText("vrdex.net/basicbit", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Verify with VRChat/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("VRChat profile URL or user ID")).toBeVisible();
  await expect(page.getByRole("button", { name: /Use VRCLinking/ })).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "claim-profile");

  // Selecting it replaces the lower half of the form — its own disclosure and
  // submit label — so the picker shot above does not cover the method itself.
  await page.getByRole("button", { name: /Use VRCLinking/ }).click();
  await expect(page.getByRole("button", { name: "Check VRCLinking" })).toBeVisible();
  await expect(page.getByText(/which server answered/)).toBeVisible();
  await captureRouteScreenshot(page, testInfo, "claim-profile-vrclinking");
});
