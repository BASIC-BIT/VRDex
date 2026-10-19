import { expect, test } from "@playwright/test";
test.describe("@fixture event identity picker", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/playwright/event-editor?identity=picker");
  });
  test("explicitly selects duplicate names by public context and keeps selected presentation during refresh", async ({
    page,
  }, testInfo) => {
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    await expect(
      page.getByRole("button", { name: "Add manual entry", exact: true }),
    ).toHaveCount(0);
    await input.fill("Aurora");
    await expect(page.getByRole("option")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Add manual entry", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option").nth(0)).toContainText("DJ / House");
    await expect(page.getByRole("option").nth(1)).toContainText(
      "Visual artist",
    );
    await expect(
      page.getByRole("link", { name: "View profile for Aurora" }).nth(1),
    ).toHaveAttribute("href", "/aurora-visual");
    await page.screenshot({
      path: testInfo.outputPath("rich-identity-results.png"),
    });
    await page.getByRole("option").nth(1).click();
    await expect(page.getByTestId("selected-slug")).toHaveText("aurora-visual");
    await expect(page.getByTestId("selected-identity")).toContainText("Aurora");
    await expect(
      page.getByTestId("selected-identity").locator("img"),
    ).toHaveAttribute("src", /\/seed\/fixture-avatar-solaris\.svg$/);
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await input.fill("Slow");
    await expect(page.getByTestId("selected-identity")).toContainText("Aurora");
    await expect(
      page.getByTestId("selected-identity").locator("img"),
    ).toHaveAttribute("src", /\/seed\/fixture-avatar-solaris\.svg$/);
    await page
      .getByRole("button", { name: "Release requests", exact: true })
      .click();
    await expect(page.getByTestId("selected-identity")).toContainText("Aurora");
  });
  test("ignores stale responses and never selects on blur", async ({
    page,
  }) => {
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    await input.fill("Slow");
    await page
      .getByRole("button", { name: "Request started", exact: true })
      .click();
    await input.fill("Aurora");
    await expect(page.getByRole("option")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Release requests", exact: true })
      .click();
    await expect(page.getByTestId("selected-slug")).toHaveText("");
    await input.focus();
    await expect(page.getByRole("option")).toHaveCount(2);
    await expect(page.getByRole("option").first()).toContainText("Aurora");
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.getByTestId("selected-slug")).toHaveText("aurora-house");
    await expect(
      page.getByRole("button", { name: "Change", exact: true }),
    ).toBeFocused();
  });
  test("keeps image fallback dimensions and offers manual entry after failed lookup", async ({
    page,
  }) => {
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    const broken = Promise.withResolvers<import("@playwright/test").Route>();
    await page.route("**/fixtures/broken.png", (route) => {
      broken.resolve(route);
    });
    await input.fill("Broken");
    const image = page.getByRole("option").locator(".lookup-suggestion-avatar");
    const before = await image.boundingBox();
    await (await broken.promise).fulfill({ status: 404, body: "" });
    await expect(image).toHaveText("BP");
    const after = await image.boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.height).toBe(before?.height);
    await input.fill("Failure");
    const manualAction = page.getByRole("button", {
      name: "Add manual entry",
      exact: true,
    });
    await input.press("Tab");
    await expect(manualAction).toBeFocused();
    await manualAction.press("Enter");
    await expect(page.getByTestId("manual-name")).toHaveText("Failure");
    await expect(page.getByTestId("selected-slug")).toHaveText("");
    await expect(input).toBeFocused();
  });
  test("preserves a deliberate manual-entry focus handoff", async ({
    page,
  }) => {
    await page
      .getByRole("checkbox", { name: "Hand off manual focus", exact: true })
      .check();
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    await input.fill("Failure");
    const manualAction = page.getByRole("button", {
      name: "Add manual entry",
      exact: true,
    });
    await input.press("Tab");
    await expect(manualAction).toBeFocused();
    await manualAction.press("Enter");
    await expect(page.getByTestId("manual-name")).toHaveText("Failure");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.getByRole("textbox", { name: "Manual performer", exact: true }),
    ).toBeFocused();
  });
  test("uses managed shortcuts and filtered public world/community searches", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "community", exact: true }).click();
    const community = page.getByRole("combobox", {
      name: "Community",
      exact: true,
    });
    await community.focus();
    await expect(
      page.getByText("Your communities", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("option")).toContainText("Afterglow");
    await expect(page.getByRole("option").locator("img")).toHaveCSS(
      "object-fit",
      "contain",
    );
    await community.fill("Other");
    await expect(page.getByRole("option")).toContainText("Other Club");
    await page.getByRole("option").click();
    await expect(page.getByTestId("selected-slug")).toHaveText("other-club");
    await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear community", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Clear community", exact: true }).click();
    await expect(community).toBeFocused();
    await expect(page.getByTestId("selected-slug")).toHaveText("");
    await community.press("Escape");
    await expect(page.getByTestId("selected-slug")).toHaveText("");
    await community.press("ArrowDown");
    await community.press("Enter");
    await expect(page.getByTestId("selected-slug")).toHaveText("afterglow");
    await page.getByRole("button", { name: "world", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Where", exact: true })
      .fill("Harbor");
    await expect(page.getByRole("option")).toContainText("Harbor");
    await page
      .getByRole("button", { name: "Use manual location", exact: true })
      .click();
    await expect(page.getByTestId("manual-name")).toHaveText("Harbor");
    await expect(page.getByTestId("selected-slug")).toHaveText("");
  });
  test("hydrates exact saved selections and preserves unavailable links", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Resume world", exact: true })
      .click();
    await expect(page.getByTestId("selected-identity")).toContainText(
      "Saved Harbor",
    );
    await expect(page.getByTestId("last-request")).toHaveText(
      "worlds:getPublicBySlug:saved-world",
    );
    await page
      .getByRole("button", { name: "Resume unavailable", exact: true })
      .click();
    await expect(page.getByTestId("selected-identity")).toContainText("Aurora");
    await expect(page.getByTestId("selected-slug")).toHaveText(
      "protected-person",
    );
    await page
      .getByRole("button", { name: "Resume unknown", exact: true })
      .click();
    await expect(
      page
        .getByTestId("selected-identity")
        .getByRole("status", { name: "Loading" }),
    ).toBeVisible();
    await expect(page.getByTestId("selected-identity")).not.toContainText(
      "unknown-person",
    );
    await expect(page.getByTestId("selected-slug")).toHaveText(
      "unknown-person",
    );
    await page.getByRole("button", { name: "Change", exact: true }).click();
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill("Aurora");
    await expect(page.getByRole("option")).toHaveCount(2);
    await input.press("Escape");
    await expect(
      page.getByRole("button", { name: "Change", exact: true }),
    ).toBeFocused();
    await expect(page.getByTestId("selected-slug")).toHaveText(
      "unknown-person",
    );
  });
  test("keeps keyboard selection in the combobox and profile inspection in tab order", async ({
    page,
  }) => {
    const input = page.getByRole("combobox", {
      name: "Performer",
      exact: true,
    });
    await input.fill("Aurora");
    await expect(page.getByRole("option")).toHaveCount(2);
    await input.press("ArrowUp");
    await input.press("Enter");
    await expect(page.getByTestId("selected-slug")).toHaveText("aurora-visual");
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(input).toBeFocused();
    await input.fill("Aurora");
    await expect(page.getByRole("option")).toHaveCount(2);
    await input.press("Tab");
    await expect(
      page.getByRole("link", {
        name: "View profile for Aurora, DJ / House",
        exact: true,
      }),
    ).toBeFocused();
    await expect(page.getByTestId("selected-slug")).toHaveText("");
  });
});

