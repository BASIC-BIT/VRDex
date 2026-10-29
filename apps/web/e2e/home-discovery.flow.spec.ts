import { expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import {
  test,
  TIMELINE_NOW,
  initializeDiscovery,
  usableDiscovery,
  observeDiscoveryQueries,
  changeTimelineFixture,
  discoveryTransportFailure,
} from "./home-discovery-fixture";

test.describe("Home discovery @flow @fixture", () => {
  test.use({ timelineScenario: "discovery" });
  test.beforeEach(async ({ page, timelineFixture }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await initializeDiscovery(page, timelineFixture);
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
  });
  test("favoriteChangeKeepsCandidatesAndCards", async ({ page }, info) => {
    const queries = observeDiscoveryQueries(page);
    await page.reload();
    const discover = await usableDiscovery(page);
    const card = discover.getByTestId("discovery-club-card").filter({ has: page.getByRole("link", { name: "Tidal Society", exact: true }) });
    const button = card.getByRole("button");
    await button.scrollIntoViewIfNeeded();
    await button.focus();
    await expect.poll(() => queries.result().pending).toBe(0);
    const beforeBounds = await card.boundingBox();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const before = queries.result();
    await discover.evaluate(element => {
      const state = { minimumCards: element.querySelectorAll('[data-testid="discovery-club-card"]').length };
      Object.assign(window, { discoveryRetention: state });
      new MutationObserver(() => { state.minimumCards = Math.min(state.minimumCards, element.querySelectorAll('[data-testid="discovery-club-card"]').length); }).observe(element, { childList: true, subtree: true });
    });
    await button.click();
    await expect.poll(() => queries.result().counts["homeDiscovery:profileSignals"] ?? 0).toBeGreaterThan(before.counts["homeDiscovery:profileSignals"] ?? 0);
    await expect.poll(() => queries.result().pending).toBe(0);
    const after = queries.result();
    const afterBounds = await card.count() ? await card.boundingBox() : null;
    const afterScroll = await page.evaluate(() => window.scrollY);
    const minimumCards = await page.evaluate(() => (window as unknown as { discoveryRetention: { minimumCards: number } }).discoveryRetention.minimumCards);
    await info.attach("favorite-retention.json", { body: JSON.stringify({ beforeBounds, afterBounds, beforeScroll, afterScroll, before, after, minimumCards }, null, 2), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("favorite-retention.png"), fullPage: true });
    expect(after.favoriteLineupBounds.maxEvents).toBe(2);
    expect(after.favoriteLineupBounds.maxFavorites).toBeLessThanOrEqual(25);
    expect(after.favoriteLineupBounds.emptyRequests).toBe(0);
    expect(minimumCards).toBe(2);
    expect(afterBounds).toEqual(beforeBounds);
    expect(afterScroll).toBe(beforeScroll);
    for (const method of ["listEvents", "listClubs", "eventSignals"]) expect(after.counts[`homeDiscovery:${method}`]).toBe(before.counts[`homeDiscovery:${method}`]);
    await expect(button).toBeFocused();
  });
  test("no favorite IDs register no favorite reads", async ({ page }, info) => {
    await page.evaluate(() => localStorage.setItem("vrdex.timeline.preferences.v1", JSON.stringify({ version: 1, plan: [], favoriteProfileIds: [] })));
    const queries = observeDiscoveryQueries(page);
    await page.reload();
    const discover = await usableDiscovery(page);
    await expect.poll(() => queries.result().pending).toBe(0);
    expect(queries.result().counts["homeDiscovery:profileSignals"] ?? 0).toBe(0);
    expect(queries.result().counts["homeDiscovery:favoriteLineup"] ?? 0).toBe(0);
    await expect(discover.getByLabel("Favorite people")).toHaveCount(0);
    await info.attach("no-favorite-reads.json", { body: JSON.stringify(queries.result(), null, 2), contentType: "application/json" });
  });
  test("revocationClearsRetainedContent even with a focused favorite card", async ({ page, request, timelineFixture }) => {
    const discover = await usableDiscovery(page);
    const card = discover.getByTestId("discovery-club-card").filter({ has: page.getByRole("link", { name: "Tidal Society", exact: true }) });
    await card.getByRole("button").click();
    await expect(card.getByRole("button")).toBeFocused();
    await changeTimelineFixture(request, timelineFixture, 1, "suppress-host");
    await expect(card).toHaveCount(0);
    await expect(discover.getByRole("link", { name: "Open Low Tide", exact: true })).toHaveCount(0);
  });
  test("cold and slow discovery reserve card geometry and settle immediately", async ({ page, isMobile }, info) => {
    if (!isMobile) await page.setViewportSize({ width: 1280, height: 800 });
    let held = true;
    const messages: (() => void)[] = [];
    await page.routeWebSocket("**/api/**/sync", socket => {
      const server = socket.connectToServer();
      server.onMessage(message => { if (held) messages.push(() => socket.send(message)); else socket.send(message); });
    });
    await page.reload();
    const discover = page.getByRole("region", { name: "Discover", exact: true });
    await expect(discover).toHaveAttribute("aria-busy", "true");
    const shell = discover.getByTestId("discovery-placeholder").first();
    await expect(shell).toHaveCount(1);
    const shellBounds = await shell.boundingBox();
    await expect(discover.getByRole("status")).toHaveText("Loading");
    await expect(discover.getByRole("status")).toHaveCount(1);
    await page.getByRole("combobox", { name: "Search VRDex", exact: true }).fill("Aurora");
    await page.screenshot({ path: info.outputPath("slow-home.png"), fullPage: true });
    const releasedAt = performance.now();
    held = false; messages.splice(0).forEach(send => send());
    await usableDiscovery(page);
    await expect(discover).toHaveAttribute("aria-busy", "false");
    await expect(discover.getByTestId("discovery-placeholder")).toHaveCount(0);
    const readyBounds = await discover.getByTestId("discovery-event-card").first().boundingBox();
    expect(readyBounds?.width).toBe(shellBounds?.width);
    expect(readyBounds?.height).toBe(shellBounds?.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => discover.locator("img").evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath("ready-home.png"), fullPage: true });
    await info.attach("loading-geometry.json", { body: JSON.stringify({ shellBounds, readyBounds, releaseToReadyMs: performance.now() - releasedAt }), contentType: "application/json" });
    if (!isMobile) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: info.outputPath("ready-home-1440.png"), fullPage: true });
    }
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
    await expect(events.first().getByLabel("Favorite people")).toContainText(
      "Aurora",
    );
    await expect(events.first()).not.toContainText("Liquid DnB");
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
      .getByRole("button", { name: "Interested: ORBIT", exact: true });
    if (isMobile) {
      await expect(save).toHaveCSS("opacity", "1");
      await expect(
        events.nth(1).getByRole("button", {
          name: "Interested: Low Tide",
          exact: true,
        }),
      ).toHaveCSS("opacity", "1");
      await save.tap();
    } else await save.click();
    await expect(
      events.first().getByRole("button", {
        name: "Remove interest: ORBIT",
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
          name: "Interested: Low Tide",
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
    await page.evaluate(({ eventIds, profileIds }) => {
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
    await page.goto(`/?at=${TIMELINE_NOW + 7 * 86400000 - 3600000}`);
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
      .getByRole("button", { name: "Remove interest: ORBIT", exact: true });
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
    await page.evaluate(({ eventIds, profileIds }) => {
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
    // One initializer preserves the explicit scenario stored on this origin.
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
    const schedule = page.getByRole("region", {
      name: "Schedule",
      exact: true,
    });
    const add = schedule.getByRole("button", {
      name: isMobile ? "Add ORBIT to My night" : "Interested: ORBIT",
      exact: true,
    });
    await add.click();
    const warning = page.getByText("Limit reached", { exact: true });
    await expect(warning).toHaveCount(1);
    await expect(warning).toBeInViewport({ ratio: 1 });
    await expect(add).toBeVisible();
    await page.screenshot({
      path: info.outputPath("native-schedule-limit.png"),
    });
    const discover = page.getByRole("region", {
      name: "Discover",
      exact: true,
    });
    await discover
      .getByRole("button", {
        name: "Remove interest: Low Tide",
        exact: true,
      })
      .click();
    await expect(warning).toHaveCount(0);
    await add.click();
    await expect(
      schedule
        .getByRole("button", {
          name: isMobile ? "Remove ORBIT from My night" : "Remove interest: ORBIT",
          exact: true,
        })
        .last(),
    ).toBeVisible();
    await expect(warning).toHaveCount(0);
  });
  test("Schedule and discovery replace one inspector and synchronize whole-event saves and favorites", async ({
    page,
    timelineFixture,
  }) => {
    await page.goto(
      `/?at=${TIMELINE_NOW + 7 * 86400000 - 3600000}&scheduleView=agenda`,
    );
    const schedule = page.getByRole("region", {
      name: "Schedule",
      exact: true,
    });
    const openSchedule = async () => {
      const trigger = schedule.getByRole("button", {
        name: "Open ORBIT",
        exact: true,
      });
      await trigger.focus();
      await trigger.press("Enter");
    };
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await openSchedule();
    await expect(
      panel.getByRole("heading", { name: "ORBIT", exact: true }),
    ).toBeVisible();
    const discover = await usableDiscovery(page);
    await discover
      .getByRole("link", { name: "Open Low Tide", exact: true })
      .click();
    await expect(panel).toHaveCount(1);
    await expect(
      panel.getByRole("heading", { name: "Low Tide", exact: true }),
    ).toBeVisible();
    await openSchedule();
    await expect(panel).toHaveCount(1);
    await expect(
      panel.getByRole("heading", { name: "ORBIT", exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Add ORBIT to My night", exact: true })
      .click();
    await expect(
      discover.getByRole("button", {
        name: "Remove interest: ORBIT",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      panel.getByRole("button", {
        name: "Aurora: Included in ORBIT",
        exact: true,
      }),
    ).toBeDisabled();
    await panel
      .getByRole("button", { name: "Unfavorite Aurora", exact: true })
      .click();
    await expect(
      discover.getByRole("link", { name: "Aurora", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await discover
      .getByRole("button", { name: "Remove favorite: Prism Collective", exact: true })
      .click();
    // Removing every affinity can legitimately move the card out of the sample.
    await openSchedule();
    await expect(
      panel.getByRole("button", {
        name: "Favorite Prism Collective",
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByRole("button", { name: "Favorite Prism Collective", exact: true })
      .click();
    await expect(
      discover.getByRole("button", {
        name: "Remove favorite: Prism Collective",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    const reloaded = await usableDiscovery(page);
    await expect(
      reloaded.getByRole("button", {
        name: "Remove interest: ORBIT",
        exact: true,
      }),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
      ),
    );
    expect(stored.plan).toEqual([
      { kind: "event", eventId: timelineFixture.eventIds[0] },
    ]);
    expect(stored.favoriteProfileIds).toEqual([timelineFixture.profileIds[0]]);
    expect(Object.keys(stored).sort()).toEqual([
      "favoriteProfileIds",
      "plan",
      "version",
    ]);
  });
  test("native modified event links and club navigation preserve independent actions and Back state", async ({
    page,
    context,
  }, info) => {
    const discover = await usableDiscovery(page);
    const open = discover.getByRole("link", {
      name: "Open ORBIT",
      exact: true,
    });
    const popupPromise = context.waitForEvent("page");
    await open.click({ modifiers: ["Control"] });
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/events\/playwright-timeline-/);
    await expect(
      popup.getByRole("heading", { name: "ORBIT", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toHaveCount(0);
    await popup.close();
    await discover
      .getByRole("button", { name: "Interested: ORBIT", exact: true })
      .click();
    const club = discover
      .getByRole("group", { name: "Clubs", exact: true })
      .getByRole("link", { name: "Tidal Society", exact: true });
    const href = await club.getAttribute("href");
    await club.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(
      page.getByRole("heading", { name: "Tidal Society", exact: true }).first(),
    ).toBeVisible();
    await page.goBack();
    await usableDiscovery(page);
    await expect(
      discover.getByRole("button", {
        name: "Remove interest: ORBIT",
        exact: true,
      }),
    ).toBeVisible();
    await open.focus();
    await open.press("Enter");
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Close", exact: true })
      .press("Enter");
    await expect(open).toBeFocused();
    await expect(open.locator("..")).toHaveCSS("outline-width", "2px");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("native-keyboard-focus.png"),
      fullPage: true,
    });
  });
  test("live public revocation removes ranked metadata and safely closes the selected event", async ({
    page,
    request,
    timelineFixture,
  }) => {
    const discover = await usableDiscovery(page);
    await discover
      .getByRole("link", { name: "Open ORBIT", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(
      panel.getByRole("heading", { name: "ORBIT", exact: true }),
    ).toBeVisible();
    await changeTimelineFixture(request, timelineFixture, 0, "hidden");
    await expect(
      discover.getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toHaveCount(0);
    await expect(panel).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeFocused();
    await expect(
      discover.getByRole("link", { name: "Open Low Tide", exact: true }),
    ).toBeVisible();
    await page.reload();
    await usableDiscovery(page);
    await expect(
      discover.getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toHaveCount(0);
  });
  test("live host suppression revokes both event and club cards, including a local favorite", async ({
    page,
    request,
    timelineFixture,
  }) => {
    const discover = await usableDiscovery(page);
    await discover
      .getByRole("link", { name: "Open ORBIT", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toBeVisible();
    await changeTimelineFixture(request, timelineFixture, 0, "suppress-host");
    await expect(
      discover.getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toHaveCount(0);
    await expect(
      discover.getByRole("link", { name: "Prism Collective", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeFocused();
    await expect(
      discover.getByRole("link", { name: "Open Low Tide", exact: true }),
    ).toBeVisible();
  });
  test("suppression during a failed public refresh clears obsolete cards and Retry restores only eligible data", async ({
    page,
    request,
    timelineFixture,
  }, info) => {
    const transport = await discoveryTransportFailure(page);
    await page.reload();
    const discover = await usableDiscovery(page);
    await discover
      .getByRole("link", { name: "Open ORBIT", exact: true })
      .click();
    transport.setFailure(true);
    await changeTimelineFixture(request, timelineFixture, 0, "suppress-host");
    await expect(
      discover.getByText("Unavailable", { exact: false }),
    ).toBeVisible();
    await expect(discover.getByTestId("discovery-event-card")).toHaveCount(0);
    await expect(discover.getByTestId("discovery-club-card")).toHaveCount(0);
    const failureBounds = await discover.getByRole("status").boundingBox();
    const frameBounds = await discover.getByTestId("discovery-placeholder").first().boundingBox();
    expect(failureBounds).not.toBeNull(); expect(frameBounds).not.toBeNull();
    if (failureBounds && frameBounds) expect(failureBounds.y + failureBounds.height).toBeLessThanOrEqual(frameBounds.y);
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toHaveCount(0);
    const search = page.getByRole("combobox", {
      name: "Search VRDex",
      exact: true,
    });
    await search.fill("Aurora");
    await expect(search).toHaveValue("Aurora");
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Agenda", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await discover.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("failed-public-refresh.png"),
    });
    transport.setFailure(false);
    await discover.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      discover.getByRole("link", { name: "Open Low Tide", exact: true }),
    ).toBeVisible();
    await expect(
      discover.getByRole("link", { name: "Open ORBIT", exact: true }),
    ).toHaveCount(0);
    await expect(
      discover.getByRole("link", { name: "Prism Collective", exact: true }),
    ).toHaveCount(0);
  });
  test("Browse and GET search remain native with JavaScript disabled", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      baseURL,
    });
    try {
      const page = await context.newPage();
      await page.goto("/");
      const browse = page
        .getByRole("region", { name: "Discover", exact: true })
        .getByRole("link", { name: "Browse", exact: true });
      await expect(browse).toHaveAttribute("href", "/discovery");
      await browse.click();
      await expect(page).toHaveURL(/\/discovery$/);
      await page.goto("/");
      await page
        .getByRole("combobox", { name: "Search VRDex", exact: true })
        .fill("Aurora");
      await page
        .getByRole("button", { name: "Search VRDex", exact: true })
        .click();
      await expect(page).toHaveURL(/\/search\?q=Aurora$/);
    } finally {
      await context.close();
    }
  });
  test("fractional-offset event times agree with the shared inspector", async ({
    page,
  }) => {
    await page.goto("/?tz=Asia%2FKathmandu");
    const discover = await usableDiscovery(page);
    const orbit = discover.getByTestId("discovery-event-card").filter({
      has: page.getByRole("link", { name: "Open ORBIT", exact: true }),
    });
    await expect(orbit).toContainText("2:45 AM");
    await orbit.getByRole("link", { name: "Open ORBIT", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Event details", exact: true }),
    ).toContainText("2:45 AM");
  });
});

test.describe("dense Home discovery @flow @fixture", () => {
  test.use({ timelineScenario: "discovery-dense" });
  test("bounded public queries reach distant matches while search and Schedule stay usable; unmount releases watchers", async ({
    page,
    timelineFixture,
  }, info) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.clock.setFixedTime(TIMELINE_NOW);
    await initializeDiscovery(page, timelineFixture);
    const queries = observeDiscoveryQueries(page);
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
      { timeout: 20000 },
    );
    const activation = performance.now();
    const discover = await usableDiscovery(page);
    const usableAt = performance.now();
    await expect(
      discover.getByRole("link", {
        name: "Open Distant Horizons",
        exact: true,
      }),
    ).toBeVisible();
    await expect(discover).toContainText("Deep journeys");
    await expect(discover).not.toContainText("SECRET");
    await expect(discover.getByTestId("discovery-event-card")).toHaveCount(2);
    await expect(discover.getByTestId("discovery-club-card")).toHaveCount(2);
    const first = queries.result();
    expect(first.maximumPending).toBeLessThanOrEqual(3);
    expect(first.totalAdditions).toBeLessThanOrEqual(62);
    expect(first.pending).toBe(0);
    await page
      .getByRole("combobox", { name: "Search VRDex", exact: true })
      .fill("Aurora");
    await expect(
      page.getByRole("combobox", { name: "Search VRDex", exact: true }),
    ).toHaveValue("Aurora");
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Timeline", exact: true }),
    ).toBeVisible();
    await discover.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath("dense-discovery.png"),
      fullPage: true,
    });
    await discover
      .getByRole("link", { name: "Browse", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/discovery$/);
    await expect.poll(() => queries.result().active).toBe(0);
    await page.goBack();
    await usableDiscovery(page);
    expect(queries.result().maximumPending).toBeLessThanOrEqual(3);
    await info.attach("discovery-query-metrics.json", {
      body: JSON.stringify(
        {
          project: info.project.name,
          fixtureEvents: 246,
          viewportToUsableMs: usableAt - activation,
          firstQueryToUsableMs:
            first.firstAddedAt === undefined
              ? null
              : usableAt - first.firstAddedAt,
          initial: first,
          afterUnmountAndBack: queries.result(),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
  test("minute expiry refills inspected alternatives without discovery reads or closing the inspector", async ({
    page,
    timelineFixture,
  }, info) => {
    // Existing owned fixture: ORBIT starts seven days after the fixture anchor.
    const beforeStart = TIMELINE_NOW - 30 * 60000 + 7 * 86400000 - 30000;
    await page.clock.install({ time: beforeStart });
    await page.emulateMedia({ colorScheme: "dark" });
    await initializeDiscovery(page, timelineFixture);
    const queries = observeDiscoveryQueries(page);
    await page.goto("/");
    const discover = await usableDiscovery(page);
    const orbit = discover.getByRole("link", { name: "Open ORBIT", exact: true });
    await expect(orbit).toBeVisible();
    await expect(discover.getByRole("link", { name: "Open Distant Horizons", exact: true })).toBeVisible();
    await orbit.click();
    const panel = page.getByRole("region", { name: "Event details", exact: true });
    await expect(panel.getByRole("heading", { name: "ORBIT", exact: true })).toBeVisible();
    const before = queries.result();
    expect(before.pending).toBe(0);
    await page.clock.fastForward(60000);
    await expect(orbit).toHaveCount(0);
    await expect(discover.getByTestId("discovery-event-card")).toHaveCount(2);
    // Fallback may prefer another public host over Low Tide's shared host.
    await expect(discover.getByRole("link", { name: "Open Distant Horizons", exact: true })).toBeVisible();
    await expect(discover.getByText("No events", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "ORBIT", exact: true })).toBeVisible();
    const after = queries.result();
    for (const method of ["listEvents", "listClubs", "eventSignals", "profileSignals"]) expect(after.counts[`homeDiscovery:${method}`]).toBe(before.counts[`homeDiscovery:${method}`]);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeFocused();
    await info.attach("discovery-expiry-metrics.json", {
      body: JSON.stringify({ project: info.project.name, before, after }, null, 2),
      contentType: "application/json",
    });
  });

  test("focusedCardSurvivesOrdinaryRerank until blur after another tab updates favorites", async ({ page, context, timelineFixture }, info) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await initializeDiscovery(page, timelineFixture);
    const queries = observeDiscoveryQueries(page);
    await page.goto("/");
    const discover = await usableDiscovery(page);
    const open = discover.getByRole("link", { name: "Open Distant Horizons", exact: true });
    const other = await context.newPage();
    await other.goto("/search");
    await page.bringToFront();
    await open.focus();
    const beforeBounds = await open.boundingBox();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const before = queries.result();
    await other.evaluate(id => {
      const preferences = JSON.parse(localStorage.getItem("vrdex.timeline.preferences.v1")!);
      preferences.favoriteProfileIds.push(id);
      localStorage.setItem("vrdex.timeline.preferences.v1", JSON.stringify(preferences));
    }, timelineFixture.profileIds[7]);
    await expect.poll(() => queries.result().counts["homeDiscovery:profileSignals"] ?? 0).toBeGreaterThan(before.counts["homeDiscovery:profileSignals"] ?? 0);
    await expect.poll(() => queries.result().pending).toBe(0);
    await expect(open).toBeFocused();
    expect(await open.boundingBox()).toEqual(beforeBounds);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
    const after = queries.result();
    for (const method of ["listEvents", "listClubs", "eventSignals"]) expect(after.counts[`homeDiscovery:${method}`]).toBe(before.counts[`homeDiscovery:${method}`]);
    await discover.getByRole("link", { name: "Browse", exact: true }).first().focus();
    await expect(open).toHaveCount(0);
    await expect(discover.getByRole("link", { name: "Open Low Tide", exact: true })).toBeVisible();
    await info.attach("focused-rerank.json", { body: JSON.stringify({ beforeBounds, beforeScroll, before, after }, null, 2), contentType: "application/json" });
    await other.close();
  });

  test("inspectorOutlivesRecommendationMembership", async ({
    page,
    timelineFixture,
  }, info) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.emulateMedia({ colorScheme: "dark" });
    await initializeDiscovery(page, timelineFixture);
    const queries = observeDiscoveryQueries(page);
    await page.goto("/");
    const discover = await usableDiscovery(page);
    const open = discover.getByRole("link", {
      name: "Open Distant Horizons",
      exact: true,
    });
    await open.click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(
      panel.getByRole("heading", { name: "Distant Horizons", exact: true }),
    ).toBeVisible();
    const beforeFavorite = queries.result();
    const favoriteStart = performance.now();
    await panel
      .getByRole("button", {
        name: "Favorite An Exceptionally Long Public Performer Name",
        exact: true,
      })
      .click();
    await expect(open).toHaveCount(0);
    await expect(
      discover.getByRole("link", { name: "Open Low Tide", exact: true }),
    ).toBeVisible();
    const afterFavorite = queries.result();
    // Cached first values complete logical reads before wire revalidation.
    // Preserve the cold bound; report the warm protocol burst separately.
    for (const method of ["listEvents", "listClubs", "eventSignals"]) expect(afterFavorite.counts[`homeDiscovery:${method}`]).toBe(beforeFavorite.counts[`homeDiscovery:${method}`]);
    expect(afterFavorite.maximumActive).toBeLessThanOrEqual(42);
    await info.attach("discovery-favorite-rebuild-metrics.json", {
      body: JSON.stringify(
        {
          project: info.project.name,
          rerankMs: performance.now() - favoriteStart,
          additionalQueries:
            afterFavorite.totalAdditions - beforeFavorite.totalAdditions,
          initial: beforeFavorite,
          afterFavorite,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    await expect(panel).toHaveCount(1);
    await expect(
      panel.getByRole("heading", { name: "Distant Horizons", exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: info.outputPath("reranked-discovery-focus.png"),
      fullPage: true,
    });
  });

  test("shared-load benchmark keeps discovery, search, toolbar and inspector interactive during dense Schedule hydration", async ({
    page,
    timelineFixture,
  }, info) => {
    test.setTimeout(60000);
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.emulateMedia({ colorScheme: "dark" });
    await initializeDiscovery(page, timelineFixture);
    const queries = observeDiscoveryQueries(page);
    const navigation = performance.now();
    await page.goto(`/?at=${TIMELINE_NOW + 5 * 86400000 - 3600000}`);
    const activation = performance.now();
    const discover = await usableDiscovery(page);
    const usableAt = performance.now();
    const state = page.getByLabel("Schedule data state");
    const stateAtCards = await state.getAttribute("data-state");
    const input = page.getByRole("combobox", {
      name: "Search VRDex",
      exact: true,
    });
    const searchStart = performance.now();
    await input.fill("Aurora");
    await expect(input).toHaveValue("Aurora");
    const searchMs = performance.now() - searchStart;
    const toolbarStart = performance.now();
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Agenda", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const toolbarMs = performance.now() - toolbarStart;
    const panelStart = performance.now();
    await discover
      .getByRole("link", { name: "Open Distant Horizons", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Event details",
      exact: true,
    });
    await expect(
      panel.getByRole("heading", { name: "Distant Horizons", exact: true }),
    ).toBeVisible();
    const panelMs = performance.now() - panelStart;
    await page.screenshot({
      path: info.outputPath("shared-load-inspector.png"),
    });
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    const remainingBudget = Math.max(
      1,
      25000 - (performance.now() - navigation),
    );
    let settledAt: number | null = null;
    try {
      await page.waitForFunction(
        () =>
          ["ready", "partial", "error"].includes(
            document
              .querySelector('[aria-label="Schedule data state"]')
              ?.getAttribute("data-state") ?? "",
          ),
        undefined,
        { timeout: remainingBudget },
      );
      settledAt = performance.now();
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError")
        throw error;
    }
    const metrics = {
      project: info.project.name,
      fixtureEvents: 246,
      scheduleNearEvents: 240,
      viewportToUsableMs: usableAt - activation,
      firstQueryToUsableMs:
        queries.result().firstAddedAt === undefined
          ? null
          : usableAt - queries.result().firstAddedAt!,
      scheduleStateAtUsableCards: stateAtCards,
      scheduleObservedState: await state.getAttribute("data-state"),
      scheduleSettledAfterNavigationMs:
        settledAt === null ? null : settledAt - navigation,
      observedAfterNavigationMs: performance.now() - navigation,
      searchMs,
      toolbarMs,
      panelMs,
      discovery: queries.result(),
    };
    expect(metrics.discovery.maximumPending).toBeLessThanOrEqual(3);
    await info.attach("discovery-shared-load-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
  });
});


test.describe("outside-sample focused discovery club @flow @fixture", () => {
  test.use({ timelineScenario: "discovery-clubs" });
  for (const revoke of [false, true]) test(`outside-sample club ${revoke ? "revocation clears a focused pin" : "unfavorite retains one existing watch until blur"}`, async ({ page, request, timelineFixture }, info) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await initializeDiscovery(page, timelineFixture, [timelineFixture.profileIds[0]]);
    const native = new ConvexHttpClient(process.env.PLAYWRIGHT_CONVEX_URL ?? "http://127.0.0.1:3210");
    const samples = await Promise.all((["asc", "desc"] as const).map(direction => native.query(api.homeDiscovery.listClubs, { direction })));
    for (const sample of samples) { expect(sample.items).toHaveLength(12); expect(sample.items.map(club => club.id)).not.toContain(timelineFixture.profileIds[0]); }
    const queries = observeDiscoveryQueries(page);
    await page.goto("/");
    const discover = await usableDiscovery(page);
    const card = discover.getByTestId("discovery-club-card").filter({ has: page.getByRole("link", { name: "Prism Collective", exact: true }) });
    const button = card.getByRole("button");
    await button.scrollIntoViewIfNeeded(); await button.focus();
    await expect.poll(() => queries.result().pending).toBe(0);
    const before = queries.result();
    const beforeBounds = await card.boundingBox(), beforeScroll = await page.evaluate(() => window.scrollY);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    // The selected-card membership query ends; the original favorite-profile
    // source stays live, with no replacement query for the focus pin.
    await expect.poll(() => queries.result().active).toBe(before.active - 1);
    const retained = queries.result();
    await expect(button).toBeFocused();
    expect(await card.boundingBox()).toEqual(beforeBounds);
    expect(await page.evaluate(() => window.scrollY)).toBe(beforeScroll);
    expect(retained.totalAdditions).toBe(before.totalAdditions);
    expect(retained.counts["homeDiscovery:profileSignals"]).toBe(1);
    await page.screenshot({ path: info.outputPath("outside-sample-retained.png"), fullPage: true });
    if (revoke) {
      await changeTimelineFixture(request, timelineFixture, 0, "suppress-host");
      await expect(card).toHaveCount(0);
      await expect(discover.getByRole("link", { name: "Open ORBIT", exact: true })).toHaveCount(0);
    } else {
      await discover.getByRole("link", { name: "Browse", exact: true }).first().focus();
      await expect(card).toHaveCount(0);
      await expect.poll(() => queries.result().active).toBe(retained.active - 1);
      expect(queries.result().totalAdditions).toBe(before.totalAdditions);
    }
    await info.attach("outside-sample-pin.json", { body: JSON.stringify({ sampleSizes: samples.map(sample => sample.items.length), excludedFavorite: true, beforeBounds, beforeScroll, before, retained, after: queries.result(), revoke }, null, 2), contentType: "application/json" });
  });
});
