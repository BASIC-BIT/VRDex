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
    await expect(page.getByRole("heading", { name: editor.heading })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await waitForVisualReady(page);

    await expect(page).toHaveScreenshot(`${editor.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
      threshold: 0.2,
    });
  });
}