test("Details keeps optional doors collapsed and preserves them when collapsed @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ title: "Details night", timezone: "UTC", eventDate: "2027-10-15", start: { time: "20:00" }, timeTba: false })));
  await page.goto("/playwright/event-intake");
  const disclosure = page.getByText("Add doors-open time", { exact: true });
  await expect(disclosure).toBeVisible();
  await expect(page.getByLabel("Doors open", { exact: true })).toBeHidden();
  await disclosure.click();
  await page.getByLabel("Doors open", { exact: true }).fill("2027-10-15T19:45");
  await disclosure.click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!).doors?.time)).toBe("19:45");
  await disclosure.click();
  await page.getByLabel("Doors open", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!).doors)).toBeNull();
});


test("connected Details offers managed communities without selecting one and retains public identity in preview and Review @fixture", async ({ page }, testInfo) => {
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByTestId("selected-identity")).toHaveCount(0);
  const community = page.getByRole("combobox", { name: "Community", exact: true });
  await community.focus();
  await expect(page.getByText("Your communities", { exact: true })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option").first()).toContainText("Owner");
  await expect(page.getByRole("option").last()).toContainText("Staff");
  await community.fill("Market");
  await page.getByRole("option").filter({ hasText: "Night Market" }).click();
  await expect(page.getByTestId("selected-identity")).toContainText("Night Market");
  await expect(page.getByTestId("selected-identity").locator("img")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("Night Market");
  await expect(page.getByRole("complementary", { name: "Event preview" }).locator("img")).toBeVisible();
  await expect(page.getByText("night-market", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("details-community-desktop.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await expect(page.locator('[data-step="Review"]')).toContainText("Night Market");
  await expect(page.locator('[data-step="Review"] img')).toBeVisible();
  await expect(page.locator('[data-step="Review"]')).not.toContainText("night-market");
});

test("explicit community entry immediately displays its title without a slug @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake?revision=initial&community=playwright-afterglow-social");
  await expect(page.getByTestId("selected-identity")).toContainText("Afterglow Social");
  await expect(page.getByText("playwright-afterglow-social", { exact: true })).toHaveCount(0);
});

test("local intake searches canonical community names and aliases with fixture artwork @fixture", async ({ page }) => {
  await page.goto("/playwright/event-intake");
  await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear community", exact: true }).click();
  const community = page.getByRole("combobox", { name: "Community", exact: true });
  await expect(community).toBeFocused();
  for (const query of ["Afterglow", "AGS", "playwright-afterglow-social"]) {
    await community.fill(query);
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("Afterglow Social");
    await expect(page.getByRole("option").locator("img")).toHaveAttribute("src", /fixture-afterglow-event-poster/);
  }
  await community.fill("Unknown community");
  await expect(page.getByRole("option")).toHaveCount(0);
  await community.fill("Aurora");
  await expect(page.getByRole("option")).toHaveCount(0);
  await community.fill("Afterglow");
  await page.getByRole("option").click();
  await expect(page.getByRole("button", { name: "Clear community", exact: true })).toBeFocused();
  await expect(page.getByTestId("selected-identity").locator("img")).toHaveAttribute("src", /fixture-afterglow-event-poster/);
});

test("typed location is immediately dirty and saves without a manual-entry action @fixture", async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem("fixture-source-draft")) sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "Location night", timeTba: true } })); });
  await page.goto("/playwright/event-intake?source=details");
  const location = page.getByRole("combobox", { name: "Where", exact: true });
  await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "false");
  await location.fill("Westfield side room");
  await expect(location).toBeFocused();
  await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "true");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("Westfield side room");
  await location.press("Escape");
  await expect(location).toHaveValue("Westfield side room");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ venueLabel: "Westfield side room" });
  await page.goto("/playwright/event-intake?source=details");
  await expect(location).toHaveValue("Westfield side room");
  await expect(page.getByRole("button", { name: "Use manual location", exact: true })).toHaveCount(0);
});

