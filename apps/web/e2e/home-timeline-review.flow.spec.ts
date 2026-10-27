import { expect } from "@playwright/test";
import { test, TIMELINE_NOW } from "./home-timeline-fixture";

const HOUR = 3_600_000;

test.describe("timeline review regressions @flow @fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("mouse drag continues smoothly across a canvas origin boundary", async ({
    page,
  }) => {
    const boundary = Math.ceil(TIMELINE_NOW / (48 * HOUR)) * 48 * HOUR;
    await page.goto(`/?at=${boundary - HOUR / 10}`);
    const chart = page.getByRole("region", { name: "Timeline chart" });
    await expect(chart).toBeVisible();
    await expect.poll(() => chart.evaluate((el) => el.scrollLeft)).toBe(9590);
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw Error("Missing chart bounds");
    await page.mouse.move(box.x + 250, box.y + 48);
    await page.mouse.down();
    await page.mouse.move(box.x + 230, box.y + 48);
    await expect.poll(() => chart.evaluate((el) => el.scrollLeft)).toBe(4810);
    await page.mouse.move(box.x + 229, box.y + 48);
    await expect.poll(() => chart.evaluate((el) => el.scrollLeft)).toBe(4811);
    await page.mouse.up();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("at"))
      .toBe(String(boundary + 0.11 * HOUR));
  });

  for (const [zone, label] of [
    ["Asia/Kolkata", "5:30 AM"],
    ["Asia/Kathmandu", "5:45 AM"],
  ]) {
    test(`hour ticks retain minutes in ${zone}`, async ({ page }, info) => {
      await page.goto(`/?at=${Date.UTC(2026, 9, 26)}&tz=${zone}`);
      const chart = page.getByRole("region", { name: "Timeline chart" });
      await expect(
        chart.getByText(label, { exact: true }).first(),
      ).toBeAttached();
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      await chart.locator("img").evaluateAll(async (images) => {
        await Promise.all(
          images.map(async (image) => {
            if (image instanceof HTMLImageElement) {
              image.loading = "eager";
              await image.decode();
            }
          }),
        );
      });
      await chart.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("fractional-hours.png") });
    });
  }

  test("ongoing identity stays inside the visible bar without changing its interval", async ({
    page,
    timelineFixture,
  }, info) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const chart = page.getByRole("region", { name: "Timeline chart" });
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[0]}`);
    await chart.scrollIntoViewIfNeeded();
    const original = await bar.evaluate((el) => ({
      left: el.style.left,
      width: el.style.width,
    }));
    const title = bar.locator("strong");
    const logo = bar.locator("img, [aria-hidden=true]").first();
    await expect(title).toBeInViewport({ ratio: 1 });
    await expect(logo).toBeInViewport({ ratio: 1 });
    await chart.evaluate((el) => {
      el.scrollLeft += 25;
    });
    await expect(title).toBeInViewport({ ratio: 1 });
    await expect(logo).toBeInViewport({ ratio: 1 });
    expect(
      await bar.evaluate((el) => ({
        left: el.style.left,
        width: el.style.width,
      })),
    ).toEqual(original);
    await page.screenshot({ path: info.outputPath("ongoing-identity.png") });
  });

  for (const action of ["Agenda", "Favorites only", "date"]) {
    test(`Back restores the pending pan before ${action}`, async ({ page }) => {
      const initial = TIMELINE_NOW - HOUR;
      await page.goto(`/?at=${initial}`);
      const chart = page.getByRole("region", { name: "Timeline chart" });
      await expect(chart).toBeVisible();
      await page.clock.install({ time: TIMELINE_NOW });
      await page.clock.pauseAt(TIMELINE_NOW + 1000);
      const before = await chart.evaluate((el) => el.scrollLeft);
      await chart.press("ArrowRight");
      await expect
        .poll(() => chart.evaluate((el) => el.scrollLeft))
        .toBe(before + 100);
      if (action === "date")
        await page
          .getByLabel("Schedule date", { exact: true })
          .fill("2026-10-28");
      else
        await page.getByRole("button", { name: action, exact: true }).click();
      await page.goBack();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("at"))
        .toBe(String(initial + HOUR));
      await page.clock.resume();
      await expect
        .poll(() => chart.evaluate((el) => el.scrollLeft))
        .toBe(before + 100);
    });
  }
});
