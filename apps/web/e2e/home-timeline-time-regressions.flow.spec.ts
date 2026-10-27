import { expect } from "@playwright/test";
import { test, TIMELINE_NOW } from "./home-timeline-fixture";

test.describe("timeline time regressions @flow @fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
  });

  test("fractional zoom pan retains the viewed date and Back anchor", async ({ page }, info) => {
    const anchor = Date.UTC(2026, 10, 2, 12);
    await page.goto(`/?at=${anchor}&tz=UTC`);
    const date = page.getByLabel("Schedule date", { exact: true });
    const chart = page.getByRole("region", { name: "Timeline chart", exact: true });
    await expect(date).toHaveValue("2026-11-02");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute("data-state", "ready");
    const movement = await chart.evaluate((el) => {
      el.style.zoom = "1.25";
      const before = el.scrollLeft;
      el.scrollLeft += 101;
      return { before, after: el.scrollLeft };
    });
    expect(Number.isInteger(movement.after)).toBe(false);
    const expectedAnchor = Math.round(anchor + (movement.after - movement.before) * 36000);
    await expect.poll(() => new URL(page.url()).searchParams.get("at")).toBe(String(expectedAnchor));
    await expect(date).toHaveValue("2026-11-02");
    await date.fill("2026-11-03");
    await expect(date).toHaveValue("2026-11-03");
    await page.goBack();
    await expect(date).toHaveValue("2026-11-02");
    await expect.poll(() => new URL(page.url()).searchParams.get("at")).toBe(String(expectedAnchor));
    await expect.poll(() => chart.evaluate((el) => el.scrollLeft)).toBeCloseTo(movement.after, 2);
    await page.screenshot({ path: info.outputPath("fractional-pan-back.png"), fullPage: true });
  });

  test("event and selected set details use the URL zone in a UTC browser", async ({ page, timelineFixture }, info) => {
    await page.goto(`/?at=${TIMELINE_NOW - 3600000}&tz=America%2FNew_York&scheduleView=agenda`);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("UTC");
    await page.getByRole("button", { name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra", exact: true }).click();
    const panel = page.getByRole("region", { name: "Event details", exact: true });
    await expect(panel.locator('time[datetime="2026-10-26T21:00:00.000Z"]').first()).toHaveText("Oct 26, 5:00 PM EDT");
    await expect(panel.locator('time[datetime="2026-10-27T01:00:00.000Z"]')).toHaveText("Oct 26, 9:00 PM EDT");
    const selected = panel.locator('[data-selected="true"]');
    await expect(selected).toHaveAttribute("data-slot-id", timelineFixture.slotIds[6]);
    await expect(selected.locator("time")).toHaveText(["5:00 PM GMT-4", "6:00 PM GMT-4"]);
    await expect(selected).toBeInViewport();
    await page.screenshot({ path: info.outputPath("url-zone-selected-set.png") });
  });

  test.describe("DST rollback", () => {
    test.use({ timelineStartAt: Date.UTC(2026, 10, 1, 5, 30) });
    test("detail distinguishes both repeated hours and a crossing set", async ({ page, timelineFixture }, info) => {
      await page.goto(`/?at=${Date.UTC(2026, 10, 1, 5)}&tz=America%2FNew_York&scheduleView=agenda`);
      await page.getByRole("button", { name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra", exact: true }).click();
      const panel = page.getByRole("region", { name: "Event details", exact: true });
      const selected = panel.locator('[data-selected="true"]');
      await expect(selected).toHaveAttribute("data-slot-id", timelineFixture.slotIds[6]);
      await expect(selected.locator("time")).toHaveText(["1:30 AM GMT-4", "1:30 AM GMT-5"]);
      await expect(selected).toBeInViewport();
      await page.screenshot({ path: info.outputPath("dst-crossing-set.png") });
      await panel.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Open Neon Harbor at ORBIT: Interstellar Bassline Orchestra", exact: true }).click();
      await expect(selected).toHaveAttribute("data-slot-id", timelineFixture.slotIds[7]);
      await expect(selected.locator("time")).toHaveText(["1:30 AM GMT-5", "2:30 AM GMT-5"]);
      await expect(selected).toBeInViewport();
      await page.screenshot({ path: info.outputPath("dst-second-hour.png") });
    });
  });
});