test("world search cancellation retains the saved world and venue label @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "World night", worldSlug: "harbor-world", venueLabel: "Custom pier" } })));
  await page.goto("/playwright/event-intake?source=details");
  const selected = page.getByTestId("selected-identity").filter({ hasText: "Harbor World" });
  await selected.locator("..").getByRole("button", { name: "Change", exact: true }).click();
  const location = page.getByRole("combobox", { name: "Where", exact: true });
  await location.fill("Some other room");
  await expect(page.locator("form[data-event-dirty]")).toHaveAttribute("data-event-dirty", "false");
  await location.press("Escape");
  await expect(location).toHaveCount(0);
  await expect(selected).toContainText("Harbor World");
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("Custom pier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: "harbor-world", venueLabel: "Custom pier" });
});

test("stored Details retain doors world label and optional source through save @fixture", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Harbor night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, doors: { time: "19:45" }, worldSlug: "harbor-world", venueLabel: "Custom pier", sourceUrl: "https://example.com/original-post" } })));
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByLabel("Doors open", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("Custom pier");
  await expect(page.getByLabel("Announcement link", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: "harbor-world", venueLabel: "Custom pier", sourceUrl: "https://example.com/original-post", doors: { time: "19:45" } });
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  await expect(page.getByRole("combobox", { name: "Where", exact: true })).toHaveValue("Custom pier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.worldSlug)).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("details-manual-mobile.png"), fullPage: true });
  await page.getByRole("combobox", { name: "Where", exact: true }).fill("Harbor");
  await page.getByRole("option").filter({ hasText: "Harbor World" }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.worldSlug)).toBe("harbor-world");
});


