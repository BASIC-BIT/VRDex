import { expect, test, type Page } from "@playwright/test";

const stored = (page: Page, key: string) => page.evaluate(key => sessionStorage.getItem(key), key);
const review = (page: Page) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review", exact: true }).click();
const publish = (page: Page) => page.getByRole("button", { name: "Publish event", exact: true }).click();
const accept = async (page: Page, ...labels: string[]) => { for (const label of labels) await page.getByRole("button", { name: `Accept ${label}`, exact: true }).click(); };
const heldSubmission = JSON.stringify({ draftId: "fixture-draft", expectedVersion: 2 });

test("a connector draft opened in the editor publishes through the held path @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(await stored(page, "event-intake-revision-submission")).toBe(heldSubmission);
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("a date-only connector draft publishes from the editor @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await accept(page, "Community", "Event title", "Date");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-15");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(await stored(page, "event-intake-revision-submission")).toBe(heldSubmission);
  const saved = JSON.parse((await stored(page, "fixture-published"))!);
  expect(saved).toMatchObject({ communitySlug: "afterglow", title: "Held night", eventDate: "2027-07-15" });
  expect(saved).not.toHaveProperty("timeTba");
  await expect(page).toHaveURL(/playwright-afterglow-harbor-sessions$/);
});

test("a draft saved with a start and then cleared opens date-only @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-cleared-start");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-15");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(JSON.parse((await stored(page, "fixture-published"))!).timeTba).not.toBe(true);
});

test("a re-dated draft opens date-only, as row Publish reads it @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-redated");
  await expect(page.getByLabel("Date", { exact: true })).toHaveValue("2027-07-16");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
});

for (const [how, back] of [
  ["accepting it", (page: Page) => accept(page, "Date")],
  ["typing it", (page: Page) => page.getByLabel("Date", { exact: true }).fill("2027-07-15")],
] as const) {
  test(`a re-dated draft taken back to its date by ${how} reads as Open reads it @flow @fixture`, async ({ page }) => {
    await page.goto("/playwright/event-intake?revision=held-redated");
    await back(page);
    await expect(page.getByLabel("Date", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Starts", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    expect(JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch).not.toHaveProperty("timeTba");
    await review(page);
    await publish(page);
    await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
    expect(await stored(page, "event-intake-review-command")).not.toBe("eventIntakeHeld:publish");
  });
}

test("an imported start stays a choice the staffer makes @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-tentative-start");
  await accept(page, "Community", "Event title", "Date");
  await review(page);
  await publish(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await stored(page, "event-intake-review-command")).toBeNull();
  await accept(page, "Time zone", "Start time");
  await review(page);
  await publish(page);
  await expect.poll(() => stored(page, "event-intake-review-command")).toBe("eventIntakeHeld:publish");
  expect(JSON.parse((await stored(page, "fixture-published"))!)).toMatchObject({ timeTba: false, start: { time: "20:00" } });
});

test("a poster change keeps a connector draft's import @flow @fixture", async ({ page }) => {
  const savedImport = async () => JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch.tentative;
  const poster = page.getByAltText("Source poster", { exact: true });
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByLabel("Poster", { exact: true }).setInputFiles("public/test-media/event-poster.png");
  await expect(poster).toBeVisible();
  expect(await savedImport()).toMatchObject({ title: "Held night" });
  await page.getByRole("button", { name: "Remove poster", exact: true }).click();
  await expect(poster).toHaveCount(0);
  expect(await savedImport()).toMatchObject({ title: "Held night" });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeVisible();
});

test("a source text edit keeps a connector draft's import @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=held-date-only");
  await page.getByRole("button", { name: "Import poster or text", exact: true }).click();
  await page.getByRole("textbox", { name: "Source text", exact: true }).fill("Held night moved");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accept Event title", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Draft saved");
  expect(JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch).toMatchObject({ sourceText: "Held night moved", tentative: { title: "Held night" } });
});

for (const mode of ["held-date-only", "held-tentative-start"]) {
  test(`Save draft on ${mode} does not persist the derived Time TBA @flow @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?revision=${mode}`);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Draft saved");
    expect(JSON.parse((await stored(page, "event-intake-revision-submission"))!).patch).not.toHaveProperty("timeTba");
  });
}

test("a personal draft still needs a start @flow @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=draft");
  await review(page);
  await publish(page);
  await expect(page.getByLabel("Starts", { exact: true })).toBeFocused();
  expect(await stored(page, "event-intake-review-command")).toBeNull();
});

