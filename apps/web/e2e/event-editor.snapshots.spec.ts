import { expect, test } from "@playwright/test";

import { prepareVisualPage, waitForVisualReady } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const editor of [
  { name: "event-editor-create", path: "/playwright/event-editor", heading: "Add event" },
  { name: "event-editor-edit", path: "/playwright/event-editor/edit", heading: "Afterglow Harbor Sessions" },
]) {
  test(`${editor.name} @snapshot`, async ({ page }) => {
    await page.goto(editor.path);
    await expect(page.getByRole("heading", { name: editor.heading }).first()).toBeVisible();
    await waitForVisualReady(page);

    for (const step of ["Source", "Details", "Lineup", "Review"]) {
      await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step }).click();
      await waitForVisualReady(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page).toHaveScreenshot(`${editor.name}-${step.toLowerCase()}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: true,
        maxDiffPixelRatio: 0.002,
        scale: "css",
        threshold: 0.2,
    });
    }
  });
}
