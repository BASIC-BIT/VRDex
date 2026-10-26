import { manualPerformer } from "./event-performer-helpers";
import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "UTC" });
const nav = (page: Page, step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
const staffEvent = { id: "review-event", slug: "review-night", title: "Review night", startAt: Date.UTC(2027, 9, 15, 20), timezone: "UTC", status: "scheduled", communitySlug: "afterglow", source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false, mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [] };

for (const mode of ["create", "draft", "published"] as const) {
  test(`staff ${mode} has one prominent Review action and sends its existing command @fixture`, async ({ page }) => {
    await page.addInitScript(event => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify(event)), { ...staffEvent, publicationState: mode === "published" ? "published" : "draft_private" });
    await page.goto(`/playwright/event-lineup?editor${mode === "create" ? "&mode=create" : ""}`);
    if (mode === "create") {
      await nav(page, "Details");
      await page.getByLabel("Event title", { exact: true }).fill("Review night");
      await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
    }
    await nav(page, "Review");
    const label = mode === "create" ? "Publish event" : mode === "draft" ? "Save and publish" : "Save changes";
    const primary = page.locator('[data-editor-step="Review"]').getByRole("button", { name: label, exact: true });
    await expect(primary).toHaveCount(1);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(1);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(primary).toBeInViewport();
    await expect(primary).toHaveClass(/bg-accent/);
    await expect(page.getByRole("button", { name: mode === "published" ? "Unpublish and save draft" : "Save draft", exact: true })).not.toHaveClass(/bg-accent/);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator('[data-editor-step="Lineup"]')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
    await nav(page, "Review");
    await primary.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("event-lineup-fixture-command"))).toBe(mode === "create" ? "events:createCommunityEvent" : "events:updateCommunityEvent");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).published)).toBe(true);
    await expect(page).toHaveURL(/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions/);
  });
}

for (const correction of [false, true]) {
  test(`contributor ${correction ? "correction" : "publication"} uses its single Review action @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${correction ? "correction" : "draft"}`);
    if (correction) await page.getByRole("button", { name: "Correct event", exact: true }).click();
    if (correction) { await nav(page, "Details"); await page.getByLabel("Event title", { exact: true }).fill("Corrected title"); }
    else {
      await page.getByText("Add start time", { exact: true }).click();
      await page.getByLabel("Starts", { exact: true }).fill("2027-07-15T20:00");
    }
    await nav(page, "Review");
    const label = correction ? "Save changes" : "Publish event";
    const primary = page.locator('[data-step="Review"]').getByRole("button", { name: label, exact: true });
    await expect(primary).toHaveCount(1);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(1);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(primary).toBeInViewport();
    await expect(primary).toHaveClass(/bg-accent/);
    await primary.click();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("event-intake-review-command"))).toBe(correction ? "eventCorrections:updateOwnContributedEvent" : "eventIntake:publishEventIntake");
    const args = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
    expect(args.patch.title).toBe(correction ? "Corrected title" : "Original title");
    if (correction) { expect(args.patch.communitySlug).toBeUndefined(); expect(args.patch.lineup).toBeUndefined(); await expect(primary).toHaveCount(0); }
    else await expect(page).toHaveURL(/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions/);
  });
}

test("staff pending Enter and click send one command @fixture", async ({ page }) => {
  await page.addInitScript(event => { localStorage.setItem("event-lineup-fixture-v1", JSON.stringify(event)); localStorage.setItem("event-lineup-fixture-defer-save", "true"); }, { ...staffEvent, publicationState: "draft_private" });
  await page.goto("/playwright/event-lineup?editor");
  await nav(page, "Review");
  const primary = page.getByRole("button", { name: "Save and publish", exact: true });
  await primary.focus(); await primary.press("Enter");
  await expect(page.getByRole("button", { name: "Saving...", exact: true })).toBeDisabled();
  await page.locator('form').evaluate((form: HTMLFormElement) => { const button = form.querySelector<HTMLButtonElement>('[value="publish"]')!; button.click(); form.requestSubmit(button); });
  expect(await page.evaluate(() => Number(localStorage.getItem("event-lineup-fixture-command-count")))).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("event-lineup-fixture-release-save")));
});

