import { expect, test } from "@playwright/test";

import { prepareVisualPage } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

test("handoff invitations are excluded from indexing @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-ready");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("handoff shows a loading state @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-loading");
  await expect(page.getByRole("status")).toContainText("Opening your invitation");
  await expect(page.getByRole("heading", { name: "Preparing your review." })).toBeVisible();
});

for (const state of [
  { token: "invalid", heading: "Invitation not found" },
  { token: "expired", heading: "Invitation expired" },
  { token: "revoked", heading: "Invitation revoked" },
] as const) {
  test(`handoff shows the ${state.token} state @flow @fixture`, async ({ page }) => {
    await page.goto(`/handoff/playwright-${state.token}`);
    await expect(page.getByRole("heading", { name: state.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to VRDex" })).toBeVisible();
  });
}

test("handoff shows the accepted state and owner destination @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-accepted");
  await expect(page.getByRole("heading", { name: "Invitation already accepted" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open account" })).toHaveAttribute(
    "href",
    "/account/privacy?profileId=playwright-profile",
  );
});

test("handoff preserves the invitation through sign-in @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-signed-out");
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue to your account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue to sign in" })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Fhandoff%2Fplaywright-signed-out",
  );
  await expect(page.getByLabel("Include Display name")).toBeDisabled();
});

test("handoff blocks acceptance until email is verified @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-unverified");
  await expect(page.getByRole("heading", { name: "Verify your email first" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open account" })).toHaveAttribute("href", "/account");
  await expect(page.getByLabel("Include Display name")).toBeDisabled();
});

test("handoff accepts individually selected fields and routes to the owner profile @flow @fixture", async ({ page }) => {
  await page.goto("/handoff/playwright-ready");
  await expect(page.getByRole("heading", { name: "DJ Aurora" })).toBeVisible();
  await expect(page.getByText("4 of 4 selected")).toBeVisible();
  await expect(page.getByRole("link", { name: "soundcloud.com/dj-aurora-example" })).toHaveAttribute(
    "href",
    "https://soundcloud.com/dj-aurora-example",
  );

  await page.getByLabel("Include About").uncheck();
  await expect(page.getByText("3 of 4 selected")).toBeVisible();
  await page.getByRole("button", { name: "Accept handoff" }).click();

  await expect(page).toHaveURL(/\/account\/privacy\?profileId=playwright-profile$/);
  await expect
    .poll(async () =>
      page.evaluate(() => window.sessionStorage.getItem("vrdex.e2e.handoff.selectedFieldIds")),
    )
    .toBe('["display-name","soundcloud","vrchat"]');
});
