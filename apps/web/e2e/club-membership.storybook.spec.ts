import { expect, test } from "@playwright/test";
import path from "node:path";

test("membership bars and identifiable activity @storybook-visual", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "/iframe.html?id=clubs-membership--movement-and-activity&viewMode=story",
  );
  await expect(
    page.getByRole("group", { name: "Membership movement chart" }),
  ).toBeVisible();
  await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(
    page.getByText("usr_example_nightbird", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show movement data" }).click();
  const missing = page.getByRole("row").filter({ hasText: "Aug 5" });
  await expect(
    missing.getByRole("cell", { name: "Unknown", exact: true }),
  ).toHaveCount(2);
  const zero = page.getByRole("row").filter({ hasText: "Aug 9" });
  await expect(zero).toContainText("0");
  await page.getByRole("button", { name: "Hide movement data" }).click();
  await expect(
    page.getByRole("button", { name: "Load more activity" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.resolve(
      process.cwd(),
      "../../.cache/artifacts",
      `membership-${isMobile ? "mobile" : "desktop"}.png`,
    ),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
