import { expect, test } from "@playwright/test";

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

test("connection feature toggles remain independent and permission evidence expires @storybook-visual", async ({
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
  await page.clock.fastForward(61_000);
  await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Awaiting permission check", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByText("Manage group announcements", { exact: true }),
  ).toHaveCount(0);
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
