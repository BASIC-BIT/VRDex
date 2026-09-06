import { expect, test } from "@playwright/test";

test("verified connections have a precise status and do not ask for repeat verification @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/profile-verification");
  const connected = page.getByRole("region", { name: "Connected profile", exact: true });
  await expect(connected.getByText("VRChat verified", { exact: true })).toBeVisible();
  await expect(connected.getByRole("link", { name: "Verify with VRChat" })).toHaveCount(0);
  await expect(connected.getByRole("link", { name: "Connections" })).toHaveAttribute("href", "/account/connections?profileSlug=example-dj");
  await expect(page.getByRole("region", { name: "Unverified connection", exact: true }).getByRole("link", { name: "Verify with VRChat" })).toBeVisible();
  await expect(page.getByRole("link", { name: "VRChat Verified VRChat connection" }).getByRole("img", { name: "Verified VRChat connection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Website" }).getByRole("img")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("verification-status.png"), fullPage: true });
});

test("an owner returning to the claim page sees their verified connection @fixture", async ({ page }) => {
  await page.goto("/playwright/claim?completion=connected-unverified");
  await expect(page.getByText("You already manage this profile.", { exact: true })).toBeVisible();
  await expect(page.getByText("VRChat verified", { exact: true })).toBeVisible();
  await expect(page.getByText(/It is not verified yet/)).toHaveCount(0);
  await expect(page.getByText("Verify this profile with VRChat", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Prove control of another server, group, or account", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Verify with VRChat", exact: true })).toHaveCount(0);
});
