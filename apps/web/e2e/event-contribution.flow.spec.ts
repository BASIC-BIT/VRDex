import { expect, test } from "@playwright/test";

for (const mode of ["draft", "correction"] as const) {
  test(`${mode} reveals invalid dates and end ordering from Review @flow @fixture`, async ({ page }, info) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    if (mode === "correction") await page.getByRole("button", { name: "Correct event", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "Event editor" });
    await expect(navigation.getByRole("button")).toHaveText(["Details", "Lineup", "Review"]);
    if (mode === "correction") await expect(page.getByRole("button", { name: "Import poster or text", exact: true })).toHaveCount(0);
    await page.getByLabel("Time TBA", { exact: true }).uncheck();
    await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("UTC");
    await page.getByRole("option", { name: /^UTC / }).click();
    await page.getByLabel("Starts", { exact: true }).fill("2027-07-15T23:00");
    await page.getByText("Add end time", { exact: true }).click();
    const endInput = page.getByLabel("Ends (optional)", { exact: true });
    const submit = () => page.getByRole("button", { name: mode === "draft" ? "Publish event" : "Save changes", exact: true }).click();
    for (const date of ["2027-07-13", "2027-07-23"]) {
      await endInput.fill(`${date}T23:00`);
      await page.getByText("Add end time", { exact: true }).click();
      await navigation.getByRole("button", { name: "Review", exact: true }).click();
      await submit();
      await expect(endInput).toBeFocused();
      await expect(endInput).toHaveValue(`${date}T23:00`);
      expect(await page.evaluate(() => sessionStorage.getItem("event-intake-revision-submission"))).toBeNull();
    }
    if (mode === "draft") {
      await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(endInput).toBeFocused();
    }
    await page.getByLabel("Time TBA", { exact: true }).click();
    await expect(page.getByLabel("Time TBA", { exact: true })).not.toBeChecked();
    await expect(endInput).toBeFocused();
    for (const end of ["22:00", "23:00"]) {
      await endInput.fill(`2027-07-15T${end}`);
      await page.getByText("Add end time", { exact: true }).click();
      await navigation.getByRole("button", { name: "Review", exact: true }).click();
      await submit();
      await expect(endInput).toBeFocused();
      await expect(page.getByRole("status")).toHaveText("End time must follow start; choose the next day explicitly when crossing midnight.");
      expect(await page.evaluate(() => sessionStorage.getItem("event-intake-revision-submission"))).toBeNull();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("end-order-focus.png"), fullPage: true, animations: "disabled" });
    await endInput.fill("2027-07-16T01:00");
    await navigation.getByRole("button", { name: "Review", exact: true }).click();
    await submit();
    const fields = await page.evaluate(mode => JSON.parse(sessionStorage.getItem(mode === "draft" ? "fixture-published" : "event-intake-revision-submission")!), mode);
    expect(mode === "draft" ? fields.end : fields.patch.end).toEqual({ time: "01:00", dayOffset: 1 });
    if (mode === "draft") await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
    else await expect(navigation).toHaveCount(0);
  });

  test(`${mode} compares repeated-hour resolved instants @flow @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    if (mode === "correction") await page.getByRole("button", { name: "Correct event", exact: true }).click();
    const navigation = page.getByRole("navigation", { name: "Event editor" });
    await navigation.getByRole("button", { name: "Details", exact: true }).click();
    await page.getByLabel("Time TBA", { exact: true }).uncheck();
    await page.getByRole("combobox", { name: "Time zone", exact: true }).fill("America/New_York");
    await page.getByRole("option").first().click();
    await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:15");
    await page.getByLabel("Starts occurrence", { exact: true }).selectOption("later");
    await page.getByText("Add end time", { exact: true }).click();
    await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-11-01T01:45");
    await page.getByLabel("Ends (optional) occurrence", { exact: true }).selectOption("earlier");
    await navigation.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: mode === "draft" ? "Publish event" : "Save changes", exact: true }).click();
    await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeFocused();
    await expect(page.getByRole("status")).toContainText("End time must follow start");
    expect(await page.evaluate(() => sessionStorage.getItem("event-intake-revision-submission"))).toBeNull();
    await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:45");
    await page.getByLabel("Starts occurrence", { exact: true }).selectOption("earlier");
    await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-11-01T01:15");
    await page.getByLabel("Ends (optional) occurrence", { exact: true }).selectOption("later");
    await navigation.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: mode === "draft" ? "Publish event" : "Save changes", exact: true }).click();
    const fields = await page.evaluate(mode => JSON.parse(sessionStorage.getItem(mode === "draft" ? "fixture-published" : "event-intake-revision-submission")!), mode);
    expect(mode === "draft" ? fields.end : fields.patch.end).toEqual({ time: "01:15", dayOffset: 0, occurrence: "later" });
    if (mode === "draft") await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
    else await expect(navigation).toHaveCount(0);
  });
}

for (const mode of ["draft", "correction"] as const) {
  test(`${mode} retains its editing revision across query refresh @flow @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    if (mode === "draft") await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details", exact: true }).click();
    if (mode === "correction") await page.getByRole("button", { name: "Correct event", exact: true }).click();
    await page.getByLabel("Event title", { exact: true }).fill("My local edit");
    await page.getByRole("button", { name: "Update elsewhere" }).click();
    await expect(page.getByText("Query refreshed", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Where (optional)", { exact: true })).toHaveValue("Original venue");
    if (mode === "correction") await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: mode === "draft" ? "Save draft" : "Save changes", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "This draft changed elsewhere." })).toBeVisible();
    await expect(page.getByLabel("Event title", { exact: true })).toHaveValue("My local edit");
    const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
    expect(submission[mode === "draft" ? "expectedVersion" : "expectedUpdatedAt"]).toBe(1);
  });
}

