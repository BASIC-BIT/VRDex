import { expect, test } from "@playwright/test";

test("reconnect preserves saved group policy on submission @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-workspace--reconnect&viewMode=story");
  await expect(page.getByRole("combobox", { name: "Group visibility", exact: true })).toHaveValue("public");
  await expect(page.getByRole("combobox", { name: "Join policy", exact: true })).toHaveValue("free");
  await page.getByRole("button", { name: "Reconnect group", exact: true }).click();
  await expect(page.getByLabel("Submitted connection")).toContainText('"vrchatGroupId":"grp_saved"');
  await expect(page.getByLabel("Submitted connection")).toContainText('"groupVisibility":"public"');
  await expect(page.getByLabel("Submitted connection")).toContainText('"joinPolicy":"free"');
});

test("primary connection keeps additional links in profile editing @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-workspace--connection&viewMode=story");
  await expect(
    page.getByText("Primary VRChat group ID", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Edit additional group links" }),
  ).toHaveAttribute("href", "/afterhours/edit");
  await page.screenshot({
    path: `../../.cache/artifacts/club-primary-connection-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("connection feature toggles remain independent @storybook-visual", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(
    "/iframe.html?id=clubs-workspace--connection-features-owner&viewMode=story",
  );
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(3);
  await expect(
    page.getByText("Manage group announcements", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Analytics", exact: true })
    .uncheck();
  await expect(
    page.getByRole("checkbox", { name: "Member management", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Posts", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Instances", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("integration staff cannot configure owner role allowlists @storybook-visual", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-workspace--connection-features-staff&viewMode=story",
  );
  await expect(
    page.getByRole("checkbox", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("VRChat role assignments", { exact: true }),
  ).toHaveCount(0);
});

test("a stale provider-role allowlist cannot restore a removed grant @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-workspace--connection-features-stale-role&viewMode=story");
  await expect(page.getByRole("textbox", { name: "Admin: permitted VRChat role IDs" })).toHaveValue("grol_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  await page.getByRole("button", { name: "Simulate other tab" }).click();
  await page.getByRole("button", { name: "Save roles" }).first().click();
  await expect(page.getByRole("alert")).toContainText("Refresh to continue.");
  await expect(page.getByLabel("Submitted role token")).toHaveText(String(Date.UTC(2026, 8, 12, 21)));
  await expect(page.getByLabel("Stored provider roles")).toHaveText("");
  await page.screenshot({
    path: `../../.cache/artifacts/club-stale-provider-role-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("a saved provider-role allowlist uses its returned version for the next save @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-workspace--connection-features-stale-role&viewMode=story");
  const save = page.getByRole("button", { name: "Save roles" }).first();
  await save.click();
  await expect(page.getByLabel("Submitted role token")).toHaveText(String(Date.UTC(2026, 8, 12, 21)));
  await save.click();
  await expect(page.getByLabel("Submitted role token")).toHaveText(String(Date.UTC(2026, 8, 12, 21) + 1));
  await expect(page.getByRole("alert")).toHaveCount(0);
});
