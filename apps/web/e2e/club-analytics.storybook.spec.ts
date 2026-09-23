import { expect, test } from "@playwright/test";

test("event managers review private suggestions from Analytics @storybook-visual", async ({ page, isMobile }) => {
  await page.goto("/iframe.html?id=clubs-analytics--analytics&viewMode=story");
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event associations", exact: true })).toBeVisible();
  await expect(page.getByText("Suggested match · 75% confidence")).toHaveCount(2);
  const stale = page.getByText("Instance unavailable.").locator("..").locator("..");
  await expect(stale.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await page.screenshot({
    path: `../../.cache/artifacts/suggestion-review-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /Afterhours Lounge/ }).click();
  await expect(page.getByText("Data completeness", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to instances" }).click();
  await expect(page.getByText("Suggested match · 75% confidence")).toHaveCount(2);
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText("Suggestion confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggested match · 75% confidence")).toHaveCount(1);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Suggestion rejected.", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggested match · 75% confidence")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("staff without event management cannot see suggestions @storybook-visual", async ({ page }) => {
  await page.goto("/iframe.html?id=clubs-analytics--analytics-without-event-management&viewMode=story");
  await expect(page.getByRole("heading", { name: "Analytics", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event associations", exact: true })).toHaveCount(0);
});

test("event managers without instance history can review suggestions without a detail link @storybook-visual", async ({ page, isMobile }) => {
  await page.goto("/iframe.html?id=clubs-analytics--analytics-without-instance-history&viewMode=story");
  await expect(page.getByRole("heading", { name: "Event associations", exact: true })).toBeVisible();
  await expect(page.getByText(/Afterhours Lounge/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Afterhours Lounge/ })).toHaveCount(0);
  await page.screenshot({
    path: `../../.cache/artifacts/suggestion-review-limited-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText("Suggestion confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Suggested match · 75% confidence")).toHaveCount(1);
});
for (const kind of ["invalid", "unreadable"]) {
  test(`${kind} instance link retains a working Back button @storybook-visual`, async ({
    page,
  }) => {
    await page.goto(
      `/iframe.html?id=clubs-analytics--${kind}-instance&viewMode=story`,
    );
    await expect(
      page.getByText("Instance unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Unable to load this page.", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Back to instances", exact: true })
      .click();
    await expect(
      page.getByText("Past instances", { exact: true }),
    ).toBeVisible();
  });
}

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
  await page
    .getByRole("button", { name: "Associate event", exact: true })
    .click();
  await expect(
    page.getByText("Event: Afterhours 043", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `../../.cache/artifacts/event-association-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Back to instances" }).click();
  await expect(page.getByText("Past instances", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("membership lines segment collection gaps in range and selected day @storybook-visual", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/iframe.html?id=clubs-analytics--home&viewMode=story");
  await page.getByLabel("Select month").fill("2026-08");
  const chart = page.getByRole("group", { name: "Group members", exact: true });
  const segments = () => chart.locator(".recharts-line-curve").evaluateAll(paths => paths.reduce((count, path) => count + (path.getAttribute("d")?.match(/M/g)?.length ?? 0), 0));
  await expect.poll(segments).toBeGreaterThan(1);
  await expect(chart.locator('circle[r="3"]').first()).toBeVisible();
  await chart.scrollIntoViewIfNeeded();
  await chart.screenshot({ path: `../../.cache/artifacts/task8-membership-range-${isMobile ? "mobile" : "desktop"}.png` });
  await page.getByLabel("Inspect day", { exact: true }).fill("2026-08-01");
  await expect.poll(segments).toBe(2);
  await chart.scrollIntoViewIfNeeded();
  await chart.screenshot({ path: `../../.cache/artifacts/task8-membership-day-${isMobile ? "mobile" : "desktop"}.png` });
  await chart.locator("..").getByRole("button", { name: "Show data table" }).click();
  await expect(chart.locator("..").getByRole("cell", { name: "Unknown", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Back to range" }).click();
  await expect.poll(segments).toBeGreaterThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for (const reactive of [false, true]) {
  test(`membership coverage expires on the mounted range without collector writes, reactive=${reactive} @storybook-visual`, async ({
    page,
  }) => {
    const time = new Date(Date.UTC(2026, 8, 23, 12));
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto(
      "/iframe.html?id=clubs-analytics--membership-clock&viewMode=story",
    );
    const chart = page.getByRole("group", {
      name: "Group members",
      exact: true,
    });
    const connections = () =>
      chart
        .locator(".recharts-line-curve")
        .evaluateAll((paths) =>
          paths.reduce(
            (count, path) =>
              count + (path.getAttribute("d")?.match(/L/g)?.length ?? 0),
            0,
          ),
        );
    await expect.poll(connections).toBe(1);
    await page.clock.runFor(300_000);
    if (reactive)
      await page
        .getByRole("button", { name: "Reactive refresh", exact: true })
        .click();
    // Wall-clock changes must not change the established server deadline.
    await page.clock.setSystemTime(new Date(Date.UTC(2028, 0, 1)));
    await page.clock.runFor(300_000);
    await expect.poll(connections).toBe(1);
    await page.clock.runFor(1);
    await expect.poll(connections).toBe(0);
    await expect(chart.locator('circle[r="3"]')).toHaveCount(2);
    if (!reactive)
      await chart.screenshot({
        path: `../../.cache/artifacts/task8-i1-expired-${test.info().project.name}.png`,
      });
    await chart
      .locator("..")
      .getByRole("button", { name: "Show data table" })
      .click();
    await expect(
      chart.locator("..").getByRole("cell", { name: "2,430", exact: true }),
    ).toBeVisible();
    // Keep cached results alive while replacing the query owner. A new nonce
    // must leave it loading until evaluated, and must not restart the lifetime.
    await page
      .getByRole("button", { name: "Hold new evaluations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remount range", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Loading membership" }),
    ).toBeVisible();
    await expect(chart).toHaveCount(0);
    await page
      .getByRole("button", { name: "Release evaluations", exact: true })
      .click();
    await expect(chart).toBeVisible();
    await expect.poll(connections).toBe(0);
    await expect(chart.locator('circle[r="3"]')).toHaveCount(2);
  });
}
