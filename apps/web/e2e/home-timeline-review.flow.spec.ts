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

test.describe("compact personal planning @flow @fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("overlappingInterestsUseCompactDistinctLanes", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.getByTestId("night-lanes")).toHaveCount(0);
    for (const i of [2, 3])
      await page
        .getByTestId(`event-${timelineFixture.eventIds[i]}`)
        .getByRole("button", { name: /^(Interested:|Add .*to My night)/ })
        .first()
        .click();
    const bars = page
      .getByTestId("night-lanes")
      .locator("[data-night-reference]");
    await expect(bars).toHaveCount(2);
    const first = await bars.nth(0).boundingBox();
    const second = await bars.nth(1).boundingBox();
    const publicBar = await page
      .getByTestId(`event-${timelineFixture.eventIds[3]}`)
      .boundingBox();
    if (!first || !second || !publicBar) throw Error("Missing bar geometry");
    expect(first.height).toBe(44);
    expect(second.y - first.y).toBe(50);
    expect(publicBar.height).toBe(78);
    const title = await bars.first().locator("strong").boundingBox();
    const label = await page
      .getByRole("heading", { name: "My night", exact: true })
      .boundingBox();
    if (!title || !label) throw Error("Missing compact header");
    expect(
      Math.abs(title.y + title.height / 2 - label.y - label.height / 2),
    ).toBeLessThan(3);
    await page.screenshot({
      path: info.outputPath("compact-overlap.png"),
      fullPage: true,
    });
    await bars
      .first()
      .getByRole("button", { name: /^Remove interest:/ })
      .focus();
    await page.keyboard.press("Enter");
    await expect(bars).toHaveCount(1);
    await expect(
      page.getByRole("region", { name: "Timeline chart" }),
    ).toBeFocused();
    const mixedSet = page
      .getByTestId(`event-${timelineFixture.eventIds[2]}`)
      .getByRole("button", {
        name: "Open Neon Harbor at Glasshouse Sessions",
        exact: true,
      });
    if (isMobile) {
      await mixedSet.tap({ position: { x: 8, y: 8 } });
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      await panel
        .getByRole("button", {
          name: "Add Neon Harbor to My night",
          exact: true,
        })
        .tap();
      await panel.getByRole("button", { name: "Close", exact: true }).tap();
    } else {
      await mixedSet.hover();
      await mixedSet
        .locator("..")
        .getByRole("button", { name: /^Interested:/ })
        .click();
    }
    await expect(bars).toHaveCount(2);
    const mixedWidths = await bars.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width).sort((a, b) => a - b),
    );
    expect(mixedWidths).toEqual([100, 400]);
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await page.screenshot({
      path: info.outputPath("compact-mixed-event-set.png"),
      fullPage: true,
    });
  });

  test("favoriteClubAndDjMarksRemainDistinct", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const event = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    await event
      .getByRole("button", { name: /^(Interested:|Add .*to My night)/ })
      .first()
      .click();
    const night = page.getByTestId("night-lanes");
    await expect(night.locator("[data-favorite-mark]")).toHaveCount(0);
    const compactBar = night.locator("[data-night-reference]");
    await compactBar.evaluate((el) =>
      el.setAttribute("data-retained-node", "true"),
    );
    const beforeFavorite = await compactBar.evaluate((el) => ({
      left: (el as HTMLElement).style.left,
      top: (el as HTMLElement).style.top,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    }));
    await page.evaluate(() => {
      (
        window as Window & { preferenceAnimations?: string[] }
      ).preferenceAnimations = [];
      document.addEventListener("animationstart", (e) => {
        const a = e as AnimationEvent;
        if (a.animationName.includes("selection-pop"))
          (
            window as Window & { preferenceAnimations?: string[] }
          ).preferenceAnimations?.push(
            (a.target as Element)
              .closest("button")
              ?.getAttribute("aria-label") ?? "",
          );
      });
    });
    await event
      .getByRole("button", { name: "Favorite: Prism Collective", exact: true })
      .click();
    await expect(
      night.getByTitle("Favorite club: Prism Collective"),
    ).toHaveCount(1);
    const openSet = event.getByRole("button", {
      name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra",
      exact: true,
    });
    if (isMobile) {
      await openSet.tap();
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      await panel
        .getByRole("button", { name: "Favorite Aurora", exact: true })
        .first()
        .tap();
      await panel.getByRole("button", { name: "Close", exact: true }).tap();
    } else {
      await openSet.hover();
      await event
        .getByRole("button", { name: "Favorite: Aurora", exact: true })
        .first()
        .click();
    }
    await expect(night.locator('[data-favorite-mark="dj"]')).toHaveCount(2);
    const animations = await page.evaluate(
      () =>
        (window as Window & { preferenceAnimations?: string[] })
          .preferenceAnimations,
    );
    expect(animations).not.toContainEqual(expect.stringMatching(/interest/i));
    await expect(compactBar).toHaveAttribute("data-retained-node", "true");
    expect(
      await compactBar.evaluate((el) => ({
        left: (el as HTMLElement).style.left,
        top: (el as HTMLElement).style.top,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
    ).toEqual(beforeFavorite);
    await info.attach("preference-animations.json", {
      body: JSON.stringify(animations),
      contentType: "application/json",
    });
    await page.getByRole("button", { name: "Now", exact: true }).click();
    await page.screenshot({
      path: info.outputPath("compact-favorite-marks.png"),
      fullPage: true,
    });
  });

  test("hoverDjActionsAreSeparateSiblingButtons", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const event = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    const open = event.getByRole("button", {
      name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra",
      exact: true,
    });
    if (isMobile) {
      await open.tap();
      await expect(
        page.getByRole("region", { name: "Event details", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Event details", exact: true })
          .getByRole("button", { name: "Favorite Aurora", exact: true })
          .first(),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("touch-set-panel.png") });
      return;
    }
    const cell = open.locator("..");
    const idleOpen = await open.boundingBox();
    const idleCell = await cell.boundingBox();
    if (!idleOpen || !idleCell) throw Error("Missing DJ cell geometry");
    expect(idleOpen.width).toBeCloseTo(idleCell.width - 1, 1);
    await open.hover();
    await expect(cell.getByRole("button")).toHaveCount(3);
    await expect(cell.locator("button button")).toHaveCount(0);
    const favorite = cell.getByRole("button", {
      name: "Favorite: Aurora",
      exact: true,
    });
    const interest = cell.getByRole("button", { name: /^Interested:/ });
    await expect(favorite).toBeVisible();
    await open.focus();
    await page.keyboard.press("Tab");
    await expect(favorite).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(interest).toBeFocused();
    for (const control of [open, favorite, interest]) {
      await control.hover();
      expect(
        await cell.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toBe("rgba(0, 0, 0, 0)");
    }
    await interest.click();
    await expect(
      cell.getByRole("button", { name: /^Remove interest:/ }),
    ).toHaveAttribute("title", "Remove interest");
    await page.screenshot({
      path: info.outputPath("dj-cell-hover.png"),
      fullPage: true,
    });
  });

  test("wholeEventIncludesSetControls", async ({
    page,
    timelineFixture,
    isMobile,
  }, info) => {
    await page.goto("/");
    await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
      "data-state",
      "ready",
    );
    const event = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const firstSet = event
      .getByRole("button", {
        name: "Open Aurora at ORBIT: Interstellar Bassline Orchestra",
        exact: true,
      })
      .locator("..");
    if (isMobile) {
      await firstSet.getByRole("button", { name: /^Open Aurora/ }).tap();
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      await panel
        .getByRole("button", { name: "Add Aurora to My night", exact: true })
        .tap();
      await panel.getByRole("button", { name: "Close", exact: true }).tap();
    } else {
      await firstSet.getByRole("button", { name: /^Open Aurora/ }).hover();
      await firstSet.getByRole("button", { name: /^Interested:/ }).click();
    }
    const night = page.getByTestId("night-lanes");
    await expect(
      night.getByText("ORBIT: Interstellar Bassline Orchestra", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(night.getByText("Aurora", { exact: true })).toBeVisible();
    await expect(night.locator("[data-night-reference]")).toHaveCSS(
      "height",
      "44px",
    );
    await expect(night.locator("button svg").first()).toHaveCSS(
      "animation-name",
      "none",
    );
    await page.screenshot({
      path: info.outputPath("compact-saved-set-reduced-motion.png"),
      fullPage: true,
    });
    await event
      .getByRole("button", { name: /^(Interested:|Add .*to My night)/ })
      .first()
      .click();
    if (isMobile) {
      await event.getByRole("button", { name: /^Open ORBIT:/ }).tap();
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      await expect(
        panel.getByRole("button", {
          name: "Aurora: Included in ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        }),
      ).toBeDisabled();
      await panel.getByRole("button", { name: "Close", exact: true }).tap();
    } else {
      await expect(
        event.getByRole("button", { name: /^Included with event:/ }),
      ).toHaveCount(2);
      await expect(
        event.getByRole("button", { name: /^Included with event:/ }).first(),
      ).toBeDisabled();
    }
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
          ).plan,
      ),
    ).toEqual([{ kind: "event", eventId: timelineFixture.eventIds[3] }]);
  });

  test.describe("exact late set and partial tracks", () => {
    test.use({ timelineScenario: "detail" });
    test("savedSetKeepsEventAndDjIdentity", async ({
      page,
      timelineFixture,
    }, info) => {
      await page.addInitScript(
        ({ eventId, slotId }) =>
          localStorage.setItem(
            "vrdex.timeline.preferences.v1",
            JSON.stringify({
              version: 1,
              plan: [{ kind: "set", eventId, slotId }],
              favoriteProfileIds: [],
            }),
          ),
        {
          eventId: timelineFixture.eventIds[3],
          slotId: timelineFixture.slotIds[86],
        },
      );
      await page.goto("/");
      const night = page.getByTestId("night-lanes");
      await expect(
        night.getByRole("button", {
          name: "Open ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        }),
      ).toHaveCount(1);
      await expect(
        night.getByRole("button", {
          name: "Open Later-page guest at ORBIT: Interstellar Bassline Orchestra",
          exact: true,
        }),
      ).toHaveCount(1);
      const bar = night.locator("[data-night-reference]");
      await expect(
        page.getByRole("heading", { name: "My night", exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("button", {
          name: "Remove Later-page guest from My night",
          exact: true,
        }),
      ).toBeVisible();
      await expect(bar).toHaveAttribute(
        "title",
        "ORBIT: Interstellar Bassline Orchestra: Later-page guest",
      );
      expect(
        await bar.evaluate((el) =>
          Number.parseFloat((el as HTMLElement).style.width),
        ),
      ).toBeCloseTo(100 / 60, 3);
      expect((await bar.boundingBox())?.width).toBeCloseTo(100 / 60, 1);
      await page.screenshot({
        path: info.outputPath("compact-late-set.png"),
        fullPage: true,
      });
    });
    test("whole event uses loaded authored intervals and honest partial coverage", async ({
      page,
      timelineFixture,
    }, info) => {
      const record = (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value);
      // Fail a real continuation read after the first 80 candidates; never invent roster responses.
      await page.routeWebSocket("**/api/**/sync", (socket) => {
        const server = socket.connectToServer();
        const failures = new Set<number>();
        socket.onMessage((message) => {
          const payload: unknown = JSON.parse(String(message));
          if (
            record(payload) &&
            payload.type === "ModifyQuerySet" &&
            Array.isArray(payload.modifications)
          ) {
            for (const change of payload.modifications) {
              if (
                !record(change) ||
                change.type !== "Add" ||
                typeof change.queryId !== "number" ||
                !Array.isArray(change.args)
              )
                continue;
              const args: unknown = change.args[0];
              if (
                change.udfPath === "eventTimeline:listPublicRoster" &&
                record(args) &&
                args.eventId === timelineFixture.eventIds[3] &&
                typeof args.cursor === "string"
              ) {
                const cursor: unknown = JSON.parse(args.cursor);
                if (record(cursor) && cursor.databaseCursor !== null)
                  failures.add(change.queryId);
              }
            }
          }
          server.send(message);
        });
        server.onMessage((message) => {
          const payload: unknown = JSON.parse(String(message));
          if (
            record(payload) &&
            payload.type === "Transition" &&
            Array.isArray(payload.modifications)
          ) {
            payload.modifications = payload.modifications.map(
              (change: unknown) =>
                record(change) &&
                change.type === "QueryUpdated" &&
                typeof change.queryId === "number" &&
                failures.has(change.queryId)
                  ? {
                      type: "QueryFailed",
                      queryId: change.queryId,
                      errorMessage: "Injected continuation failure",
                      errorData: null,
                      logLines: [],
                      journal: change.journal,
                    }
                  : change,
            );
            socket.send(JSON.stringify(payload));
          } else socket.send(message);
        });
      });
      await page.goto("/");
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "error",
      );
      await page
        .getByTestId(`event-${timelineFixture.eventIds[3]}`)
        .getByRole("button", { name: /^(Interested:|Add .*to My night)/ })
        .first()
        .click();
      const night = page.getByTestId("night-lanes");
      await expect(night.locator("[data-slot-id]")).not.toHaveCount(0);
      await expect(
        night.getByText("Partial lineup", { exact: true }),
      ).toBeVisible();
      const widths = await night
        .locator("[data-slot-id]")
        .evaluateAll((els) =>
          els.map((el) => Number.parseFloat((el as HTMLElement).style.width)),
        );
      expect(widths).toContain(100);
      expect(widths.some((width) => width < 2)).toBe(true);
      await expect(
        night.getByText("SECRET PERSON", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("compact-partial-lineup.png"),
        fullPage: true,
      });
    });
  });
});

test.describe("authored short-set interactions @flow @fixture", () => {
  test.use({ timelineScenario: "short-sets" });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(TIMELINE_NOW);
    await page.emulateMedia({ colorScheme: "dark" });
  });

  for (const clipped of [false, true]) {
    test(
      clipped
        ? "half-hour visible remainder keeps contextual removal"
        : "half-hour interest keeps its compact control without a fallback row",
      async ({ page, timelineFixture }, info) => {
        await page.addInitScript(
          ({ eventId, slotId }) =>
            localStorage.setItem(
              "vrdex.timeline.preferences.v1",
              JSON.stringify({
                version: 1,
                plan: [{ kind: "set", eventId, slotId }],
                favoriteProfileIds: [],
              }),
            ),
          {
            eventId: timelineFixture.eventIds[3],
            slotId: timelineFixture.slotIds[6],
          },
        );
        await page.goto(
          `/?at=${TIMELINE_NOW + (clipped ? 50 * 60_000 : -60 * 60_000)}`,
        );
        await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
          "data-state",
          "ready",
        );
        const night = page.getByTestId("night-lanes");
        const bar = night.locator("[data-night-reference]");
        await expect(bar).toHaveCount(1);
        expect((await bar.boundingBox())?.width).toBe(50);
        expect((await bar.boundingBox())?.height).toBe(44);
        await expect(
          page.getByRole("heading", { name: "My night", exact: true }),
        ).toHaveCount(1);
        const contextualRemove = page.getByRole("button", {
          name: "Remove Aurora from My night",
          exact: true,
        });
        const compactRemove = night.getByRole("button", {
          name: "Remove interest: Aurora at ORBIT: Interstellar Bassline Orchestra",
          exact: true,
          includeHidden: true,
        });
        if (clipped) {
          await expect(contextualRemove).toBeVisible();
          await expect(compactRemove).toBeHidden();
        } else {
          await expect(contextualRemove).toHaveCount(0);
          await expect(compactRemove).toBeVisible();
          const bounds = await compactRemove.boundingBox();
          expect(bounds?.width).toBeGreaterThanOrEqual(24);
          expect(bounds?.height).toBeGreaterThanOrEqual(24);
          await info.attach("compact-removal-geometry.json", {
            body: JSON.stringify(bounds),
            contentType: "application/json",
          });
          expect(
            await compactRemove.evaluate((el) => {
              const b = el.getBoundingClientRect();
              return [
                [b.width / 2, b.height / 2],
                [1, b.height / 2],
                [b.width - 1, b.height / 2],
                [b.width / 2, 1],
                [b.width / 2, b.height - 1],
              ].every(
                ([x, y]) =>
                  document
                    .elementFromPoint(b.x + x, b.y + y)
                    ?.closest("button") === el,
              );
            }),
          ).toBe(true);
        }
        await page.screenshot({
          path: info.outputPath(
            clipped ? "half-hour-clipped.png" : "half-hour-compact.png",
          ),
          fullPage: true,
        });
        await (clipped ? contextualRemove : compactRemove).click();
        await expect(page.getByTestId("night-lanes")).toHaveCount(0);
        expect(
          await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
              ).plan,
          ),
        ).toEqual([]);
      },
    );
  }

  for (const [label, minutes, slotIndex] of [
    ["Aurora", 30, 6],
    ["Neon Harbor", 15, 7],
  ] as const) {
    test(`${minutes}-minute public cells keep independent pointer and keyboard targets`, async ({
      page,
      timelineFixture,
      isMobile,
    }, info) => {
      await page.goto(`/?at=${TIMELINE_NOW - 60 * 60_000}`);
      await expect(page.getByLabel("Schedule data state")).toHaveAttribute(
        "data-state",
        "ready",
      );
      const event = page.getByTestId(`event-${timelineFixture.eventIds[3]}`);
      const open = event.getByRole("button", {
        name: `Open ${label} at ORBIT: Interstellar Bassline Orchestra`,
        exact: true,
      });
      const cell = open.locator("..");
      expect((await cell.boundingBox())?.width).toBe((minutes / 60) * 100);
      const panel = page.getByRole("region", {
        name: "Event details",
        exact: true,
      });
      const reference = {
        kind: "set",
        eventId: timelineFixture.eventIds[3],
        slotId: timelineFixture.slotIds[slotIndex],
      };
      if (isMobile) {
        await open.tap({ position: { x: 6, y: 8 } });
        await expect(panel.locator('[data-selected="true"]')).toHaveAttribute(
          "data-slot-id",
          reference.slotId,
        );
        const selected = panel.locator('[data-selected="true"]');
        await selected
          .getByRole("button", { name: "Favorite Aurora", exact: true })
          .tap();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
              ).plan,
          ),
        ).toEqual([]);
        await selected
          .getByRole("button", {
            name: `Add ${label} to My night`,
            exact: true,
          })
          .tap();
        await page.screenshot({
          path: info.outputPath(`short-${minutes}-touch-panel.png`),
        });
        await panel.getByRole("button", { name: "Close", exact: true }).tap();
      } else {
        await open.hover({ position: { x: 6, y: 8 } });
        const favorite = cell.getByRole("button", {
          name: /^(Favorite|Remove favorite): Aurora$/,
        });
        const interest = cell.getByRole("button", { name: /^Interested:/ });
        await expect(favorite).toBeVisible();
        await expect(interest).toBeVisible();
        const targets = [open, favorite, interest];
        const boxes = await Promise.all(
          targets.map((target) => target.boundingBox()),
        );
        for (let i = 0; i < targets.length; i++) {
          const bounds = boxes[i];
          if (!bounds) throw Error("Missing short-cell target");
          expect(bounds.width).toBeGreaterThanOrEqual(24);
          expect(bounds.height).toBeGreaterThanOrEqual(24);
          expect(
            await targets[i].evaluate((el) => {
              const b = el.getBoundingClientRect();
              return (
                document
                  .elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
                  ?.closest("button") === el
              );
            }),
          ).toBe(true);
          for (const other of boxes.slice(i + 1)) {
            if (!other) throw Error("Missing short-cell sibling");
            const overlap =
              Math.max(
                0,
                Math.min(bounds.x + bounds.width, other.x + other.width) -
                  Math.max(bounds.x, other.x),
              ) *
              Math.max(
                0,
                Math.min(bounds.y + bounds.height, other.y + other.height) -
                  Math.max(bounds.y, other.y),
              );
            expect(overlap).toBe(0);
          }
        }
        await info.attach(`short-${minutes}-target-geometry.json`, {
          body: JSON.stringify(boxes),
          contentType: "application/json",
        });
        // Moving up from the label must keep the attached toolbar reachable.
        for (const target of targets) {
          await target.hover();
          await expect(favorite).toBeVisible();
          await expect(interest).toBeVisible();
        }
        await event.screenshot({
          path: info.outputPath(`short-${minutes}-attached-targets.png`),
        });
        await open.click({ position: { x: 6, y: 8 } });
        await expect(panel.locator('[data-selected="true"]')).toHaveAttribute(
          "data-slot-id",
          reference.slotId,
        );
        expect(
          await page.evaluate(() =>
            JSON.parse(
              localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
            ),
          ),
        ).toEqual(null);
        await panel.getByRole("button", { name: "Close", exact: true }).click();
        await open.focus();
        await page.keyboard.press("Tab");
        await expect(favorite).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(interest).toBeFocused();
        await favorite.click();
        await favorite.focus();
        await page.keyboard.press("Enter");
        await expect(favorite).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.press("Enter");
        await expect(favorite).toHaveAttribute("aria-pressed", "true");
        expect(
          await page.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
              ).plan,
          ),
        ).toEqual([]);
        await interest.click();
        await expect(panel).toHaveCount(0);
        await page.screenshot({
          path: info.outputPath(`short-${minutes}-hover-actions.png`),
          fullPage: true,
        });
      }
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
            ).plan,
        ),
      ).toEqual([reference]);
      expect(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem("vrdex.timeline.preferences.v1") ?? "null",
            ).favoriteProfileIds,
        ),
      ).toEqual([timelineFixture.profileIds[1]]);
      const personal = page
        .getByTestId("night-lanes")
        .locator("[data-night-reference]");
      expect((await personal.boundingBox())?.width).toBe((minutes / 60) * 100);
      await expect(
        page.getByRole("button", {
          name: `Remove ${label} from My night`,
          exact: true,
        }),
      ).toHaveCount(0);
    });
  }
});
