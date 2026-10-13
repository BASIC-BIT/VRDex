import { expect, test } from "@playwright/test";
import { BACKEND_ERROR_COPY } from "../src/lib/error-copy";

for (const scenario of [
  { name: "DST gap", start: "2027-03-14T02:30", field: "Starts", message: "Local time does not exist in this timezone." },
  { name: "DST fold", start: "2027-11-07T01:30", field: "Start occurrence", message: "Ambiguous local time requires an earlier or later occurrence." },
]) test(`staff publish reveals and focuses ${scenario.name}`, async ({ page }, testInfo) => {
  await page.goto("/playwright/event-lineup?editor");
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await navigation.getByRole("button", { name: "Details" }).click();
  await page.getByLabel("Starts", { exact: true }).fill(scenario.start);
  await navigation.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText(scenario.message, { exact: true })).toBeVisible();
  await expect(page.getByLabel(scenario.field, { exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath(`staff-${scenario.name.replaceAll(" ", "-")}-focus.png`), fullPage: true });
});

test("staff publish reveals and focuses an invalid mounted field", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await navigation.getByRole("button", { name: "Details" }).click();
  await page.getByLabel("Event title", { exact: true }).fill("");
  await navigation.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Event title", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await page.getByLabel("Event title", { exact: true }).fill("Valid title");
  await navigation.getByRole("button", { name: "Lineup" }).click();
  await page.locator('[data-lineup-row]').first().locator("summary").click();
  await page.getByLabel("Slot duration minutes", { exact: true }).first().fill("invalid");
  await navigation.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Slot duration minutes", { exact: true }).first()).toBeFocused();
});

for (const wrapped of [false, true]) test(`@fixture stale selected stream validation ${wrapped ? "wrapped" : "plain"}`, async ({page}, testInfo) => {
 await page.goto("/playwright/event-lineup?editor");
 await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup" }).click();
 await page.getByLabel("Stream",{exact:true}).nth(2).selectOption("lumen-main");
 await page.evaluate(wrapped=>localStorage.setItem("event-lineup-fixture-save-error",`${wrapped ? "[CONVEX M(events:updateCommunityEvent)] Server Error\nUncaught Error: " : ""}Selected stream must belong to the performer's public streams.${wrapped ? "\n    at handler (events.ts:751)" : ""}`),wrapped);
 await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
 await page.getByRole("button",{name:"Save changes",exact:true}).click();
 await expect(page.getByText("Stream unavailable",{exact:true})).toBeVisible();
 await expect(page.getByText(BACKEND_ERROR_COPY,{exact:true})).toHaveCount(0);
 await expect(page.getByLabel("Stream",{exact:true}).nth(2)).toHaveAttribute("aria-invalid","true");
 await testInfo.attach("stream-validation", {body:await page.screenshot({fullPage:true}),contentType:"image/png"});
 await page.getByLabel("Stream",{exact:true}).nth(2).selectOption("");
 await expect(page.getByLabel("Stream",{exact:true}).nth(2)).not.toHaveAttribute("aria-invalid","true");
 await page.evaluate(()=>localStorage.removeItem("event-lineup-fixture-save-error"));
 await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
 await page.getByRole("button",{name:"Save changes",exact:true}).click();
 await expect(page.getByText("Stream unavailable",{exact:true})).toHaveCount(0);
});

test("@fixture stream validation phrase inside an unrelated error stays generic", async ({page}) => {
 await page.goto("/playwright/event-lineup?editor");
 await page.evaluate(()=>localStorage.setItem("event-lineup-fixture-save-error","Transport reported: Selected stream must belong to the performer's public streams. Please retry."));
 await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
 await page.getByRole("button",{name:"Save changes",exact:true}).click();
 await expect(page.getByText(BACKEND_ERROR_COPY,{exact:true})).toBeVisible();
 await expect(page.getByText("Stream unavailable",{exact:true})).toHaveCount(0);
});


test("invalid timezone search preserves the selected event zone", async ({ page }) => {
  await page.goto("/playwright/event-lineup?editor");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details" }).click();
  const selected = await page.locator('input[name="timezone"]').inputValue();
  await page.getByRole("button", { name: "Time zone", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Time zone", exact: true });
  await search.fill("not a zone");
  await expect(page.getByText("No matches", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(page.locator('input[name="timezone"]')).toHaveValue(selected);
});


test("staff missing timezone reveals Details and focuses the picker trigger without submitting", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({
    id: "legacy-no-zone", slug: "legacy-no-zone", title: "Legacy event", startAt: Date.UTC(2027, 8, 12, 20),
    scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "published",
    source: { sourceType: "community", label: "Afterglow" }, watchSurfaceEnabled: false,
    mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: [], lineup: [],
    preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [],
  })));
  await page.goto("/playwright/event-lineup?editor");
  const details = page.locator('[data-editor-step="Details"]');
  await expect(page.locator('input[name="timezone"]')).toHaveValue("");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await expect(details).toBeHidden();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Time zone must be a valid IANA time zone.", { exact: true })).toBeVisible();
  await expect(details).toBeVisible();
  await expect(page.getByRole("button", { name: "Time zone", exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-command"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("event-lineup-fixture-v1-submission"))).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("staff-missing-zone-focus.png"), fullPage: true });
});