test("draft advances its revision only after a successful local save @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details", exact: true }).click();
  await page.getByLabel("Event title", { exact: true }).fill("First edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.getByLabel("Event title", { exact: true }).fill("Second edit");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
  expect(submission.expectedVersion).toBe(2);
  expect(submission.patch.title).toBe("Second edit");
});
test("title-only correction omits an unchanged hidden-person lineup @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  await page.getByLabel("Event title", { exact: true }).fill("Corrected title");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
  expect(submission.patch).toEqual({ title: "Corrected title" });
  await expect(page.getByRole("navigation", { name: "Event editor" })).toHaveCount(0);
  await expect(page).toHaveURL(/revision=correction$/);
});

test("correction steps retain allowed details and lineup without source or staff fields @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?revision=correction");
  await page.getByRole("button", { name: "Correct event", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await expect(navigation.getByRole("button")).toHaveText([/Details$/, /Lineup$/, /Review$/]);
  for (const name of ["Community", "Source text", "Poster images", "Poster URL", "Output URL", "Stream"])
    await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Advanced", { exact: true })).toHaveCount(0);
  await page.getByLabel("Event title", { exact: true }).fill("Corrected gathering");
  await page.getByLabel("Where (optional)", { exact: true }).fill("Corrected venue");
  await page.screenshot({ path: info.outputPath("correction-details.png"), fullPage: true, animations: "disabled" });
  await navigation.getByRole("button", { name: "Lineup", exact: true }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Aurora");
  await page.getByLabel("Person profile", { exact: true }).fill("aurora");
  const portrait = page.getByRole("img", { name: "Aurora", exact: true }).locator("img");
  await expect(portrait).toHaveAttribute("src", "/test-media/event-poster.png");
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("correction-lineup.png"), fullPage: true, animations: "disabled" });
  await navigation.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish event", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("correction-review.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByLabel("Where (optional)", { exact: true })).toHaveValue("Corrected venue");
  await navigation.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(navigation).toHaveCount(0);
  const submission = await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!));
  expect(submission.expectedUpdatedAt).toBe(1);
  expect(submission.patch).toEqual({ title: "Corrected gathering", venueLabel: "Corrected venue", lineup: [{ clientKey: "private-person", position: 0, performerLabel: "Aurora", personSlug: "aurora" }] });
});