test("accepting imported doors expands the disclosure @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "Imported night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, tentative: { eventDate: "2027-10-15", doors: { time: "19:30", dayOffset: 0 } } } })));
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByLabel("Doors open", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Accept doors", exact: true }).click();
  await expect(page.getByLabel("Doors open", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Doors open", { exact: true })).toHaveValue("2027-10-15T19:30");
});

test("saved world-only Details keeps its hydrated name when switching to editable manual location @fixture", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "World-only night", worldSlug: "harbor-world" } })));
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByTestId("selected-identity")).toContainText("Harbor World");
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  const manual = page.getByRole("combobox", { name: "Where", exact: true });
  await expect(manual).toBeVisible();
  await expect(manual).toHaveValue("Harbor World");
  await expect(manual).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("world-only-manual.png"), fullPage: true });
  await manual.fill("Harbor side room");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: null, venueLabel: "Harbor side room" });
  await manual.fill("");
  await expect(manual).toBeVisible();
});

test("saved world-only Details displays its title in preview and Review without authoring an override @fixture", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "World-only night", worldSlug: "harbor-world" } })));
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByTestId("selected-identity")).toContainText("Harbor World");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("Harbor World");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Review" }).click();
  await expect(page.locator('[data-step="Review"]')).toContainText("Harbor World");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("world-only-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.worldSlug)).toBe("harbor-world");
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.venueLabel)).toBeUndefined();
});


test("late world hydration cannot replace a manual location or write a venue override @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { title: "Pending world", worldSlug: "harbor-world" } })));
  await page.goto("/playwright/event-intake?source=world-delay");
  await page.getByRole("button", { name: "Clear", exact: true }).last().click();
  const manual = page.getByRole("combobox", { name: "Where", exact: true });
  await expect(manual).toBeVisible();
  await manual.fill("New room");
  await page.evaluate(async () => { window.dispatchEvent(new Event("release-world-presentation")); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await expect(manual).toHaveValue("New room");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("New room");
  await expect(page.getByRole("complementary", { name: "Event preview" })).not.toContainText("Harbor World");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: null, venueLabel: "New room" });
});

for (const editor of ["staff", "intake"]) test(`${editor} adds an explicit manual performer and links without changing billing @fixture`, async ({ page }) => {
  if (editor === "staff") await page.goto("/playwright/event-lineup?editor&mode=create");
  else await page.goto("/playwright/event-intake");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true }).click();
  await page.getByRole("button", { name: "Add performer", exact: true }).click();
  const row = page.locator("[data-lineup-row]").first();
  await row.getByRole("combobox", { name: "Performer", exact: true }).fill("Guest A");
  await row.getByRole("button", { name: "Add manual entry", exact: true }).click();
  await expect(row.getByText("Unlinked", { exact: true })).toBeVisible();
  await expect(row.getByRole("textbox", { name: "Performer", exact: true })).toHaveValue("Guest A");
  await row.getByRole("button", { name: "Link profile", exact: true }).click();
  await row.getByRole("combobox", { name: "Performer", exact: true }).fill("Aurora");
  await row.getByRole("option").first().click();
  await expect(row.getByLabel("Display name as", { exact: true })).toHaveValue("Guest A");
});


