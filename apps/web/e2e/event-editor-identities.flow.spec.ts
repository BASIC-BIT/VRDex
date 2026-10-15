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
    await page
      .getByRole("button", { name: "Add manual entry", exact: true })
      .click();
    await expect(page.getByTestId("manual-name")).toHaveText("Failure");
    await expect(page.getByTestId("selected-slug")).toHaveText("");
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
