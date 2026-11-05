import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, story = "independent") {
  await page.goto(`/iframe.html?id=home-preference-controls--${story}&viewMode=story`);
  await expect(page.getByRole("heading", { name: "Aurora · ORBIT" })).toBeVisible();
}
async function observeAnimations(page: Page) {
  await page.evaluate(() => {
    document.body.dataset.animations = "[]";
    document.addEventListener("animationstart", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (!button) return;
      const recorded: string[] = JSON.parse(document.body.dataset.animations ?? "[]");
      recorded.push(button.getAttribute("aria-label") ?? "");
      document.body.dataset.animations = JSON.stringify(recorded);
    });
  });
}
async function animations(page: Page) {
  // Let browser animation events and React's post-activation render settle.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => JSON.parse(document.body.dataset.animations ?? "[]"));
}
async function capture(page: Page, name: string) {
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") {
    await page.screenshot({ path: `../../.cache/artifacts/home-preference-${name}-${test.info().project.name}.png`, fullPage: true });
  }
}

test("favoritesAndInterestAreIndependent @storybook-visual", async ({ page }) => {
  await open(page);
  const favorite = page.getByLabel("Set controls", { exact: true }).getByRole("button").nth(0);
  const interest = page.getByLabel("Set controls", { exact: true }).getByRole("button").nth(1);
  await expect(favorite).toHaveAccessibleName("Favorite: Aurora");
  await expect(interest).toHaveAccessibleName("Interested: Aurora at ORBIT");
  const favoriteSvg = await favorite.locator("svg").elementHandle();
  await expect(favorite).toHaveAttribute("title", "Favorite: Aurora");
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(interest).toHaveAttribute("aria-pressed", "false");
  await interest.click();
  await expect(interest).toHaveAttribute("aria-pressed", "true");
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  expect(await favoriteSvg?.evaluate((element) => element === document.querySelector('[aria-label="Set controls"] button:first-child svg'))).toBe(true);
  await favorite.click();
  await expect(interest).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Toggle attempts")).toHaveText("3");
  for (const button of [favorite, interest]) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(40);
    expect(bounds?.height).toBeGreaterThanOrEqual(40);
  }
  await capture(page, "independent");
});

test("includedSetDoesNotToggle @storybook-visual", async ({ page }) => {
  await open(page, "included");
  const interest = page.getByRole("button", { name: "Included with event: Aurora at ORBIT", exact: true });
  await expect(interest).toBeDisabled();
  await expect(interest).toHaveAttribute("aria-pressed", "true");
  await expect(interest).toHaveAttribute("title", "Included with event");
  await interest.evaluate((element) => { if (element instanceof HTMLButtonElement) element.click(); });
  await page.getByRole("link", { name: "Open set" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Favorite: Aurora", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Favorite: Aurora copy", exact: true })).toBeFocused();
  await expect(page.getByLabel("Toggle attempts")).toHaveText("0");
  await capture(page, "included");
});

test("checkBecomesRemoveOnHoverAndKeyboardFocus @storybook-visual", async ({ page }) => {
  await open(page, "selected");
  const interest = page.getByLabel("Set controls", { exact: true }).getByRole("button").nth(1);
  await expect(interest).toHaveAccessibleName("Remove interest: Aurora at ORBIT");
  const check = interest.locator('[data-glyph="check"]');
  const remove = interest.locator('[data-glyph="remove"]');
  const svg = await interest.locator("svg").elementHandle();
  await page.mouse.move(0, 0);
  await expect(check).toHaveCSS("opacity", "1");
  await expect(remove).toHaveCSS("opacity", "0");
  await interest.hover();
  await expect(interest).toHaveAttribute("title", "Remove interest");
  await expect(check).toHaveCSS("opacity", "0");
  await expect(remove).toHaveCSS("opacity", "1");
  await capture(page, "remove-hover");
  await page.mouse.move(0, 0);
  await page.getByRole("link", { name: "Open set" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(interest).toBeFocused();
  await expect(remove).toHaveCSS("opacity", "1");
  await capture(page, "remove-focus");
  await page.getByRole("button", { name: "Change size" }).click();
  expect(await svg?.evaluate((element) => element === document.querySelector('[aria-label="Set controls"] button:nth-child(2) svg'))).toBe(true);
  const bounds = await interest.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(24);
  expect(bounds?.height).toBeGreaterThanOrEqual(24);
  await interest.focus();
  await page.keyboard.press("Enter");
  await expect(interest).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Toggle attempts")).toHaveText("1");
});

test("onlyDirectSelectionAnimates @storybook-visual", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page);
  await observeAnimations(page);
  await page.getByRole("button", { name: "Favorite: Aurora", exact: true }).click();
  await expect.poll(() => animations(page)).toEqual(["Remove favorite: Aurora"]);
  await page.getByRole("button", { name: "Interested: Aurora at ORBIT", exact: true }).click();
  await expect.poll(() => animations(page)).toEqual(["Remove favorite: Aurora", "Remove interest: Aurora at ORBIT"]);
  await page.getByRole("button", { name: "Change size" }).click();
  await page.getByRole("button", { name: "Remove interest: Aurora at ORBIT", exact: true }).click();
  expect(await animations(page)).toEqual(["Remove favorite: Aurora", "Remove interest: Aurora at ORBIT"]);
  await page.getByRole("button", { name: "Interested: Aurora at ORBIT", exact: true }).click();
  await expect.poll(() => animations(page)).toEqual(["Remove favorite: Aurora", "Remove interest: Aurora at ORBIT", "Remove interest: Aurora at ORBIT"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await observeAnimations(page);
  await page.getByRole("button", { name: "Favorite: Aurora", exact: true }).click();
  await page.getByRole("button", { name: "Interested: Aurora at ORBIT", exact: true }).click();
  expect(await animations(page)).toEqual([]);
  await expect(page.getByRole("button", { name: "Remove interest: Aurora at ORBIT", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await animations(page)).toEqual([]);
});

test("externalOrRejectedUpdatesDoNotPop @storybook-visual", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await open(page, "selected");
  expect(await page.locator("button svg").evaluateAll((icons) => icons.flatMap((icon) => icon.getAnimations()).length)).toBe(0);
  await open(page, "capacity");
  await observeAnimations(page);
  await page.getByRole("button", { name: "Favorite: Aurora", exact: true }).click();
  await expect(page.getByLabel("Preference outcome")).toHaveText("limit");
  await page.getByRole("button", { name: "Interested: Aurora at ORBIT", exact: true }).click();
  await expect(page.getByLabel("Preference outcome")).toHaveText("limit");
  await expect(page.getByRole("button", { name: "Favorite: Aurora", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Interested: Aurora at ORBIT", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Simulate other tab" }).click();
  await expect(page.getByRole("button", { name: "Remove favorite: Aurora", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Remove interest: Aurora at ORBIT", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await animations(page)).toEqual([]);
  await expect(page.getByLabel("Toggle attempts")).toHaveText("2");
  await capture(page, "external");
});