test("owner timezone keyboard search stores a region, not EST @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-editor");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details", exact: true }).click();
  await page.getByLabel("Starts", { exact: true }).fill("2026-07-15T20:00");
  const timezone = page.getByRole("combobox", { name: "Time zone" });
  await timezone.fill("EST");
  await expect(page.getByRole("option", { name: /New York.*UTC-04:00/ })).toBeVisible();
  await timezone.press("ArrowDown");
  await timezone.press("Enter");
  await expect(page.locator('input[name="timezone"]')).toHaveValue("America/New_York");
  await timezone.fill("not a zone");
  await expect(page.locator('input[name="timezone"]')).toHaveValue("");
});

test("direct intake auth preserves community and draft @flow @fixture", async ({ page }) => {
  await page.goto("/events/new?community=afterglow&draft=saved-draft");
  await expect(page).toHaveURL(/\/sign-in\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/events/new?community=afterglow&draft=saved-draft");
});

test("community and Events expose intake entry @flow @fixture", async ({ page }) => {
  await page.goto("/search?type=event");
  await expect(page.getByRole("link", { name: "Add event", exact: true })).toHaveAttribute("href", "/events/new");
  await page.goto("/playwright-afterglow-social");
  await expect(page.getByRole("link", { name: "Add event", exact: true })).toHaveAttribute("href", "/events/new?community=playwright-afterglow-social");
});

test("intake draft resumes, date-only publishes directly, and has no mobile overflow @flow @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-intake");
  await expect(page.getByRole("group", { name: "Selected community", exact: true })).toContainText("playwright-afterglow-social");
  await page.getByLabel("Event title", { exact: true }).fill("Summer gathering");
  await page.getByLabel("Time TBA").check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-07-15");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true }).click();
  await page.getByRole("button", { name: "Add performer" }).click();
  await page.getByRole("textbox", { name: "Performer", exact: true }).fill("Aurora");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  await page.reload();
  await expect(page.getByLabel("Event title")).toHaveValue("Summer gathering");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { name: "Add event", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("event-intake.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions", exact: true })).toBeVisible();
});

test("ambiguous start requires occurrence and gap is refused @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Event title").fill("Autumn gathering");
  const timezone = page.getByRole("combobox", { name: "Time zone" });
  await timezone.fill("EST"); await timezone.press("ArrowDown"); await timezone.press("Enter");
  await page.getByLabel("Starts", { exact: true }).fill("2026-11-01T01:30");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByRole("status")).toContainText("Ambiguous local time");
  await page.getByLabel("Starts occurrence").selectOption("later");
  await page.getByLabel("Starts", { exact: true }).fill("2027-03-14T02:30");
  await expect(page.getByText("This local time does not exist.", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByRole("status")).toContainText("Local time does not exist");
});

