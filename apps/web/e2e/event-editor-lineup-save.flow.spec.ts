import { expect, test, type Page } from "@playwright/test";
import { BACKEND_ERROR_COPY } from "../src/lib/error-copy";

test.use({ timezoneId: "UTC" });
const storageKey = "event-lineup-fixture-v1";
const nav = (page: Page, step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
const saveButton = (page: Page) => page.getByRole("button", { name: "Save draft", exact: true });
const submission = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(`${key}-submission`)!), storageKey);

async function openEditor(page: Page, mode: "create" | "edit") {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({
    id: "lineup-save", slug: "lineup-save", title: "Lineup save", startAt: Date.UTC(2027, 9, 15, 20), endAt: Date.UTC(2027, 9, 15, 23), timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "draft_private",
    source: { sourceType: "community", label: "Afterglow" }, mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], usesCanonicalLineup: true,
    lineup: [{ key: "original", position: 0, displayLabel: "Original guest", roleLabel: "DJ", startAt: Date.UTC(2027, 9, 15, 20), endAt: Date.UTC(2027, 9, 15, 21) }],
    slots: [{ clientKey: "original", playbackKey: "original", position: 0, displayLabel: "Original guest", roleLabel: "DJ", startAt: Date.UTC(2027, 9, 15, 20), endAt: Date.UTC(2027, 9, 15, 21), source: { sourceType: "community", label: "Afterglow" } }],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: ["original"], preservedWorldAssociationIds: [],
  })), storageKey);
  await page.goto(`/playwright/event-lineup?editor&mode=${mode}`);
  if (mode === "create") {
    await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:00");
    await page.getByLabel("Event title", { exact: true }).fill("Lineup save");
    await nav(page, "Lineup");
    await page.getByLabel("Slots", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    await page.getByRole("combobox", { name: "Performer", exact: true }).fill("Original guest");
    await page.getByRole("button", { name: "Add manual entry", exact: true }).click();
  }
  await changeRole(page, "Submitted role");
}

async function changeRole(page: Page, role: string) {
  await nav(page, "Lineup");
  const row = page.locator("[data-lineup-row]").first();
  if (!await row.getByLabel("Role or style", { exact: true }).isVisible()) await row.locator("summary").filter({ hasText: "Details" }).click();
  await row.getByLabel("Role or style", { exact: true }).fill(role);
}

async function save(page: Page) {
  await saveButton(page).click();
  await expect(saveButton(page)).toBeEnabled();
  await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "false");
}

for (const mode of ["create", "edit"] as const) {
  test(`${mode} repeated saves omit unchanged lineup and preserve another editor's update @flow @fixture`, async ({ page }) => {
    await openEditor(page, mode);
    await save(page);
    expect((await submission(page)).lineup[0].roleLabel).toBe("Submitted role");
    await nav(page, "Details");
    await page.getByLabel("Starts", { exact: true }).fill("2027-10-15T20:15");
    await save(page);
    expect((await submission(page)).lineup[0].startAt).toBe(Date.UTC(2027, 9, 15, 20, 15));

    await page.evaluate(key => {
      const remote = JSON.parse(localStorage.getItem(key)!);
      remote.lineup[0].displayLabel = "Remote guest";
      remote.lineup[0].roleLabel = "Remote role";
      remote.slots[0].displayLabel = "Remote guest";
      remote.slots[0].roleLabel = "Remote role";
      localStorage.setItem(key, JSON.stringify(remote));
      window.dispatchEvent(new Event("event-lineup-fixture-refresh"));
    }, storageKey);
    await page.getByLabel("Event title", { exact: true }).fill("Title only");
    await save(page);
    expect((await submission(page)).lineup).toBeUndefined();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).lineup[0].roleLabel, storageKey)).toBe("Remote role");
    await changeRole(page, "Authored again");
    await save(page);
    expect((await submission(page)).lineup[0].roleLabel).toBe("Authored again");
  });

  test(`${mode} pending lineup save leaves newer edits dirty for the next save @flow @fixture`, async ({ page }) => {
    await openEditor(page, mode);
    await page.evaluate(() => localStorage.setItem("event-lineup-fixture-defer-save", "true"));
    await saveButton(page).click();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(`${key}-submission`), storageKey)).not.toBeNull();
    await changeRole(page, "Newer role");
    await page.evaluate(() => {
      localStorage.removeItem("event-lineup-fixture-defer-save");
      window.dispatchEvent(new Event("event-lineup-fixture-release-save"));
    });
    await expect(saveButton(page)).toBeEnabled();
    await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "true");
    expect((await submission(page)).lineup[0].roleLabel).toBe("Submitted role");
    await save(page);
    expect((await submission(page)).lineup[0].roleLabel).toBe("Newer role");
  });

  test(`${mode} failed lineup save keeps the submitted changes for retry @flow @fixture`, async ({ page }) => {
    await openEditor(page, mode);
    await page.evaluate(() => localStorage.setItem("event-lineup-fixture-save-error", "Fixture lineup failure"));
    await saveButton(page).click();
    await expect(page.getByText(BACKEND_ERROR_COPY, { exact: true })).toBeVisible();
    await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "true");
    await page.evaluate(() => localStorage.removeItem("event-lineup-fixture-save-error"));
    await save(page);
    expect((await submission(page)).lineup[0].roleLabel).toBe("Submitted role");
  });
}
