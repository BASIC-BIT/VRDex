import { expect, test } from "@playwright/test";

test("dated connections appear in public Links and account status @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/profile-verification");
  const connected = page.getByRole("region", { name: "Connected profile", exact: true });
  await expect(connected.getByText("Example DJ", { exact: true })).toBeVisible();
  await expect(connected.getByText("Verified VRChat account", { exact: true })).toBeVisible();
  await expect(connected.getByRole("link", { name: "Verify with VRChat" })).toHaveCount(0);
  await expect(connected.getByRole("link", { name: "Connections" })).toHaveAttribute("href", "/account/connections?profileSlug=example-dj");
  await expect(page.getByRole("region", { name: "Unverified connection", exact: true }).getByRole("link", { name: "Verify with VRChat" })).toBeVisible();
  const links = page.getByRole("region", { name: "Public Links", exact: true });
  await expect(links.getByRole("link", { name: /Example DJ/ })).toHaveCount(1);
  await expect(links.getByRole("img", { name: "Verified VRChat account" })).toBeVisible();
  await expect(links.locator("time")).toHaveAttribute("datetime", "2026-10-25T00:00:00.000Z");
  await expect(links.locator("time")).toHaveText("25 Oct 2026");
  await expect(page.getByRole("link", { name: "Website" }).getByRole("img")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("public-links-and-account-status.png"), fullPage: true });
});

test("connection-only links append once and revoked proofs lose their mark @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/profile-verification?links=missing");
  const links = page.getByRole("region", { name: "Public Links", exact: true });
  await expect(links.getByRole("link", { name: /Example DJ/ })).toHaveCount(1);
  await expect(links.locator("time")).toHaveText("25 Oct 2026");
  await page.goto("/playwright/profile-verification?links=revoked");
  await expect(page.getByRole("region", { name: "Public Links", exact: true }).locator("time")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Public Links", exact: true }).getByRole("img")).toHaveCount(0);
  await page.goto("/playwright/connections");
  await expect(page.getByText("BASICBIT", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Verified VRChat account", { exact: true })).toBeVisible();
  await expect(page.locator("time")).toHaveText("25 Oct 2026");
  await page.screenshot({ path: testInfo.outputPath("account-connections.png"), fullPage: true });
});

test("an owner returning sees the saved connection without repeat completion @fixture", async ({ page }) => {
  await page.goto("/playwright/claim?completion=connected-unverified");
  await expect(page.getByText("You already manage this profile.", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified VRChat account", { exact: true })).toBeVisible();
  await expect(page.getByText("BASICBIT", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("VRChat account verified.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Prove control of another server, group, or account", { exact: true })).toBeVisible();
});

test("a long account ID remains legible when its name is unavailable @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/profile-verification?links=fallback");
  const links = page.getByRole("region", { name: "Public Links", exact: true });
  await expect(links.getByText("usr_11111111-2222-3333-4444-555555555555", { exact: true })).toBeVisible();
  await expect(links.locator("time")).toHaveText("25 Oct 2026");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("long-id-fallback.png"), fullPage: true });
});
