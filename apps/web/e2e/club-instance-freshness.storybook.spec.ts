import { test, expect, type Page } from "@playwright/test";

async function open(page: Page, mode = "owner", skew = 0) {
  const time = new Date(1_800_000_000_000 + skew);
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  await page.goto(`/iframe.html?id=clubs-instance-freshness--${mode}&viewMode=story`);
  await expect(page.getByRole("button", { name: "Open detail", exact: true })).toBeVisible();
}
const click = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const live = (page: Page) => page.getByLabel("Telemetry live", { exact: true });
const history = (page: Page) => page.getByLabel("Complete history", { exact: true });

for (const mode of ["empty", "paginated", "owner", "filtered-pages"]) {
  test(`list ${mode} calibrates late rows without renewing old observations`, async ({ page }) => {
    await open(page, mode);
    if (mode !== "empty" && mode !== "filtered-pages") await expect(history(page).getByText("Still open")).toBeVisible();
    await page.clock.runFor(600_000);
    if (mode === "paginated" || mode === "filtered-pages") {
      await history(page).getByRole("button", { name: "Load more instances" }).click();
      await live(page).getByRole("button", { name: "Load more instances" }).click();
    } else await click(page, "Add fresh row");
    await expect(live(page).getByRole("button", { name: "New arrival", exact: true })).toBeVisible();
    await expect(history(page).getByRole("button", { name: "New arrival", exact: true })).toBeVisible();
    await expect(history(page).getByText("Still open")).toHaveCount(1);
    await click(page, "Inspect attempts");
    await expect(page.getByTestId("session-attempts")).toHaveText(JSON.stringify({ live: 1, history: 1, clocks: 2 }));
    if (mode !== "empty" && mode !== "filtered-pages") await expect(history(page).getByText("Unknown")).toHaveCount(1);
    await page.clock.runFor(360_000);
    await expect(live(page).getByRole("button", { name: "New arrival", exact: true })).toBeVisible();
    await page.clock.runFor(1);
    await expect(live(page).getByRole("button", { name: "New arrival", exact: true })).toHaveCount(0);
    await expect(history(page).getByText("Still open")).toHaveCount(0);
    await expect(history(page).getByRole("button", { name: "New arrival", exact: true })).toBeVisible();
  });
}

test("list waits for a delayed clock and charges response time to the original deadline", async ({ page }) => {
  await open(page, "delayed-clock");
  await expect(history(page).getByText("Unknown")).toBeVisible();
  await expect(live(page).getByRole("button", { name: "The Observatory" })).toHaveCount(0);
  await page.clock.runFor(5000);
  await click(page, "Release evaluations");
  await expect(live(page).getByText("Still open")).toBeVisible();
  await page.clock.runFor(350_000);
  await expect(live(page).getByText("Still open")).toBeVisible();
  await page.clock.runFor(1);
  await expect(live(page).getByText("Still open")).toHaveCount(0);
  await expect(history(page).getByText("Unknown")).toBeVisible();
});

test("list remount requires fresh clock evidence and does not renew a retained observation", async ({ page }) => {
  await open(page);
  await page.clock.runFor(180_000);
  await click(page, "Hold evaluations");
  await click(page, "Remount owner");
  await expect(live(page).getByText("Still open")).toHaveCount(0);
  await page.clock.runFor(5000);
  await click(page, "Release evaluations");
  await expect(live(page).getByText("Still open")).toBeVisible();
  await click(page, "Inspect attempts");
  await expect(page.getByTestId("session-attempts")).toHaveText(JSON.stringify({ live: 2, history: 2, clocks: 4 }));
  await page.clock.runFor(170_001);
  await expect(live(page).getByText("Still open")).toHaveCount(0);
  await expect(history(page).getByText("Unknown")).toBeVisible();
});

