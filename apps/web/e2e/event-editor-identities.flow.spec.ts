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

test("stored Details retain doors world label and optional source through save @fixture", async ({ page }, testInfo) => {
  await page.addInitScript(() => sessionStorage.setItem("fixture-source-draft", JSON.stringify({ version: 1, fields: { communitySlug: "afterglow", title: "Harbor night", eventDate: "2027-10-15", timezone: "UTC", start: { time: "20:00" }, doors: { time: "19:45" }, worldSlug: "harbor-world", venueLabel: "Custom pier", sourceUrl: "https://example.com/original-post" } })));
  await page.goto("/playwright/event-intake?source=details");
  await expect(page.getByLabel("Doors open", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("Custom pier");
  await expect(page.getByLabel("Original event post", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: "harbor-world", venueLabel: "Custom pier", sourceUrl: "https://example.com/original-post", doors: { time: "19:45" } });
  await page.getByRole("button", { name: "Use manual location", exact: true }).click();
  await expect(page.getByLabel("Where", { exact: true })).toHaveValue("Custom pier");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch.worldSlug)).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("details-manual-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Change", exact: true }).last().click();
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
  await page.getByRole("button", { name: "Use manual location", exact: true }).click();
  const manual = page.getByRole("textbox", { name: "Where", exact: true });
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
  await page.getByRole("button", { name: "Use manual location", exact: true }).click();
  const manual = page.getByRole("textbox", { name: "Where", exact: true });
  await expect(manual).toBeVisible();
  await manual.fill("New room");
  await page.evaluate(async () => { window.dispatchEvent(new Event("release-world-presentation")); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  await expect(manual).toHaveValue("New room");
  await expect(page.getByRole("complementary", { name: "Event preview" })).toContainText("New room");
  await expect(page.getByRole("complementary", { name: "Event preview" })).not.toContainText("Harbor World");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("event-intake-revision-submission")!).patch)).toMatchObject({ worldSlug: null, venueLabel: "New room" });
});