for (const timed of [true, false]) test(`staff performer actions preserve billing intent and row data with timed=${timed} @fixture`, async ({ page }, testInfo) => {
  const startAt = Date.UTC(2027, 9, 15, 20, 0, 10, 123);
  const endAt = Date.UTC(2027, 9, 15, 21, 0, 30, 456);
  await page.addInitScript(({ timed, startAt, endAt }) => {
    const performer = { slug: "aurora", displayName: "Aurora", imageUrl: "/seed/fixture-avatar-luma.svg", trustLabel: "claimed_verified" };
    const row = { key: "identity-row", clientKey: "identity-row", position: 0, displayLabel: "Guest A", roleLabel: "DJ", performer, ...(timed ? { startAt, endAt, selectedStreamId: "vrcdn:aurora" } : {}) };
    localStorage.setItem("event-lineup-fixture-v1", JSON.stringify({ id: "identities", slug: "identities", title: "Identity night", usesCanonicalLineup: true, startAt, endAt: endAt + 3_600_000, timezone: "UTC", scheduleKind: "timed", status: "scheduled", communitySlug: "afterglow", publicationState: "draft_private", source: { sourceType: "contributor", label: "Stored source" }, watchSurfaceEnabled: true, watchMode: "performer_sequence", mediaLinks: [], authoredMediaLinks: [], worlds: [], participants: [], slots: timed ? [{ ...row, playbackKey: "stored-slot", source: { sourceType: "contributor", label: "Stored source" } }] : [], lineup: [row, { key: "manual-row", position: 1, displayLabel: "Opening guest", roleLabel: "DJ" }], preservedParticipantAssociationIds: ["protected-person", "hidden-person"], preservedSlotAssociationIds: ["stored-slot", "hidden-slot"], preservedWorldAssociationIds: [], retainedLineupAssociations: { participantIds: ["hidden-person"], slotIds: ["hidden-slot"] } }));
  }, { timed, startAt, endAt });
  await page.goto("/playwright/event-lineup?editor");
  const nav = (step: string) => page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: step, exact: true }).click();
  await nav("Lineup");
  const row = page.locator('[data-lineup-row="identity-row"]');
  const bill = row.getByLabel("Display name as", { exact: true });
  await expect(bill).toHaveValue("Guest A");
  await expect(row.getByTestId("selected-identity")).toContainText("Aurora");
  await page.screenshot({ path: testInfo.outputPath("performers-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("performers-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav("Review"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!).lineup)).toBeUndefined();
  await nav("Lineup");
  const select = async (name: string) => {
    await row.getByRole("button", { name: "Change", exact: true }).click();
    const input = row.getByRole("combobox", { name: "Performer", exact: true });
    await input.fill(name);
    await row.getByRole("option").first().click();
    await expect(row).toHaveAttribute("data-lineup-row", "identity-row");
    if (timed) {
      await expect(row).toContainText("20:00:10.123 - 21:00:30.456");
      await expect(row.getByLabel("Stream", { exact: true })).toHaveValue("");
    }
  };
  await select("Lumen"); await expect(bill).toHaveValue("Guest A");
  await bill.fill("");
  await select("Aurora");
  await row.locator("summary").filter({ hasText: "Display name as" }).click();
  await expect(bill).toHaveValue("");
  await bill.fill("Aurora");
  await select("Lumen"); await expect(bill).toHaveValue("Aurora");
  await select("Aurora");
  await row.getByRole("button", { name: "Change", exact: true }).click();
  await row.getByRole("combobox", { name: "Performer", exact: true }).fill("Guest A");
  await row.getByRole("button", { name: "Add manual entry", exact: true }).click();
  await expect(row.getByText("Unlinked", { exact: true })).toBeVisible();
  if (timed) await expect(row.getByLabel("Stream", { exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Link profile", exact: true }).click();
  await row.getByRole("combobox", { name: "Performer", exact: true }).fill("Aurora");
  await row.getByRole("option").first().click();
  await expect(bill).toHaveValue("Guest A");
  await nav("Review"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem("event-lineup-fixture-v1-submission")!));
  expect(payload.lineup[0]).toMatchObject({ clientKey: "identity-row", personSlug: "aurora", performerLabel: "Guest A", roleLabel: "DJ" });
  expect(payload.lineup[0].startAt).toBe(timed ? startAt : undefined);
  expect(payload.lineup[0].endAt).toBe(timed ? endAt : undefined);
  if (timed) expect(payload.lineup[0].selectedStreamId).toBeNull();
  expect(payload.preserveLineupConfirmation).toBe(true);
  expect(payload.retainedLineupAssociations).toEqual({ participantIds: ["hidden-person"], slotIds: ["hidden-slot"] });
});

for (const timed of [true, false]) test(`intake performer linking preserves raw row timing with timed=${timed} @fixture`, async ({ page }) => {
  const initialRow = { clientKey: "saved-row", position: 0, performerLabel: "Guest A", roleLabel: "DJ", ...(timed ? { start: { time: "20:15", dayOffset: 0 }, end: { time: "21:45", dayOffset: 0 } } : {}) };
  await page.addInitScript(row => { if (!sessionStorage.getItem("event-intake-fixture")) sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Identity night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, lineup: [row] })); }, initialRow);
  await page.goto("/playwright/event-intake");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true }).click();
  const row = page.locator('[data-lineup-row="saved-row"]');
  await row.getByRole("button", { name: "Link profile", exact: true }).click();
  const input = row.getByRole("combobox", { name: "Performer", exact: true });
  await input.fill("Aurora"); await input.press("Tab");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!))).lineup[0]).toEqual(initialRow);
  await input.focus(); await row.getByRole("option").first().click();
  await expect(row.getByLabel("Display name as", { exact: true })).toHaveValue("Guest A");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = (await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!))).lineup[0];
  expect(saved).toMatchObject(initialRow);
  expect(saved.personSlug).toBeTruthy();
  expect(saved.start).toEqual(initialRow.start);
  expect(saved.end).toEqual(initialRow.end);
  await page.reload();
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true }).click();
  await expect(row.getByLabel("Display name as", { exact: true })).toHaveValue("Guest A");
});