test("contributor pending Enter and click send one correction command @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-review-defer", "true"));
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  await nav(page, "Details"); await page.getByLabel("Event title", { exact: true }).fill("Corrected title");
  await nav(page, "Review");
  const primary = page.getByRole("button", { name: "Save changes", exact: true });
  await primary.focus(); await primary.press("Enter");
  await expect(primary).toBeDisabled();
  await page.locator('form').evaluate((form: HTMLFormElement) => { const button = form.querySelector<HTMLButtonElement>('[data-step="Review"] button[type="submit"]')!; button.click(); form.requestSubmit(button); });
  expect(await page.evaluate(() => Number(sessionStorage.getItem("event-intake-review-count")))).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("event-intake-review-release")));
});

for (const stage of ["Details", "Lineup"]) test(`native Enter on staff ${stage} keeps navigation separate from publication @fixture`, async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor&mode=create");
  await nav(page, "Details"); await page.getByLabel("Event title", { exact: true }).fill("Review night"); await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
  if (stage === "Details") await page.getByLabel("Event title", { exact: true }).press("Enter");
  else { await nav(page, "Lineup"); await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit()); }
  await expect(page.locator(`[data-editor-step="${stage === "Details" ? "Lineup" : "Review"}"]`)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
});

for (const editor of ["staff", "contributor"]) test(`${editor} extends a Review overrun and publishes once @fixture`, async ({ page }) => {
  if (editor === "staff") {
    await page.addInitScript(event => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify(event)), { ...staffEvent, endAt: Date.UTC(2027,9,15,21), publicationState: "published" });
    await page.goto("/playwright/event-lineup?editor");
  } else {
    await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "afterglow", title: "Review night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, end: { time: "21:00" } })));
    await page.goto("/playwright/event-intake");
  }
  await nav(page, "Lineup"); await page.getByRole("button", { name: "Generate", exact: true }).click();
  if (editor === "contributor") for (const [index, row] of (await page.locator("[data-lineup-row]").all()).entries()) await manualPerformer(row.locator("[data-performer-field]"), `Guest ${index + 1}`);
  await nav(page, "Review");
  const panel = page.locator(editor === "staff" ? '[data-editor-step="Review"]' : '[data-step="Review"]');
  await expect(panel.getByText("The lineup ends after the event.", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Set event end to lineup end", exact: true }).click();
  await expect(panel.getByText("The lineup ends after the event.", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: editor === "staff" ? "Save changes" : "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions/);
  if (editor === "staff") {
    const args = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
    expect(args.endAt).toBe(Date.UTC(2027,9,16,0)); expect(args.title).toBe("Review night");
    expect(await page.evaluate(() => Number(localStorage.getItem("event-lineup-fixture-command-count")))).toBe(1);
  } else {
    const args = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-published")!));
    expect(args.end).toMatchObject({ time: "00:00", dayOffset: 1 }); expect(args.title).toBe("Review night");
  }
});

for (const stage of ["Details", "Lineup"] as const) for (const repeated of [false, true]) test(`contributor Review reveals ${stage} ${repeated ? "repeated occurrence" : "DST gap"} @fixture`, async ({ page }) => {
  await page.addInitScript(({ stage, repeated }) => sessionStorage.setItem("event-intake-fixture", JSON.stringify({
    communitySlug: "afterglow", title: "DST night", timezone: "America/New_York", eventDate: repeated ? "2027-11-07" : "2027-03-14", start: { time: stage === "Details" ? repeated ? "01:30" : "02:30" : "00:30" },
    ...(stage === "Lineup" ? { lineup: [{ clientKey: "dst-slot", position: 0, performerLabel: "Aurora", start: { time: repeated ? "01:30" : "02:30" } }] } : {}),
  })), { stage, repeated });
  await page.goto("/playwright/event-intake"); await nav(page, "Review");
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  const label = stage === "Details" ? "Starts" : "Slot 1 start";
  await expect(page.getByLabel(repeated ? `${label} occurrence` : label, { exact: true })).toBeFocused();
  await expect(page.locator(`[data-step="${stage}"]`)).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("event-intake-published"))).toBeNull();
});
