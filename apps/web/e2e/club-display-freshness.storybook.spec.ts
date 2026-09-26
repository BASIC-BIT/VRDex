import { expect, test, type Page } from "@playwright/test";

for (const kind of ["population", "authority"] as const) {
  const ttl = kind === "population" ? 360_000 : 60_000;
  const value = (page: Page) =>
    page.getByText(kind === "population" ? "112" : "Connected", {
      exact: true,
    });
  const click = (page: Page, name: string) =>
    page.getByRole("button", { name, exact: true }).click();
  async function open(page: Page, variant = "freshness", skew = 0) {
    const time = new Date(1_800_000_000_000 + skew);
    await page.clock.install({ time });
    await page.clock.pauseAt(time);
    await page.goto(
      `/iframe.html?id=clubs-analytics--${kind}-${variant}&viewMode=story`,
    );
    await expect(
      page.getByRole("button", { name: "Remount owner", exact: true }),
    ).toBeVisible();
  }
  for (const skew of [-86_400_000, 86_400_000]) {
    test(`${kind} ignores wall-clock skew ${skew} @storybook-visual`, async ({
      page,
    }) => {
      await open(page, "freshness", skew);
      await expect(value(page)).toBeVisible();
      await page.clock.setSystemTime(new Date(1_900_000_000_000));
      await click(page, "Rerender");
      await expect(value(page)).toBeVisible();
      await page.clock.runFor(ttl + 1);
      await expect(value(page)).toHaveCount(0);
    });
  }
  test(`${kind} keeps aged evidence and inclusive expiry @storybook-visual`, async ({
    page,
  }) => {
    await open(page, "aged");
    await expect(value(page)).toBeVisible();
    await page.screenshot({
      path: `../../.cache/artifacts/task-3-${kind}-fresh-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.clock.runFor(15_000);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(value(page)).toHaveCount(0);
    await page.screenshot({
      path: `../../.cache/artifacts/task-3-${kind}-expired-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
  test(`${kind} expiry between render and passive effect clears the display @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(10);
    await click(page, "Expire during effects");
    // The fixture confirms the positive DOM committed before advancing time.
    // No query update or user interaction is allowed to repair the display.
    await expect(page.locator("html")).toHaveAttribute(
      "data-fresh-before-effect",
      "true",
    );
    await page.clock.runFor(1);
    await expect(value(page)).toHaveCount(0);
  });
  test(`${kind} query delay consumes the remaining lifetime @storybook-visual`, async ({
    page,
  }) => {
    await open(page, "delayed");
    await expect(value(page)).toHaveCount(0);
    await page.clock.runFor(5_000);
    await click(page, "fresh");
    await click(page, "Release evaluations");
    await expect(value(page)).toBeVisible();
    // The observation aged during the query, and the conservative calibration
    // also charges the five seconds between query start and evaluation.
    await page.clock.runFor(5_000);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(value(page)).toHaveCount(0);
  });
  test(`${kind} reactive results and child remount keep the original deadline @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(40_000);
    await click(page, "fresh");
    await click(page, "Rerender");
    await expect(value(page)).toBeVisible();
    await click(page, "loading");
    await expect(value(page)).toHaveCount(0);
    await click(page, "fresh");
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(ttl - 40_000);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(value(page)).toHaveCount(0);
    await click(page, "fresh");
    await expect(value(page)).toHaveCount(0);
    await click(page, "replace");
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(ttl);
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(value(page)).toHaveCount(0);
  });
  test(`${kind} owner remount and scope changes cannot reuse cached timing @storybook-visual`, async ({
    page,
  }) => {
    await open(page, "aged");
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(10_000);
    await click(page, "Hold new evaluations");
    await click(page, "Remount owner");
    await expect(value(page)).toHaveCount(0);
    // Preserve the observation when releasing the new query.
    await click(page, "fresh");
    await click(page, "Release evaluations");
    await expect(value(page)).toBeVisible();
    await page.clock.runFor(5_001);
    await expect(value(page)).toHaveCount(0);
    await click(page, "Remount owner");
    await expect(value(page)).toHaveCount(0);
    await click(page, "replace");
    await expect(value(page)).toBeVisible();
    await click(page, "Hold new evaluations");
    await click(page, "Change scope");
    await expect(value(page)).toHaveCount(0);
    await click(page, "Release evaluations");
    await expect(value(page)).toBeVisible();
    await click(page, "Inspect attempts");
    await expect(page.getByLabel("Attempt count")).toHaveText("4");
  });
  test(`${kind} latest absence, revocation and future evidence suppress freshness @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await expect(value(page)).toBeVisible();
    for (const mode of ["absent", "revoked", "future", "invalid", "disabled"]) {
      await click(page, mode);
      await expect(value(page)).toHaveCount(0);
      await click(page, "replace");
      await expect(value(page)).toBeVisible();
    }
    await click(page, "revoked");
    await page.clock.fastForward(ttl + 10_000);
    await expect(value(page)).toHaveCount(0);
  });
  test(`${kind} initially absent evidence can become fresh after a long wait @storybook-visual`, async ({
    page,
  }) => {
    await open(page, "absent");
    await expect(value(page)).toHaveCount(0);
    await page.clock.runFor(ttl * 2);
    await click(page, "Hold new evaluations");
    await click(page, "replace");
    if (kind === "authority") await expect(value(page)).toHaveCount(0);
    else await expect(value(page)).toBeVisible();
    await click(page, "Release evaluations");
    await expect(value(page)).toBeVisible();
    await click(page, "fresh");
    await click(page, "Inspect attempts");
    await expect(page.getByLabel("Attempt count")).toHaveText(
      kind === "authority" ? "2" : "1",
    );
    await page.clock.runFor(ttl + 1);
    await expect(value(page)).toHaveCount(0);
  });
  test(`${kind} suspended timers expire on resume @storybook-visual`, async ({
    page,
  }) => {
    await open(page);
    await expect(value(page)).toBeVisible();
    await page.clock.fastForward(ttl + 10_000);
    await click(page, "Rerender");
    await expect(value(page)).toHaveCount(0);
  });
}

test("authority still requires readiness, enabled feature and integration access @storybook-visual", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=clubs-analytics--authority-freshness&viewMode=story",
  );
  const connected = page.getByText("Connected", { exact: true });
  await expect(connected).toBeVisible();
  for (const mode of ["disabled", "not-ready"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(connected).toHaveCount(0);
    await page.getByRole("button", { name: "fresh", exact: true }).click();
    await expect(connected).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Toggle access", exact: true })
    .click();
  await expect(connected).toHaveCount(0);
  await page
    .getByRole("button", { name: "Hold new evaluations", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toggle access", exact: true })
    .click();
  await expect(connected).toHaveCount(0);
  await page
    .getByRole("button", { name: "Release evaluations", exact: true })
    .click();
  await expect(connected).toBeVisible();
});
