import { expect } from "@playwright/test";
import { test, TIMELINE_NOW, initializeDiscovery, observeDiscoveryQueries } from "./home-discovery-fixture";

type HomeMeasurement = {
  documentPerformanceOriginMs: number;
  searchReadyMs: number | null;
  scheduleReadyMs: number | null;
  discoveryReadyMs: number | null;
  firstArtworkMs: number | null;
  firstDecodedArtworkMs: number | null;
  cls: number;
  layoutShifts: { at: number; value: number; recentInput: boolean }[];
};
declare global {
  interface Window { homePolishMeasurement?: HomeMeasurement }
}

for (const scenario of ["timeline-visual", "discovery-dense"] as const) {
  test.describe(`Home measured ${scenario} @measurement @fixture`, () => {
    test.use({ timelineScenario: scenario });
    test("cold warm and bounded slow observation", async ({ page, timelineFixture, isMobile, baseURL }, info) => {
      test.setTimeout(150000);
      if (!isMobile) await page.setViewportSize({ width: 1280, height: 800 });
      await page.clock.setFixedTime(TIMELINE_NOW);
      await initializeDiscovery(page, timelineFixture, scenario === "timeline-visual" ? timelineFixture.profileIds.slice(2, 4) : timelineFixture.profileIds.slice(0, 2));
      await page.addInitScript(() => {
        const documentPerformanceOriginMs = performance.now();
        const elapsed = () => performance.now() - documentPerformanceOriginMs;
        const state: HomeMeasurement = {
          documentPerformanceOriginMs,
          searchReadyMs: null,
          scheduleReadyMs: null,
          discoveryReadyMs: null,
          firstArtworkMs: null,
          firstDecodedArtworkMs: null,
          cls: 0,
          layoutShifts: [],
        };
        window.homePolishMeasurement = state;
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!("value" in entry) || typeof entry.value !== "number" || !("hadRecentInput" in entry)) continue;
            state.layoutShifts.push({ at: entry.startTime, value: entry.value, recentInput: Boolean(entry.hadRecentInput) });
            if (!entry.hadRecentInput) state.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        const decoded = new WeakSet<HTMLImageElement>();
        const observe = () => {
          if (document.querySelector<HTMLInputElement>('[role="combobox"][aria-label="Search VRDex"]')?.disabled === false) state.searchReadyMs ??= elapsed();
          if (["ready", "partial", "error"].includes(document.querySelector('[aria-label="Schedule data state"]')?.getAttribute("data-state") ?? "")) state.scheduleReadyMs ??= elapsed();
          const discover = document.querySelector('[aria-label="Discover"], [aria-labelledby="discover-heading"]');
          if (discover && discover.getAttribute("aria-busy") !== "true" && discover.querySelector('[data-testid="discovery-event-card"]')) state.discoveryReadyMs ??= elapsed();
          for (const image of document.querySelectorAll<HTMLImageElement>('[aria-label="Discover"] img, [aria-labelledby="discover-heading"] img')) {
            if (image.complete && image.naturalWidth) state.firstArtworkMs ??= elapsed();
            if (decoded.has(image)) continue;
            decoded.add(image);
            image.addEventListener("load", () => {
              state.firstArtworkMs ??= elapsed();
              void image.decode().then(() => { state.firstDecodedArtworkMs ??= elapsed(); }).catch(() => {});
            }, { once: true });
            void image.decode().then(() => { state.firstDecodedArtworkMs ??= elapsed(); }).catch(() => {});
          }
        };
        new MutationObserver(observe).observe(document, { subtree: true, childList: true, attributes: true });
        document.addEventListener("DOMContentLoaded", observe);
      });
      let held = false;
      const buffered: (() => void)[] = [];
      await page.routeWebSocket("**/api/**/sync", socket => {
        const server = socket.connectToServer();
        server.onMessage(message => { if (held) buffered.push(() => socket.send(message)); else socket.send(message); });
      });
      // Equal server and client-chunk prewarm in a disposable browser context.
      // The measured context remains fresh for the cold phase.
      await page.request.get("/");
      const browser = page.context().browser();
      if (!browser) throw Error("Performance measurement requires a native browser");
      const warmContext = await browser.newContext({ baseURL, viewport: page.viewportSize() ?? undefined });
      try {
        const warmPage = await warmContext.newPage();
        await warmPage.clock.setFixedTime(TIMELINE_NOW);
        await warmPage.goto("/");
        await expect(warmPage.getByRole("combobox", { name: "Search VRDex", exact: true })).toBeEnabled();
        await expect(warmPage.getByLabel("Schedule data state")).toHaveAttribute("data-state", /ready|partial/, { timeout: 25000 });
        await expect(warmPage.getByTestId("discovery-event-card").first()).toBeAttached({ timeout: 25000 });
      } finally {
        await warmContext.close();
      }
      const queries = observeDiscoveryQueries(page);
      const measurements = [];
      const at = scenario === "discovery-dense" ? TIMELINE_NOW + 5 * 86400000 - 3600000 : TIMELINE_NOW + 7 * 86400000 - 3600000;
      for (const phase of ["cold", "warm", "bounded-slow"] as const) {
        held = phase === "bounded-slow";
        const release = held ? setTimeout(() => { held = false; buffered.splice(0).forEach(send => send()); }, 1500) : null;
        await page.goto(`/?at=${at}`);
        const search = page.getByRole("combobox", { name: "Search VRDex", exact: true });
        await search.fill("Aurora");
        await expect(search).toHaveValue("Aurora");
        await search.press("Escape");
        let finished = true;
        try {
          await page.waitForFunction(() => {
            const value = window.homePolishMeasurement;
            return value !== undefined && value.scheduleReadyMs !== null && value.discoveryReadyMs !== null;
          }, undefined, { timeout: 25000 });
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
          finished = false;
        } finally {
          if (release) clearTimeout(release);
          held = false; buffered.splice(0).forEach(send => send());
        }
        // Include paint/layout observer delivery after readiness, without a
        // production delay or pretending every image has finished.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const measurement = await page.evaluate(() => {
          const state = window.homePolishMeasurement;
          if (!state) throw Error("Missing document measurement origin");
          const discover = document.querySelector('[aria-label="Discover"], [aria-labelledby="discover-heading"]');
          const images = [...(discover?.querySelectorAll<HTMLImageElement>("img") ?? [])];
          const cards = [...(discover?.querySelectorAll('[data-testid="discovery-event-card"], [data-testid="discovery-club-card"]') ?? [])];
          const artwork = document.querySelector('[data-testid="discovery-event-card"] img');
          return {
            ...state,
            observedMs: performance.now() - state.documentPerformanceOriginMs,
            artworkInventory: {
              eligibleImages: images.length,
              loaded: images.filter(image => image.complete && image.naturalWidth > 0).length,
              failed: images.filter(image => image.complete && image.naturalWidth === 0).length,
              pending: images.filter(image => !image.complete).length,
              cardsWithoutImage: cards.filter(card => !card.querySelector("img")).length,
            },
            scheduleState: document.querySelector('[aria-label="Schedule data state"]')?.getAttribute("data-state"),
            footerDocumentY: (document.querySelector("footer")?.getBoundingClientRect().top ?? 0) + scrollY,
            artworkDocumentY: artwork ? artwork.getBoundingClientRect().top + scrollY : null,
            documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, scrollY,
          };
        });
        for (const value of [measurement.searchReadyMs, measurement.scheduleReadyMs, measurement.discoveryReadyMs, measurement.firstArtworkMs, measurement.firstDecodedArtworkMs]) {
          if (value === null) continue;
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(measurement.observedMs);
        }
        measurements.push({ phase, finished, transportHoldMs: phase === "bounded-slow" ? 1500 : 0, ...measurement, queries: queries.result() });
        await page.screenshot({ path: info.outputPath(`${scenario}-${phase}.png`), fullPage: true });
      }
      const beforeFavorite = queries.result();
      const favorite = page.getByTestId("discovery-club-card").first().getByRole("button");
      if (await favorite.count()) {
        const wasPressed = await favorite.getAttribute("aria-pressed");
        await favorite.click();
        await expect(favorite).toHaveAttribute("aria-pressed", wasPressed === "true" ? "false" : "true");
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect.poll(() => queries.result().pending, { timeout: 15000 }).toBe(0);
      }
      await info.attach("home-performance.json", { body: JSON.stringify({ revision: process.env.HOME_MEASUREMENT_REVISION ?? "working-tree", project: info.project.name, viewport: page.viewportSize(), scenario, measurements, beforeFavorite, afterFavorite: queries.result(), note: "Per-document monotonic origin subtracts fixed-clock time carried across navigations. Prewarmed development Home route on both revisions. Cold=fresh browser context; warm and bounded slow repeat navigation in that context. Artwork routing may disable HTTP cache, so cache hits are not guaranteed. Identical local SVG artwork and explicit system TLS flag. Document-init-relative timings exclude request/TTFB and compiler startup. Image inventory is a current DOM snapshot; absent images can be legitimate fallbacks. One local run per phase; readiness observer and raw layout shifts, not a latency SLA. Null readiness means unfinished within observation budget. Logical first-value bounds do not cap active wire watches." }, null, 2), contentType: "application/json" });
      if (!isMobile && scenario === "timeline-visual") {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({ path: info.outputPath("ordinary-1440.png"), fullPage: true });
      }
    });
  });
}