test.describe("Waiting for review @flow @fixture", () => {
  const heading = "Waiting for review";

  test("lists held imports above My events and sends each action", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=1");
    const section = page.getByRole("region", { name: heading });
    await expect(section).toBeVisible();
    expect(await page.evaluate(() => {
      const held = document.querySelector('[aria-labelledby="held-imports-heading"]');
      const list = document.querySelector('ul[aria-label="My events"]');
      return Boolean(held && list && held.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await expect(section.getByRole("columnheader")).toHaveText(["Title", "Date", "Community", "Channel", "Author", "Source", "Actions"]);
    const fresh = section.getByRole("row", { name: /Afterglow Social/ });
    await expect(fresh.getByRole("cell", { name: "Jul 20, 2099 · Time TBA" })).toBeVisible();
    await expect(fresh.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/events/new?draft=held-new");
    await expect(fresh.getByRole("link", { name: "Source" })).toHaveAttribute("href", "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333");
    await expect(fresh.getByRole("cell", { name: "#events" })).toBeVisible();
    await expect(fresh.getByRole("cell", { name: "Promoter" })).toBeVisible();
    const update = section.getByRole("row", { name: /Update to Harbor Night/ });
    await expect(update.getByRole("link", { name: "Harbor Night" })).toHaveAttribute("href", "/afterglow/events/harbor/edit");
    await expect(update.getByRole("listitem")).toHaveCount(1);
    await expect(update.getByRole("listitem")).toHaveText("Starts: Jul 15, 8:00 PM UTC → Jul 15, 9:00 PM UTC");
    const flag = section.getByRole("row", { name: /Pier Night/ });
    await expect(flag.getByText("Discord post deleted", { exact: true })).toBeVisible();
    await expect(flag.getByRole("link", { name: "Pier Night" })).toHaveAttribute("href", "/afterglow/events/pier/edit");
    for (const [row, action, call] of [
      [fresh, "Publish", ["eventIntakeHeld:publish", { draftId: "held-new" }]],
      [update, "Dismiss", ["eventIntakeHeld:dismiss", { draftId: "held-update" }]],
      [flag, "Keep", ["eventIntakeHeld:dismissFlag", { eventId: "flag-1" }]],
    ] as const) {
      await row.getByRole("button", { name: action, exact: true }).click();
      await expect.poll(() => stored(page, "held-command")).toBe(JSON.stringify(call));
    }
    await expect(section).toHaveCount(0);
  });

  for (const [mode, action, message] of [
    ["publish", "Publish", "Unable to publish."],
    ["dismiss", "Dismiss", "Unable to dismiss."],
    ["dismissFlag", "Keep", "Unable to keep."],
  ] as const) {
    test(`a failed ${action} keeps its row and says so`, async ({ page }) => {
      await page.goto(`/playwright/event-inventory?held=fail-${mode}`);
      const section = page.getByRole("region", { name: heading });
      const button = section.getByRole("button", { name: action, exact: true }).first();
      await button.click();
      await expect(section.getByRole("alert")).toHaveText(message);
      await expect(button).toBeEnabled();
      await expect(section.getByRole("row")).toHaveCount(4);
    });
  }

  test("reads a row with little to show", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=sparse");
    const section = page.getByRole("region", { name: heading });
    const untitled = section.getByRole("row", { name: /Untitled event/ });
    await expect(untitled.getByRole("link", { name: "Source" })).toHaveCount(0);
    await expect(section.getByRole("row", { name: /Update to Harbor Night/ }).getByRole("listitem")).toHaveText(["Date: Jul 15, 2099 → next week", "Where: Hall →", /^Description: /, /^Source URL: /]);
    await expect(section.getByRole("row", { name: /Lantern Night/ }).getByText("Deleted at the source", { exact: true })).toBeVisible();
    expect(await section.locator("table").evaluate(table => table.parentElement!.scrollWidth <= table.parentElement!.clientWidth)).toBe(true);
    expect(await section.getByRole("cell", { name: /Source URL/ }).evaluate(cell => cell.scrollWidth <= cell.clientWidth)).toBe(true);
  });

  test("a failure notice goes when the rows change", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=fail-dismissFlag");
    const section = page.getByRole("region", { name: heading });
    await section.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(section.getByRole("alert")).toHaveText("Unable to keep.");
    await page.evaluate(() => window.dispatchEvent(new Event("held-drop")));
    await expect(section.getByRole("row")).toHaveCount(3);
    await expect(section.getByRole("alert")).toHaveCount(0);
  });

  test("My events stays up when the section fails, and it comes back", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=fail-query");
    await expect(page.locator('ul[aria-label="My events"]')).toBeVisible();
    await expect(page.getByRole("link", { name: "Event reports", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
    await expect(page.getByText("Unable to load this page.")).toHaveCount(0);
    await page.evaluate(() => { window.dispatchEvent(new Event("inventory-recover-shortcuts")); window.dispatchEvent(new Event("focus")); });
    await expect(page.getByRole("region", { name: heading })).toBeVisible();
  });

  test("holds a button while its call runs", async ({ page }) => {
    await page.goto("/playwright/event-inventory?held=slow");
    const section = page.getByRole("region", { name: heading });
    const fresh = section.getByRole("row", { name: /Afterglow Social/ });
    await fresh.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(fresh.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await expect(fresh.getByRole("button", { name: "Dismiss", exact: true })).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("held-release")));
    await expect(fresh).toHaveCount(0);
    await expect(section.getByRole("row")).toHaveCount(3);
  });

  test("is absent when nothing is held", async ({ page }) => {
    await page.goto("/playwright/event-inventory");
    await expect(page.getByRole("heading", { name: "My events", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: heading })).toHaveCount(0);
  });

  test("scrolls inside its frame on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/playwright/event-inventory?held=1");
    await expect(page.getByRole("region", { name: heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
