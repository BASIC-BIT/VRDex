import { expect, test } from "@playwright/test";
test("older notifications remain reachable after an empty filtered page @storybook-visual", async ({
  page,
}, testInfo) => {
  await page.goto(
    "/iframe.html?id=clubs-scheduled--older-notifications&viewMode=story",
  );
  const section = page.getByRole("region", { name: "Action notifications" });
  await expect(section).toBeVisible();
  await section
    .getByRole("button", { name: "Load more notifications" })
    .click();
  await expect(
    section.getByRole("link", { name: "Publish post" }),
  ).toHaveAttribute("href", "/account/communities/afterhours/scheduled");
  await expect(
    section.getByRole("button", { name: "Load more notifications" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: `../../.cache/artifacts/notifications-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await section.getByRole("button", { name: "Dismiss" }).click();
  await expect(section).toHaveCount(0);
});
test("scheduled edits preserve real queue outcomes and support event-relative timing @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-scheduled--owner&viewMode=story");
  await expect(
    page.getByRole("region", { name: "Action notifications" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Action notifications" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit action", exact: true })
    .first()
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Doors at midnight");
  await page
    .getByLabel("Timing", { exact: true })
    .selectOption("event_relative");
  await page
    .getByLabel("Event", { exact: true })
    .selectOption({ label: "Afterhours Friday" });
  await page
    .getByLabel("Minutes after event start", { exact: true })
    .fill("-30");
  await page.getByRole("button", { name: "Save action", exact: true }).click();
  await expect(
    page.getByText("Doors at midnight", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("-30 minutes after event start", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancel action", exact: true })
    .first()
    .click();
  await expect(page.getByText("Cancel action?", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Outcome unknown", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Missed", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit action", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("staff can edit their own action but cannot edit another actor's action without schedule permission @storybook-visual", async ({
  page,
}) => {
  await page.goto("/iframe.html?id=clubs-scheduled--staff&viewMode=story");
  await expect(
    page.getByRole("button", { name: "Edit action", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Cancel action", exact: true }),
  ).toHaveCount(1);
});
