import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=profiles-public-group-membership--${name}&viewMode=story`;

test("count and graph switches stay independent @storybook-visual", async ({ page }, testInfo) => {
  for (const [name, count, graph] of [
    ["both", true, true],
    ["count-only", true, false],
    ["graph-only", false, true],
    ["neither", false, false],
  ] as const) {
    await page.goto(story(name));
    await expect(page.getByText("Group members", { exact: true })).toHaveCount(count ? 1 : 0);
    await expect(page.getByRole("group", { name: "Total group membership" })).toHaveCount(graph ? 1 : 0);
    if (name === "both") await testInfo.attach("membership-both", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    if (name === "neither") {
      await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
      await expect(page.getByText("Member growth", { exact: true })).toBeVisible();
      await expect(page.getByText("+20", { exact: true })).toBeVisible();
    }
  }
});

test("a single observation and missing creation time remain honest @storybook-visual", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-09-29T12:00:00Z") });
  await page.goto(story("single-observation"));
  await expect(page.getByRole("group", { name: "Total group membership" })).toBeVisible();
  await expect(page.getByText("Unobserved", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-line")).toHaveCount(2);
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="3 4"]')).toHaveCount(1);
  await expect(page.getByTestId("group-today-dot")).toBeVisible();
  await page.getByTestId("group-today-dot").hover();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("Today", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("1,234 members")).toBeVisible();
  await expect(page.getByTestId("group-founding-dot")).toBeVisible();
  await page.getByTestId("group-founding-dot").hover();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("Group founded", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("1 member", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-tooltip-wrapper").getByText("Sep 21, 2026")).toBeVisible();
  await testInfo.attach("single-observation", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto(story("unknown-creation"));
  await expect(page.getByRole("group", { name: "Total group membership" })).toBeVisible();
  await expect(page.getByText("Unobserved", { exact: true })).toHaveCount(0);
  await expect(page.locator(".recharts-line")).toHaveCount(1);
});

test("Today marker expires after 48 hours without a page reload @storybook-visual", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-29T12:00:00Z") });
  await page.goto(story("single-observation"));
  await expect(page.getByTestId("group-today-dot")).toBeVisible();
  await page.clock.fastForward(49 * 3600_000);
  await expect(page.getByTestId("group-today-dot")).toHaveCount(0);
});

test("skipped UTC day uses a dotted segment even over 35 hours @storybook-visual", async ({ page }, testInfo) => {
  await page.goto(story("missing-days"));
  await expect(page.locator(".recharts-line")).toHaveCount(2);
  await expect(page.locator('.recharts-line-curve[stroke="var(--accent)"]')).toHaveCount(1);
  const observedPath = await page.locator('.recharts-line-curve[stroke="var(--accent)"]').getAttribute("d");
  expect(observedPath?.match(/M/g)).toHaveLength(2);
  await expect(page.locator('.recharts-line-dots circle')).toHaveCount(3);
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="3 4"]')).toHaveCount(1);
  await expect(page.getByText("Unobserved", { exact: true })).toBeVisible();
  await testInfo.attach("membership-missing-days", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.goto(story("adjacent-long-interval"));
  await expect(page.locator('.recharts-line-curve[stroke="var(--accent)"]')).toHaveCount(1);
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="3 4"]')).toHaveCount(0);
});

test("sampled history has its own connector, while raw missing days remain unobserved @storybook-visual", async ({ page }, testInfo) => {
  await page.goto(story("sampled-history"));
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="7 5"]')).toHaveCount(1);
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="3 4"]')).toHaveCount(0);
  await expect(page.getByText("Unobserved", { exact: true })).toHaveCount(0);
  const observedPath = await page.locator('.recharts-line-curve[stroke="var(--accent)"]:not([stroke-dasharray])').getAttribute("d");
  expect(observedPath?.match(/M/g)).toHaveLength(2);
  await expect(page.locator(".recharts-line-dots circle")).toHaveCount(2);

  await page.goto(story("sampled-then-missing"));
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="7 5"]')).toHaveCount(1);
  await expect(page.locator('.recharts-line-curve[stroke-dasharray="3 4"]')).toHaveCount(1);
  await expect(page.getByText("Unobserved", { exact: true })).toBeVisible();
  await testInfo.attach("sampled-and-missing", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
