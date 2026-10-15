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
}


for (const color of ["light", "dark"] as const) test(`identity and removal evidence ${color} @fixture`, async ({ page }, info) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: {
    communitySlug: "afterglow", title: "Harbor night", worldSlug: "harbor-world", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, doors: { time: "19:30" }, end: { time: "23:00" },
    lineup: [{ clientKey: "linked", position: 0, personSlug: "aurora", performerLabel: "Aurora live", start: { time: "20:00" }, end: { time: "21:00" } }, { clientKey: "manual", position: 1, performerLabel: "Guest set", start: { time: "21:00" }, end: { time: "22:00" } }],
  } })));
  await page.goto("/playwright/event-intake?source=text"); await setTheme(page, color);
  await expect(page.getByLabel("Doors open", { exact: true })).toBeVisible();
  await expect(page.locator('[data-step="Details"]').getByTestId("selected-identity")).toHaveCount(2);
  await capture(page, info.outputPath(`identity-${color}-details.png`));
  const community = page.locator('[data-step="Details"] [data-testid="selected-identity"]').first().locator("..");
  await community.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("combobox", { name: "Community", exact: true }).fill("after");
  await expect(page.getByRole("option")).toHaveCount(2);
  await capture(page, info.outputPath(`identity-${color}-communities.png`));
  await page.getByRole("combobox", { name: "Community", exact: true }).press("Escape");
  const world = page.locator('[data-step="Details"] [data-testid="selected-identity"]').nth(1).locator("..");
  await world.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByRole("combobox", { name: "Where", exact: true }).fill("Harbor");
  await expect(page.getByRole("option")).toHaveCount(1);
  await capture(page, info.outputPath(`identity-${color}-worlds.png`));
  await page.getByRole("combobox", { name: "Where", exact: true }).press("Escape");
  const nav = page.getByRole("navigation", { name: "Event editor" });
  await nav.getByRole("button", { name: "Lineup", exact: true }).click();
  await expect(page.locator('[data-lineup-row]').first().getByRole('textbox', {name: 'Display name as', exact: true})).toHaveValue('Aurora live');
  await expect(page.locator('[data-lineup-row]').nth(1).getByText('Unlinked', {exact: true})).toBeVisible();
  await capture(page, info.outputPath(`identity-${color}-lineup.png`));
  await page.locator('[data-lineup-row]').first().getByRole("button", { name: "Remove slot", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await capture(page, info.outputPath(`identity-${color}-remove.png`));
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-lineup-row]')).toHaveCount(2);
  await nav.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole('button', {name: 'Publish event', exact: true})).toBeVisible();
  await capture(page, info.outputPath(`identity-${color}-review.png`));
});

for (const color of ["light", "dark"] as const) test(`unresolved source clock evidence ${color} @fixture`, async ({ page }, info) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Repeated hour", eventDate: "2026-11-01", timezone: "America/New_York", start: { time: "01:30" } } })));
  await page.goto("/playwright/event-intake?source=text"); await setTheme(page, color);
  await expect(page.getByText(/Unresolved time/)).toBeVisible();
  await expect(page.getByLabel("Starts occurrence", { exact: true })).toBeVisible();
  await capture(page, info.outputPath(`unresolved-${color}-repeat.png`));
});

for (const mode of ["create", "resumed", "correction", "staff-create", "staff-edit"] as const) {
  for (const color of ["light", "dark"] as const) {
    test(`${mode} ${color} editor capture @fixture`, async ({ page }, info) => {
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
      await expect(page.getByLabel("Event title", { exact: true })).toBeVisible();
      await capture(page, info.outputPath(`${mode}-${color}-details.png`));
      for (const step of ["Lineup", "Review"]) {
        await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step }).click();
        await expect(page.locator(`[data-step="${step}"], [data-editor-step="${step}"]`)).toBeVisible();
        await capture(page, info.outputPath(`${mode}-${color}-${step.toLowerCase()}.png`));
      }
    });
  }
}
