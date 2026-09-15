import { expect, test } from "@playwright/test";

test("dashboard charts, drilldown and preferences @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/iframe.html?id=clubs-analytics--home&viewMode=story");
  await expect(
    page.getByText("Total group membership", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(page.locator(".recharts-line-curve").first()).toBeVisible();
  await expect(
    page.getByText("Membership movement", { exact: true }),
  ).toHaveCount(0);
  if (!isMobile) {
    await page.locator(".recharts-bar-rectangle").first().hover();
    await expect(
      page
        .getByRole("group", { name: "Peak people", exact: true })
        .locator(".recharts-tooltip-wrapper"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Group members", exact: true })
        .locator(".recharts-tooltip-wrapper"),
    ).toBeHidden();
  }
  await page.getByLabel("Select month").fill("2026-08");
  await expect(page.getByLabel("Date range")).toContainText(
    "2026-08-01 to 2026-08-31",
  );
  await page.getByRole("button", { name: "Show data table" }).first().click();
  await page
    .getByRole("button", { name: "Inspect day", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Activity on selected day", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Inspect day", { exact: true })).toHaveValue(
    "2026-08-01",
  );
  await page.getByRole("button", { name: "Back to range" }).click();
  await expect(page.getByText("Daily activity", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Date range")).toContainText(
    "2026-08-01 to 2026-08-31",
  );
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Total membership", exact: true })
    .uncheck();
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await expect(
    page.getByText("Total group membership", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("button", { name: "Reset to club default" }).click();
  await expect(
    page.getByText("Total group membership", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("instance list emphasizes population and opens detail @storybook-visual", async ({
  page,
  isMobile,
}) => {
  await page.goto("/iframe.html?id=clubs-analytics--instances&viewMode=story");
  await expect(page.getByText("Past instances", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage", { exact: true })).toHaveCount(0);
  await expect(page.getByText("State", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Afterhours Lounge", exact: true })
    .click();
  await expect(
    page.getByText("Data completeness", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "People", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Event", { exact: true }).selectOption("fixture-event");
  await page.getByRole("button", { name: "Associate event", exact: true }).click();
  await expect(page.getByText("Event: Afterhours 043", { exact: true })).toBeVisible();
  await page.screenshot({ path: `../../.cache/artifacts/event-association-${isMobile ? "mobile" : "desktop"}.png`, fullPage: true });
  await page.getByRole("button", { name: "Back to instances" }).click();
  await expect(page.getByText("Past instances", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
