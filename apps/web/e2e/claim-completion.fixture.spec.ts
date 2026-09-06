import { expect, test } from "@playwright/test";

test("background connection completion replaces the queued message @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/claim?completion=background");
  await page.getByRole("button", { name: "I've added it - check now" }).click();
  await expect(page.getByText(/We are checking VRChat for your code/)).toBeVisible();
  await page.getByRole("button", { name: "Simulate collector completion" }).click();
  await expect(page.getByText("That account or group is now connected to this profile.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("claim-completed.png"), fullPage: true });
  await expect(page.getByText(/We are checking VRChat for your code/)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "That account or group is now connected" })).toBeFocused();
});

test("returning after completion does not replay a new-connection announcement @fixture", async ({ page }) => {
  await page.goto("/playwright/claim?completion=returned");
  await expect(page.getByText("You already manage this profile.")).toBeVisible();
  await expect(page.getByText("That account or group is now connected to this profile.")).toHaveCount(0);
  await expect(page.getByText(/We are checking VRChat for your code/)).toHaveCount(0);
});
