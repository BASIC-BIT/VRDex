import { manualPerformer } from "./event-performer-helpers";
import { expect, test, type Page } from "@playwright/test";

import { prepareVisualPage, waitForVisualReady } from "./public-routes";

test.beforeEach(async ({ page }) => { await prepareVisualPage(page); });

async function setTheme(page: Page, value: "light" | "dark") {
  await page.evaluate(next => {
    localStorage.setItem("vrdex-theme", next);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
  }, value);
  await waitForVisualReady(page);
}

async function capture(page: Page, path: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path, animations: "disabled", caret: "hide", fullPage: true, scale: "css" });
  await expect(page).toHaveScreenshot(path.split("/").pop()!.split("\\").pop()!, { animations: "disabled", caret: "hide", fullPage: true, scale: "css", maxDiffPixelRatio: 0.002, threshold: 0.2 });
}

for (const editor of [
  { name: "event-editor-create", path: "/playwright/event-editor", heading: "Add event", theme: "light" },
  { name: "event-editor-edit", path: "/playwright/event-editor/edit", heading: "Afterglow Harbor Sessions", theme: "dark" },
] as const) {
  test(`${editor.name} @snapshot`, async ({ page }) => {
    await page.goto(editor.path);
    await expect(page.getByRole("heading", { name: editor.heading }).first()).toBeVisible();
    await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
    await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
    await setTheme(page, editor.theme);
    if (editor.name === "event-editor-edit") {
      await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
      await expect(page.getByText("Sep 12, 10:00 PM – Sep 13, 2:00 AM", { exact: true }).first()).toBeVisible();
    }
    for (const step of ["Details", "Lineup", "Review"]) {
      await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step }).click();
      await waitForVisualReady(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page).toHaveScreenshot(`${editor.name}-${step.toLowerCase()}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
        maxDiffPixelRatio: 0.002, scale: "css", threshold: 0.2,
      });
    }
  });
}

for (const mode of ["create", "resumed", "correction", "staff-create", "staff-edit"] as const) {
  for (const color of ["light", "dark"] as const) {
    test(`${mode} ${color} editor evidence @snapshot @fixture`, async ({ page }, info) => {
      if (mode === "resumed") await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({
        version: 1, fields: { communitySlug: "afterglow", title: "Resumed night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, end: { time: "23:00" }, venueLabel: "Harbor" },
      })));
      const path = mode === "staff-create" ? "/playwright/event-editor" : mode === "staff-edit" ? "/playwright/event-editor/edit"
        : mode === "correction" ? "/playwright/event-intake?revision=correction"
          : mode === "resumed" ? "/playwright/event-intake?source=text"
            : "/playwright/event-intake?revision=draft";
      await page.goto(path);
      if (mode === "correction") await page.getByRole("button", { name: "Correct event", exact: true }).click();
      await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
      await setTheme(page, color);
      if (mode === "resumed") {
        await expect(page.getByRole("group", { name: "Selected community" })).toBeVisible();
        await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
      }
      if (mode === "correction") await expect(page.getByRole("button", { name: "Import poster or text" })).toHaveCount(0);
      if (mode === "staff-edit") await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
      await capture(page, info.outputPath(`${mode}-${color}-details.png`));
      for (const step of ["Lineup", "Review"]) {
        await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step }).click();
        await capture(page, info.outputPath(`${mode}-${color}-${step.toLowerCase()}.png`));
      }
    });
  }
}

test("import dialog, failure, and DST states @snapshot @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=stale");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
  await setTheme(page, "light");
  await page.getByRole("button", { name: "Import poster or text" }).click();
  const dialog = page.getByRole("dialog", { name: "Import event info" });
  await expect(dialog).toBeVisible();
  await capture(page, info.outputPath("import-open.png"));
  await dialog.getByLabel("Source text").fill("Afterglow Night");
  await dialog.getByRole("button", { name: "Extract details" }).click();
  await expect(dialog.getByRole("status")).toBeVisible();
  await capture(page, info.outputPath("import-error.png"));
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await page.getByRole("combobox", { name: "Time zone" }).fill("America/New_York");
  await page.getByRole("option").first().click();
  await page.getByLabel("Starts", { exact: true }).fill("2027-03-14T02:30");
  await expect(page.getByText("This local time does not exist.")).toBeVisible();
  await capture(page, info.outputPath("dst-gap.png"));
  await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:30");
  await expect(page.getByLabel("Starts occurrence")).toBeVisible();
  await page.getByText("Add end time", { exact: true }).click();
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-11-01T01:45");
  await expect(page.getByLabel("Ends (optional) occurrence")).toBeVisible();
  await capture(page, info.outputPath("dst-repeat-and-end.png"));
});

for (const color of ["light", "dark"] as const) test(`scheduling states ${color} @snapshot @fixture`, async ({ page }, info) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Harbor night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, end: { time: "21:00" } })));
  await page.goto("/playwright/event-intake"); await setTheme(page, color);
  await expect(page.getByRole("button", { name: "Time zone", exact: true })).toHaveText(/^UTC\s*▾$/);
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  await expect(page.getByRole("option").first()).not.toContainText(" · UTC");
  await expect(page.getByRole("combobox", { name: "Time zone" })).toBeFocused();
  const popoverBackground = await page.getByRole("listbox").evaluate(list => getComputedStyle(list.parentElement!).backgroundColor);
  expect(popoverBackground).not.toContain("rgba");
  await capture(page, info.outputPath(`schedule-${color}-timezone.png`));
  await page.getByRole("combobox", { name: "Time zone" }).press("Escape");
  const nav = page.getByRole("navigation", { name: "Event editor" });
  await nav.getByRole("button", { name: "Lineup", exact: true }).click();
  await capture(page, info.outputPath(`schedule-${color}-setup.png`));
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  for (const [index, row] of (await page.locator('[data-lineup-row]').all()).entries()) await manualPerformer(row.locator("[data-performer-field]"), ["Aurora", "Neon Harbor", "Lumen", "Closing session"][index]);
  await capture(page, info.outputPath(`schedule-${color}-lineup-conflict.png`));
  await page.getByRole("button", { name: "Add slot at position 2", exact: true }).click();
  await page.getByLabel("Slot duration", { exact: true }).fill("15");
  await capture(page, info.outputPath(`schedule-${color}-insertion.png`));
  await page.getByRole("button", { name: "Insert slot", exact: true }).click();
  await page.getByRole("button", { name: "Reset lineup", exact: true }).click();
  await capture(page, info.outputPath(`schedule-${color}-reset.png`));
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await nav.getByRole("button", { name: "Review", exact: true }).click();
  await capture(page, info.outputPath(`schedule-${color}-review-conflict.png`));
  await page.getByRole("button", { name: "Set event end to lineup end", exact: true }).click();
  await capture(page, info.outputPath(`schedule-${color}-review.png`));
});
