import { expect } from "@playwright/test";
import { test, TIMELINE_NOW } from "./home-timeline-fixture";

test.describe("Home discovery @flow @fixture", () => {
  test.use({ timelineScenario: "discovery" });
  test.beforeEach(async ({ page, timelineFixture }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.addInitScript(({ profileIds }) => {
      sessionStorage.setItem("vrdex.discovery.session.v1", "discovery-task4");
      localStorage.setItem(
        "vrdex.timeline.preferences.v1",
        JSON.stringify({
          version: 1,
          plan: [],
          favoriteProfileIds: profileIds.slice(0, 2),
        }),
      );
    }, timelineFixture);
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
  });
  test("two event and two club cards use public musical identity and separate actions", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    const discover = page.getByRole("region", {
      name: "Discover",
      exact: true,
    });
    await expect(discover).toBeVisible();
    await discover.scrollIntoViewIfNeeded();
    const events = discover.getByTestId("discovery-event-card");
    const clubs = discover.getByTestId("discovery-club-card");
    await expect(events).toHaveCount(2, { timeout: 20000 });
    await expect(clubs).toHaveCount(2);
    await expect(
      events.first().getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toHaveAttribute(
      "href",
      `/${timelineFixture.runId}-community/events/${timelineFixture.runId}-0`,
    );
    await expect(
      events.nth(1).getByRole("link", { name: "Open Low Tide", exact: true }),
    ).toHaveAttribute(
      "href",
      `/${timelineFixture.runId}-community2/events/${timelineFixture.runId}-1`,
    );
    await expect(
      events.first().getByRole("link", { name: "Aurora", exact: true }),
    ).toHaveAttribute("data-favorite", "true");
    await expect(events.first().getByLabel("Lineup genres")).toContainText(
      "Aurora: Liquid DnB",
    );
    await expect(events.nth(1)).toContainText("Dec 5");
    await expect(
      clubs
        .first()
        .getByRole("link", { name: "Prism Collective", exact: true }),
    ).toHaveAttribute("href", `/${timelineFixture.runId}-community`);
    await expect(
      clubs.nth(1).getByRole("link", { name: "Tidal Society", exact: true }),
    ).toHaveAttribute("href", `/${timelineFixture.runId}-community2`);
    await expect(clubs.first()).toContainText("Liquid DnB");
    await expect(clubs.first()).not.toContainText(/upcoming|next event/i);
    const save = events
      .first()
      .getByRole("button", { name: "Add ORBIT to My night", exact: true });
    if (isMobile) {
      await expect(save).toHaveCSS("opacity", "1");
      await expect(
        events.nth(1).getByRole("button", {
          name: "Add Low Tide to My night",
          exact: true,
        }),
      ).toHaveCSS("opacity", "1");
      await save.tap();
    } else await save.click();
    await expect(
      events.first().getByRole("button", {
        name: "Remove ORBIT from My night",
        exact: true,
      }),
    ).toBeVisible();
    await events
      .first()
      .getByRole("link", { name: "Open ORBIT", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(panel).toHaveCount(1);
    await expect(
      panel.getByRole("heading", { name: "ORBIT", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      events.first().getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toBeFocused();
    await discover.scrollIntoViewIfNeeded();
    await expect(discover.locator("img")).toHaveCount(4);
    await expect
      .poll(() =>
        discover
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (isMobile)
      await expect(
        events.nth(1).getByRole("button", {
          name: "Add Low Tide to My night",
          exact: true,
        }),
      ).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: info.outputPath("home-discovery.png"),
      fullPage: true,
    });
  });
  test("a successful Schedule removal clears a panel capacity warning", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.addInitScript(({ eventIds, profileIds }) => {
      localStorage.setItem(
        "vrdex.timeline.preferences.v1",
        JSON.stringify({
          version: 1,
          plan: [
            { kind: "event", eventId: eventIds[0] },
            ...Array.from({ length: 199 }, (_, i) => ({
              kind: "event",
              eventId: `missing-${i}`,
            })),
          ],
          favoriteProfileIds: profileIds.slice(0, 2),
        }),
      );
    }, timelineFixture);
    await page.reload();
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    const discover = page.getByRole("region", {
      name: "Discover",
      exact: true,
    });
    await discover.scrollIntoViewIfNeeded();
    await discover
      .getByRole("link", { name: "Open Low Tide", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await panel
      .getByRole("button", { name: "Add Low Tide to My night", exact: true })
      .click();
    const warning = page.getByText("Limit reached", { exact: true });
    await expect(warning).toHaveCount(1);
    await expect(warning).toBeInViewport({ ratio: 1 });
    await expect(warning).toHaveCSS("position", "fixed");
    await expect(warning).toHaveCSS("pointer-events", "none");
    if (isMobile) {
      const warningBounds = await warning.boundingBox();
      const navigationBounds = await page
        .getByRole("navigation")
        .first()
        .boundingBox();
      expect(warningBounds).not.toBeNull();
      expect(navigationBounds).not.toBeNull();
      if (warningBounds && navigationBounds)
        expect(warningBounds.y).toBeGreaterThanOrEqual(
          navigationBounds.y + navigationBounds.height + 4,
        );
    }
    expect(
      await warning.evaluate((element) =>
        Number(getComputedStyle(element).zIndex),
      ),
    ).toBeGreaterThan(
      await panel.evaluate((element) =>
        Number(getComputedStyle(element).zIndex),
      ),
    );
    await page.screenshot({ path: info.outputPath("panel-limit.png") });
    await panel.getByRole("button", { name: "Close", exact: true }).focus();
    await panel
      .getByRole("button", { name: "Close", exact: true })
      .press("Enter");
    const remove = page
      .getByRole("region", { name: "My night", exact: true })
      .getByRole("button", { name: "Remove ORBIT from My night", exact: true });
    await remove.scrollIntoViewIfNeeded();
    await expect(warning).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: info.outputPath("schedule-shared-limit.png"),
    });
    await remove.click();
    await expect(page.getByText("Limit reached", { exact: true })).toHaveCount(
      0,
    );
  });
  test("a native Schedule add rejection stays in view and a discovery removal clears it", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.addInitScript(({ eventIds, profileIds }) => {
      localStorage.setItem(
        "vrdex.timeline.preferences.v1",
        JSON.stringify({
          version: 1,
          plan: [
            { kind: "event", eventId: eventIds[1] },
            ...Array.from({ length: 199 }, (_, i) => ({
              kind: "event",
              eventId: `missing-${i}`,
            })),
          ],
          favoriteProfileIds: profileIds.slice(0, 2),
        }),
      );
    }, timelineFixture);
    // The actual discovery fixture's ORBIT is seven days after the fixed clock.
    await page.goto(`/?at=${TIMELINE_NOW + 7 * 24 * 3_600_000 - 3_600_000}`);
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    const bar = page.getByTestId(`event-${timelineFixture.eventIds[0]}`);
    await expect(
      bar.getByRole("button", { name: "Open Aurora at ORBIT", exact: true }),
    ).toBeVisible();
    // Touch uses the existing Agenda actions; chart Add controls are hover-only.
    if (isMobile)
      await page.getByRole("button", { name: "Agenda", exact: true }).click();
    const schedule = page.getByRole("region", { name: "Schedule", exact: true });
    const add = schedule.getByRole("button", {
      name: "Add ORBIT to My night",
      exact: true,
    });
    await add.click();
    const warning = page.getByText("Limit reached", { exact: true });
    await expect(warning).toHaveCount(1);
    await expect(warning).toBeInViewport({ ratio: 1 });
    await expect(add).toBeVisible();
    await page.screenshot({ path: info.outputPath("native-schedule-limit.png") });
    const discover = page.getByRole("region", {
      name: "Discover",
      exact: true,
    });
    await discover
      .getByRole("button", { name: "Remove Low Tide from My night", exact: true })
      .click();
    await expect(warning).toHaveCount(0);
    await add.click();
    await expect(
      schedule
        .getByRole("button", { name: "Remove ORBIT from My night", exact: true })
        .last(),
    ).toBeVisible();
    await expect(warning).toHaveCount(0);
  });
});
