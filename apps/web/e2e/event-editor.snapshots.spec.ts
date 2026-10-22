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

async function captureEditorScreenshot(page: Page, screenshot: () => Promise<unknown>) {
  await page.locator("img").evaluateAll(async images => {
    await Promise.all(images.map(async image => {
      if (image instanceof HTMLImageElement) {
        image.loading = "eager";
        await image.decode();
      }
    }));
  });
  await screenshot();
}

for (const outcome of ["load", "decode error"] as const) {
  test(`editor capture waits for artwork ${outcome} @flow @fixture`, async ({ page }, info) => {
    await page.addInitScript(() => {
      sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Harbor night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, end: { time: "21:00" } }));
      const decode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function () {
        if (this.src.includes("fixture-afterglow-event-poster")) document.documentElement.dataset.editorArtworkDecode = "pending";
        return decode.call(this);
      };
    });
    let notifyRequest!: () => void;
    const requested = new Promise<void>(resolve => { notifyRequest = resolve; });
    let releaseImage!: () => void;
    const released = new Promise<void>(resolve => { releaseImage = resolve; });
    await page.route("**/api/e2e/fixture-assets/fixture-afterglow-event-poster", async route => {
      notifyRequest();
      await released;
      if (outcome === "decode error") await route.fulfill({ contentType: "image/svg+xml", body: "invalid image" });
      else await route.continue();
    });
    await page.goto("/playwright/event-intake", { waitUntil: "domcontentloaded" });
    await requested;
    let notifyCapture!: () => void;
    const started = new Promise<void>(resolve => { notifyCapture = resolve; });
    let captureStarted = false;
    const capturing = captureEditorScreenshot(page, async () => {
      captureStarted = true;
      notifyCapture();
      return page.screenshot({ path: info.outputPath("delayed-editor-artwork.png"), fullPage: true, scale: "css" });
    });
    // Retain the rejection until the route is released and asserted below.
    const completed = capturing.then(() => null, (error: unknown) => error instanceof Error ? error : new Error(String(error)));
    try {
      const first = await Promise.race([
        started.then(() => "capture"),
        page.waitForFunction(() => document.documentElement.dataset.editorArtworkDecode === "pending").then(() => "decode"),
      ]);
      expect(first).toBe("decode");
      expect(captureStarted).toBe(false);
      releaseImage();
      const error = await completed;
      if (outcome === "decode error") {
        expect(error?.message).toMatch(/(?:image|source).*decod/i);
        expect(captureStarted).toBe(false);
      } else {
        expect(error).toBeNull();
        expect(captureStarted).toBe(true);
        expect(await page.locator('img[src*="fixture-afterglow-event-poster"]').first().evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
      }
    } finally {
      releaseImage();
      await completed;
    }
  });
}

async function capture(page: Page, path: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await captureEditorScreenshot(page, () => page.screenshot({ path, animations: "disabled", caret: "hide", fullPage: true, scale: "css" }));
  // Keep collecting later states when a visual differs; the test still fails.
  await expect.soft(page).toHaveScreenshot(path.split("/").pop()!.split("\\").pop()!, { animations: "disabled", caret: "hide", fullPage: true, scale: "css", maxDiffPixelRatio: 0.002, threshold: 0.2 });
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
      await expect(page.locator(`[data-editor-step="${step}"]`)).toBeVisible();
      await waitForVisualReady(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await captureEditorScreenshot(page, () => expect.soft(page).toHaveScreenshot(`${editor.name}-${step.toLowerCase()}.png`, {
        animations: "disabled", caret: "hide", fullPage: true,
        maxDiffPixelRatio: 0.002, scale: "css", threshold: 0.2,
      }));
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
        await expect(page.locator('[data-step="Details"] [data-testid="selected-identity"]').first()).toBeVisible();
        await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
      }
      if (mode === "correction") await expect(page.getByRole("button", { name: "Import poster or text" })).toHaveCount(0);
      if (mode === "staff-edit") await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeVisible();
      await expect(page.locator('[data-step="Details"], [data-editor-step="Details"]')).toBeVisible();
      await capture(page, info.outputPath(`${mode}-${color}-details.png`));
      for (const step of ["Lineup", "Review"]) {
        await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step }).click();
        await expect(page.locator(`[data-step="${step}"], [data-editor-step="${step}"]`)).toBeVisible();
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
  const selectedCommunity = page.locator('[data-step="Details"]').getByTestId("selected-identity");
  const previewCommunity = page.getByRole("complementary", { name: "Event preview" }).getByLabel("Community", { exact: true });
  for (const community of [selectedCommunity, previewCommunity]) {
    await expect(community).toContainText("Afterglow Social");
  }
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
