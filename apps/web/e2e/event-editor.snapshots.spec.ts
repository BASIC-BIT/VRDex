import { expect, test } from "@playwright/test";

import { prepareVisualPage, waitForVisualReady } from "./public-routes";

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const editor of [
  { name: "event-editor-create", path: "/playwright/event-editor", heading: "Add event", theme: "light" },
  { name: "event-editor-edit", path: "/playwright/event-editor/edit", heading: "Afterglow Harbor Sessions", theme: "dark" },
]) {
  test(`${editor.name} @snapshot`, async ({ page }) => {
    await page.goto(editor.path);
    await expect(page.getByRole("heading", { name: editor.heading }).first()).toBeVisible();
    // A step change proves hydration before capturing the initially selected Source.
    await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
    await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
    await page.evaluate(theme => {
      localStorage.setItem("vrdex-theme", theme);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }, editor.theme);
    if (editor.name === "event-editor-edit") await expect(page.getByText("Sep 12, 10:00 PM", { exact: true }).first()).toBeVisible();
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