test("saved unavailable intake performer remains linked through billing edits @fixture", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("event-intake-fixture", JSON.stringify({ communitySlug: "playwright-afterglow-social", title: "Unavailable person", eventDate: "2027-10-15", timeTba: true, lineup: [{ clientKey: "unavailable", position: 0, performerLabel: "Saved billing", personSlug: "not-a-public-person", roleLabel: "DJ" }] })));
  await page.goto("/playwright/event-intake");
  await page.getByRole("navigation", { name: "Event editor" }).getByRole("button", { name: "Lineup", exact: true }).click();
  const row = page.locator('[data-lineup-row="unavailable"]');
  await expect(row.getByRole("button", { name: "Change", exact: true })).toBeVisible();
  await expect(row.getByLabel("Display name as", { exact: true })).toHaveValue("Saved billing");
  await row.getByLabel("Display name as", { exact: true }).fill("Updated billing");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = (await page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-fixture")!))).lineup[0];
  expect(saved).toMatchObject({ clientKey: "unavailable", personSlug: "not-a-public-person", performerLabel: "Updated billing", roleLabel: "DJ" });
});

for (const action of ['replace', 'clear', 'manual', 'billing']) test(`staff stream selection follows performer identity: ${action} @flow @fixture`, async ({ page }, testInfo) => {
  const startAt = Date.UTC(2027, 9, 15, 20, 0, 10, 123);
  const endAt = Date.UTC(2027, 9, 15, 21, 0, 30, 456);
  await page.addInitScript(({ startAt, endAt }) => {
    const source = { sourceType: 'contributor', label: 'Stored source' };
    const performer = { slug: 'lumen', displayName: 'Lumen', trustLabel: 'claimed_verified' };
    const row = { key: 'stream-row', clientKey: 'stream-row', playbackKey: 'stored-slot', position: 0, startAt, endAt, displayLabel: 'Guest billing', roleLabel: 'DJ', performer, selectedStreamId: 'lumen-main', streamChoices: [{ streamId: 'lumen-main', pcUrl: 'rtspt://example.com/main', questUrl: 'https://example.com/main.ts' }], source };
    localStorage.setItem('event-lineup-fixture-v1', JSON.stringify({ id: 'streams', slug: 'streams', title: 'Stream night', usesCanonicalLineup: true, startAt, endAt, timezone: 'UTC', scheduleKind: 'timed', status: 'scheduled', publicationState: 'draft_private', source, watchSurfaceEnabled: true, watchMode: 'performer_sequence', mediaLinks: [], worlds: [], participants: [], slots: [row], lineup: [row], preservedParticipantAssociationIds: ['protected-person'], preservedSlotAssociationIds: ['stored-slot', 'hidden-slot'], preservedWorldAssociationIds: [], retainedLineupAssociations: { participantIds: ['protected-person'], slotIds: ['hidden-slot'] } }));
  }, { startAt, endAt });
  await page.goto('/playwright/event-lineup?editor');
  const nav = (step: string) => page.getByRole('navigation', { name: 'Event editor' }).getByRole('button', { name: step, exact: true }).click();
  await nav('Lineup');
  const row = page.locator('[data-lineup-row="stream-row"]');
  await expect(row.getByLabel('Stream', { exact: true })).toHaveValue('lumen-main');
  if (action === 'replace') await page.evaluate(() => localStorage.setItem('fixture-stream-defer-person', 'aurora'));
  if (action === 'billing') {
    await row.getByLabel('Display name as', { exact: true }).fill('New billing');
    await row.getByRole('button', { name: 'Change', exact: true }).click();
    await row.getByRole('combobox', { name: 'Performer', exact: true }).fill('Lumen');
    await row.getByRole('option').first().click();
    await expect(row.getByLabel('Stream', { exact: true })).toHaveValue('lumen-main');
  } else if (action === 'clear') {
    await row.getByRole('button', { name: 'Clear', exact: true }).click();
  } else {
    await row.getByRole('button', { name: 'Change', exact: true }).click();
    await row.getByRole('combobox', { name: 'Performer', exact: true }).fill(action === 'replace' ? 'Aurora' : 'Manual guest');
    if (action === 'replace') await row.getByRole('option').first().click();
    else await row.getByRole('button', { name: 'Add manual entry', exact: true }).click();
  }
  await expect(row).toContainText('20:00:10.123 - 21:00:30.456');
  if (action === 'replace') {
    await expect(row.getByLabel('Stream', { exact: true })).toHaveValue('');
    await expect(row.getByLabel('Stream', { exact: true }).locator('option')).toHaveText(['Unavailable']);
    await page.screenshot({ path: testInfo.outputPath('performer-stream-cleared.png'), fullPage: true });
  }
  if (action === 'clear' || action === 'manual') await expect(row.getByLabel('Stream', { exact: true })).toHaveCount(0);
  await nav('Review');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'false');
  const payload = await page.evaluate(() => JSON.parse(localStorage.getItem('event-lineup-fixture-v1-submission')!));
  expect(payload.lineup[0]).toMatchObject({ clientKey: 'stream-row', startAt, endAt, roleLabel: 'DJ', selectedStreamId: action === 'billing' ? 'lumen-main' : null, performerLabel: action === 'billing' ? 'New billing' : action === 'manual' ? 'Manual guest' : 'Guest billing' });
  expect(payload.lineup[0].personSlug).toBe(action === 'billing' ? 'lumen' : action === 'replace' ? 'aurora' : undefined);
  expect(payload.preserveLineupConfirmation).toBe(true);
  expect(payload.retainedLineupAssociations).toEqual({ participantIds: ['protected-person'], slotIds: ['hidden-slot'] });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('event-lineup-fixture-v1')!).source)).toEqual({ sourceType: 'contributor', label: 'Stored source' });
});