// The public pages below use pre-existing server fixtures. This checks navigation
// and readback UI; backend event-intake.test.ts checks actual publication/indexing.
test("manual publish reads back direct URL, search and community fixtures @flow @fixture", async ({ page }) => {
  const eventPath = "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions";
  await page.goto("/playwright/event-intake");
  await page.getByLabel("Event title", { exact: true }).fill("Afterglow Harbor Sessions");
  await page.getByLabel("Time TBA").check();
  await page.getByLabel("Starts", { exact: true }).fill("2027-07-15");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${eventPath}$`));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Afterglow Harbor Sessions", exact: true })).toBeVisible();
  await page.goto("/search?type=event&q=Afterglow");
  await expect(page.locator(`a[href="${eventPath}"]`).first()).toBeVisible();
  await page.goto("/playwright-afterglow-social");
  await expect(page.getByRole("heading", { name: "Hosted events" })).toBeVisible();
  await expect(page.locator(`a[href="${eventPath}"]`).first()).toBeVisible();
});

test("staff controls confirm takeover and removal through connected fixture @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=staff");
  page.on("dialog", dialog => dialog.accept());
  await expect(page.getByRole("button", { name: "Correct event", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Submitted");
  await expect(page.getByRole("button", { name: "Take over", exact: true })).toHaveCount(0);
  await page.locator("summary", { hasText: "Report event" }).click();
  await page.getByLabel("Reason", { exact: true }).fill("Duplicate fixture event");
  await page.getByRole("button", { name: "Remove event", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!))).toEqual({ eventId: "fixture-event", reason: "Duplicate fixture event" });
  await expect(page).toHaveURL(/\/(account\/events|sign-in)(\?|$)/);
});

test("date-only public fixture keeps its date, calendar export and no watch player @flow @fixture", async ({ page }, info) => {
  const path = "/playwright-afterglow-social/events/playwright-date-only-event";
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "July Fourth Sessions", exact: true })).toBeVisible();
  await expect(page.getByText(/Time TBA/).first()).toBeVisible();
  await expect(page.locator("video, iframe")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Event stream", exact: true })).toHaveCount(0);
  const calendar = await page.request.get(`${path}/calendar.ics`);
  expect(calendar.ok()).toBe(true);
  const ics = await calendar.text();
  expect(ics).toContain("DTSTART;VALUE=DATE:20260704");
  expect(ics).toContain("Time TBA");
  expect(ics).not.toMatch(/DTSTART(?:;TZID=[^:]*)?:\d{8}T/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("event-date-only.png"), fullPage: true });
});


test("staff stages retain mounted source fields in Details disclosure @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-editor");
  const navigation = page.getByRole("navigation", { name: "Event editor" });
  await expect(navigation.getByRole("button")).toHaveText(["Details", "Lineup", "Review"]);
  await expect(navigation.getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: "Import poster or text", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add event", exact: true })).toHaveCount(1);
  await page.getByLabel("Event title", { exact: true }).press("Enter");
  await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Source/ }).click();
  await page.getByLabel("Source label", { exact: true }).fill("Retained source");
  await page.getByLabel("Poster image URL", { exact: true }).fill("https://example.com/poster.png");
  await page.screenshot({ path: info.outputPath("staff-source-disclosure.png"), fullPage: true, animations: "disabled" });
  await page.locator("summary").filter({ hasText: /^Source/ }).click();
  await navigation.getByRole("button", { name: "Review", exact: true }).click();
  expect(await page.locator("form").evaluate(form => Object.fromEntries(new FormData(form as HTMLFormElement)))).toMatchObject({ sourceLabel: "Retained source", posterImageUrl: "https://example.com/poster.png" });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "Lineup", exact: true })).toHaveAttribute("aria-current", "step");
});


test("community name and slug search select directory results without persisting queries @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?revision=draft");
  const selected = page.getByRole("group", { name: "Selected community", exact: true });
  await expect(selected).toContainText("Afterglow");
  await selected.getByRole("button", { name: "Change", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Community", exact: true });
  await expect(search).toBeFocused();
  await search.fill("no matching community");
  await expect(page.getByRole("option")).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.communitySlug)).toBe("afterglow");
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(selected.getByRole("button", { name: "Change", exact: true })).toBeFocused();
  await expect(selected).toContainText("Afterglow");
  await selected.getByRole("button", { name: "Change", exact: true }).click();
  await search.fill("Afterglow Social");
  const option = page.getByRole("option", { name: /Afterglow Social.*playwright-afterglow-social/ });
  await expect(option).toBeVisible();
  await search.press("ArrowDown");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(selected).toContainText("Afterglow Social");
  await expect(page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Details", exact: true })).toHaveAttribute("aria-current", "step");
  const portrait = selected.getByRole("img", { name: "Afterglow Social", exact: true }).locator("img");
  await expect(portrait).toHaveAttribute("src", "/test-media/event-poster.png");
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.communitySlug)).toBe("playwright-afterglow-social");
  await selected.getByRole("button", { name: "Change", exact: true }).click();
  await search.fill("playwright-afterglow");
  await expect(option).toBeVisible();
  await search.press("ArrowUp");
  await search.press("Enter");
  await selected.getByRole("button", { name: "Change", exact: true }).click();
  await search.fill("afterglow");
  await page.screenshot({ path: info.outputPath("community-search.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("option", { name: /^Afterglow afterglow$/ }).click();
  await expect(selected).toContainText("afterglow");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("community-selected.png"), fullPage: true, animations: "disabled" });
});

test("community Clear saves a nullable incomplete draft and focuses missing community on publish @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await page.getByRole("group", { name: "Selected community", exact: true }).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Community", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.communitySlug)).toBeNull();
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Publish event", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Community", exact: true })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Add a community, title and date.");
});

test("initial community links and resumed missing slugs survive unresolved searches @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=initial&community=afterglow");
  await expect(page.getByRole("group", { name: "Selected community", exact: true })).toContainText("Afterglow");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.communitySlug)).toBe("afterglow");
  await page.evaluate(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "missing-community", title: "Resumed title" } })));
  await page.goto("/playwright/event-intake?source=search-loading");
  const selected = page.getByRole("group", { name: "Selected community", exact: true });
  await expect(selected).toContainText("missing-community");
  await page.evaluate(() => window.dispatchEvent(new Event("release-community-search")));
  await expect(selected).toContainText("missing-community");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.communitySlug)).toBe("missing-community");
});


test("combined controls preserve dates, reversible TBA and overnight times @flow @fixture", async ({ page }, info) => {
  await page.goto("/playwright/event-intake?source=text");
  await page.getByRole("combobox", { name: "Community", exact: true }).fill("afterglow");
  await page.getByRole("option", { name: /^Afterglow afterglow$/ }).click();
  const portrait = page.getByRole("group", { name: "Selected community", exact: true }).getByRole("img", { name: "Afterglow", exact: true }).locator("img");
  await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByLabel("Event title", { exact: true }).fill("Overnight gathering");
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-10T23:00");
  await page.getByText("Add end time", { exact: true }).click();
  await page.getByLabel("Ends (optional)", { exact: true }).fill("2026-10-11T02:00");
  await page.getByRole("combobox", { name: "Time zone" }).fill("UTC");
  await page.getByRole("combobox", { name: "Time zone" }).press("ArrowDown");
  await page.getByRole("combobox", { name: "Time zone" }).press("Enter");
  await page.getByLabel("Time TBA", { exact: true }).check();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-10");
  await page.getByLabel("Time TBA", { exact: true }).uncheck();
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-10T23:00");
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-11T02:00");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields)).toMatchObject({ eventDate: "2026-10-10", start: { time: "23:00", dayOffset: 0 }, end: { time: "02:00", dayOffset: 1 } });
  const startsBox = await page.getByLabel("Starts", { exact: true }).boundingBox();
  const endsBox = await page.getByLabel("Ends (optional)", { exact: true }).boundingBox();
  if (!startsBox || !endsBox) throw new Error("Expected visible time controls");
  if ((page.viewportSize()?.width ?? 0) >= 640) expect(Math.abs(startsBox.y - endsBox.y)).toBeLessThanOrEqual(1);
  else expect(endsBox.y).toBeGreaterThanOrEqual(startsBox.y + startsBox.height);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("combined-time-controls.png"), fullPage: true, animations: "disabled" });
  await page.getByLabel("Starts", { exact: true }).fill("2026-10-13T23:00");
  await page.getByText("Add end time", { exact: true }).click();
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Ends (optional)", { exact: true })).toHaveValue("2026-10-11T02:00");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("fixture-source-draft")!).fields.eventDate)).toBe("2026-10-10");
});
