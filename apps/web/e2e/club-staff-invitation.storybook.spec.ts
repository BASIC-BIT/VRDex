import { expect, test } from "@playwright/test";

test("anonymous preview preserves the ten-character token through sign-in @storybook", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-staff-invitation--anonymous&viewMode=story");
  await expect(page.getByText("Afterhours", { exact: true })).toBeVisible();
  await expect(page.getByText("Event staff", { exact: true })).toBeVisible();
  const link = page.getByRole("link", { name: "Sign in to accept" });
  await expect(link).toHaveAttribute("href", "/sign-in?returnTo=%2Faccount%2Fcommunities%2Fafterhours%2Finvite%2FA_b-0123Zz");
  await page.getByRole("button", { name: "Rerender", exact: true }).click();
  await expect(page.getByLabel("Preview calls")).toHaveText("1");
});

test("signed-in acceptance uses the action and preserves verified-email recovery @storybook", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-staff-invitation--signed-in&viewMode=story");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Verify your email first");
  await expect(page.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "/account");
  await page.getByRole("button", { name: "Rerender", exact: true }).click();
  await expect(page.getByLabel("Acceptance calls")).toHaveText("1");
});

test("preview failures allow retry and sign-in without revealing backend errors @storybook", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-staff-invitation--unavailable&viewMode=story");
  await expect(page.getByRole("alert")).toContainText("Unable to load this page.");
  await expect(page.getByRole("alert")).not.toContainText("STAFF_INVITATION");
  await expect(page.getByRole("link", { name: "Sign in to accept" })).toBeVisible();
  await page.getByRole("button", { name: "Recover service" }).click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Second club", { exact: true })).toBeVisible();
});

test("a late preview cannot replace the current invitation @storybook", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-staff-invitation--slow-preview&viewMode=story");
  await expect(page.getByRole("status").filter({ hasText: "Loading invitation" })).toBeVisible();
  await page.getByRole("button", { name: "Next invitation" }).click();
  await expect(page.getByText("Second club", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Release first preview" }).click();
  await expect(page.getByText("Afterhours", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Second club", { exact: true })).toBeVisible();
});
