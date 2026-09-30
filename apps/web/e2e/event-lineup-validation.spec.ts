import { expect, test } from "@playwright/test";
import { BACKEND_ERROR_COPY } from "../src/lib/error-copy";

for (const scenario of [
  { name: "unselected timezone", start: "2027-10-15T19:00", timezone: "Indianapolis", field: "Time zone", message: "Time zone must be a valid IANA time zone." },
  { name: "DST gap", start: "2027-03-14T02:30", field: "Start", message: "Local time does not exist in this timezone." },
  { name: "DST fold", start: "2027-11-07T01:30", field: "Start occurrence", message: "Ambiguous local time requires an earlier or later occurrence." },
]) test(`staff publish reveals and focuses ${scenario.name}`, async ({ page }, testInfo) => {
  await page.goto("/playwright/event-lineup?editor");
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await navigation.getByRole("button", { name: "Details" }).click();
  await page.getByLabel("Start", { exact: true }).fill(scenario.start);
  if (scenario.timezone) await page.getByRole("combobox", { name: "Time zone", exact: true }).fill(scenario.timezone);
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
  await page.getByLabel("Slots", { exact: true }).fill("");
  await navigation.getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Slots", { exact: true })).toBeFocused();
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
