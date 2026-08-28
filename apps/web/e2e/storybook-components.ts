import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "playwright-artifacts", "storybook");

export const componentStories = [
  { id: "design-system-primitives--token-system", name: "token-system" },
  { id: "design-system-primitives--buttons", name: "buttons" },
  { id: "design-system-primitives--badges", name: "badges" },
  { id: "design-system-primitives--cards-and-notices", name: "cards-and-notices" },
  { id: "design-system-primitives--forms-and-tables", name: "forms-and-tables" },
  { id: "design-system-primitives--event-schedule-primitive", name: "event-schedule-primitive" },
  { id: "design-system-primitives--entities-and-metadata", name: "entities-and-metadata" },
  { id: "design-system-primitives--event-schedule-empty-state", name: "event-schedule-empty-state" },
  { id: "design-system-primitives--shell-and-actions", name: "shell-and-actions" },
  { id: "features-temporal-parser--resolved", name: "temporal-parser-resolved" },
  { id: "features-temporal-parser--retention-unavailable", name: "temporal-parser-retention-unavailable" },
  { id: "profiles-media-contribution-editor--inline", name: "profile-media-contribution-editor-inline" },
  // The live player's control strip. Captured here because it is unreachable
  // anywhere else: it renders only once a VRCDN stream is actually connected,
  // which the Playwright fixtures cannot do -- the fixture stream id resolves
  // to nothing, and connecting to a real one spends a viewer slot on a capped
  // plan.
  { id: "media-vrcdn-player-controls--playing", name: "vrcdn-player-controls-playing" },
  { id: "media-vrcdn-player-controls--paused", name: "vrcdn-player-controls-paused" },
  { id: "media-vrcdn-player-controls--fullscreen", name: "vrcdn-player-controls-fullscreen" },
  { id: "media-vrcdn-player-controls--without-volume-slider", name: "vrcdn-player-controls-without-volume-slider" },
  { id: "media-vrcdn-player-controls--connecting", name: "vrcdn-player-controls-connecting" },
] as const;

export async function prepareStorybookVisualPage(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.setAttribute("data-visual-test", "true");
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        transition-property: none !important;
      }
      html {
        scroll-behavior: auto !important;
      }
      body {
        caret-color: transparent !important;
      }
    `;
    document.head.appendChild(style);
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
}

export async function gotoComponentStory(page: Page, storyId: string) {
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
  await expect(page.locator("#storybook-root")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

export async function captureStorybookScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const projectPrefix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const fileName = `${projectPrefix}-${name}.png`;
  const screenshotPath = path.join(screenshotDir, fileName);

  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(fileName, { path: screenshotPath, contentType: "image/png" });
}