for (const mode of ["owner", "staff"]) {
  test(`${mode} expires mounted telemetry lists and retains chronological history`, async ({ page }) => {
    await open(page, mode);
    await expect(live(page).getByText("Still open")).toBeVisible();
    await page.clock.runFor(360_000);
    await expect(live(page).getByText("Still open")).toBeVisible();
    await page.clock.runFor(1);
    await expect(live(page).getByRole("button", { name: "The Observatory" })).toHaveCount(0);
    await expect(history(page).getByText("Unknown")).toBeVisible();
    await expect(history(page).getByText("100", { exact: true })).toBeVisible();
    await expect(history(page).getByText("75", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../.cache/artifacts/task9-history-expired-${mode}-${test.info().project.name}.png`, fullPage: true });
    await history(page).getByRole("button", { name: "The Observatory" }).click();
    await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close instance", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Back to instances" })).toBeVisible();
  });
  test(`${mode} expires detail and an open confirmation without query writes`, async ({ page }) => {
    await open(page, mode);
    await click(page, "Open detail");
    await click(page, "Close instance");
    await expect(page.getByRole("button", { name: "Confirm closure" })).toBeVisible();
    await page.clock.runFor(360_000);
    await expect(page.getByRole("button", { name: "Confirm closure" })).toBeVisible();
    await page.clock.runFor(1);
    await expect(page.getByRole("button", { name: "Confirm closure" })).toHaveCount(0);
    await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(page.getByTestId("session-submissions")).toHaveText("[]");
    await expect(page.getByText("100", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../.cache/artifacts/task9-detail-expired-${mode}-${test.info().project.name}.png`, fullPage: true });
    await click(page, "Replace observation");
    await expect(page.getByText("Still open", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm closure" })).toHaveCount(0);
    await click(page, "Close instance");
    await click(page, "Confirm closure");
    await expect.poll(async () => JSON.parse((await page.getByTestId("session-submissions").textContent())!).length).toBe(1);
  });
}
for (const skew of [-86_400_000, 86_400_000]) {
  test(`session calibration survives reactive replay, wall-clock skew ${skew} and remount cache`, async ({ page }) => {
    await open(page, "owner", skew);
    await click(page, "Open detail");
    await page.clock.runFor(180_000);
    await page.clock.setSystemTime(new Date(1_900_000_000_000));
    await click(page, "Reactive evaluation");
    await expect(page.getByText("Still open", { exact: true })).toBeVisible();
    await page.clock.runFor(180_001);
    await expect(page.getByText("Still open", { exact: true })).toHaveCount(0);
    await click(page, "Reactive evaluation");
    await expect(page.getByText("Still open", { exact: true })).toHaveCount(0);
    await click(page, "Hold evaluations");
    await click(page, "Remount owner");
    await expect(page.getByText("Unknown", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Loading instance" })).toBeVisible();
    await click(page, "Replace observation");
    await page.clock.runFor(5000);
    await click(page, "Release evaluations");
    await expect(page.getByText("Still open", { exact: true })).toBeVisible();
    await page.clock.runFor(350_001);
    await expect(page.getByText("Still open", { exact: true })).toHaveCount(0);
  });
}
test("disconnect and management revocation remove open confirmations while history-only staff retain metrics", async ({ page }) => {
  await open(page, "staff");
  await click(page, "Open detail");
  await click(page, "Close instance");
  await click(page, "Disconnect");
  await expect(page.getByRole("button", { name: "Confirm closure" })).toHaveCount(0);
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
  await click(page, "Replace observation");
  await click(page, "Close instance");
  await click(page, "Revoke management");
  await expect(page.getByRole("button", { name: "Confirm closure" })).toHaveCount(0);
  await expect(page.getByTestId("session-submissions")).toHaveText("[]");
  await page.goto("/iframe.html?id=clubs-instance-freshness--history-only&viewMode=story");
  await click(page, "Open detail");
  await expect(page.getByRole("button", { name: "Close instance", exact: true })).toHaveCount(0);
  await expect(page.getByText("100", { exact: true }).first()).toBeVisible();
});
