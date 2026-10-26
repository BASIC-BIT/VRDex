import { expect, test } from "@playwright/test";

test("public preview caps real eight-result responses without shifting layout @flow", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  const heading = page.getByRole("heading", { name: "Discover VR", exact: true });
  const before = await heading.boundingBox();
  const response = page.waitForResponse((value) => value.url().includes("/search/suggest?q=playwright"));
  await input.fill("playwright");
  expect((await (await response).json()).results).toHaveLength(8);
  await expect(page.getByRole("option")).toHaveCount(5);
  await expect(page.getByRole("listbox").getByRole("link", { name: "View all results" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View all results", exact: true })).toBeVisible();
  expect(await heading.boundingBox()).toEqual(before);
  const ids = await page.getByRole("option").evaluateAll((options) => options.map((option) => option.id));
  for (let index = 0; index < 6; index++) {
    await input.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", ids[index % 5]);
  }
  await input.press("ArrowUp");
  await expect(input).toHaveAttribute("aria-activedescendant", ids[4]);
  await page.screenshot({ path: info.outputPath("public-search-preview.png"), fullPage: true });
});

test("selected Enter opens the canonical public profile @flow", async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("basic");
  await expect(page.getByRole("option", { name: /BASICBIT/ })).toBeVisible();
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: /BASICBIT/ })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath("public-search-identity.png"), fullPage: true });
  await input.press("Enter");
  await expect(page).toHaveURL(/\/basicbit$/, { timeout: 15_000 });
});

for (const submit of ["Enter", "View all results"]) test(`unselected ${submit} preserves trimmed query and filter @flow`, async ({ page }) => {
  await page.goto("/search?q=basic&type=person");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("  Aurora  ");
  await expect(page.getByRole("option", { name: /DJ Aurora/ })).toBeVisible();
  if (submit === "Enter") await input.press("Enter");
  else await page.getByRole("link", { name: submit, exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=Aurora&type=person$/);
  await expect(input).toHaveValue("Aurora");
  await page.goBack();
  await expect(input).toHaveValue("basic");
  await page.goForward();
  await expect(input).toHaveValue("Aurora");
});

test("clear, dismissal, focus, IME and pointer selection stay usable @flow", async ({ page, isMobile }) => {
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("basic");
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("ArrowDown");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(page).toHaveURL(/\/discovery$/);
  await input.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-activedescendant");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=basic$/);
  await page.goto("/discovery");
  await input.fill("basic");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.getByRole("heading", { name: "Discover VR", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.focus();
  await expect(page.getByRole("option")).toHaveCount(1);
  await input.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.focus();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.fill("basic");
  const option = page.getByRole("option", { name: /BASICBIT/ });
  await expect(option).toBeVisible();
  if (isMobile) await option.tap();
  else await option.click();
  await expect(page).toHaveURL(/\/basicbit$/);
});

test("old query responses and cleared requests cannot restore stale options @flow", async ({ page }) => {
  let releaseOld = () => {};
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let sawOld = () => {};
  const oldStarted = new Promise<void>((resolve) => { sawOld = resolve; });
  await page.route("**/search/suggest?**", async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get("q") === "basic") {
      sawOld();
      await oldGate;
    }
    await route.fulfill({ response });
  });
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("basic");
  await oldStarted;
  await input.fill("Aurora");
  await expect(page.getByRole("option", { name: /DJ Aurora/ })).toBeVisible();
  releaseOld();
  await expect(page.getByRole("option", { name: /BASICBIT/ })).toHaveCount(0);
  await input.press("ArrowDown");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.fill("Aurora");
  await expect(page.getByRole("option", { name: /DJ Aurora/ })).toBeVisible();
  await expect(input).not.toHaveAttribute("aria-activedescendant");
});

test("changing the entity filter invalidates the same visible query @flow", async ({ page }) => {
  let releaseFiltered = () => {};
  const filteredGate = new Promise<void>((resolve) => { releaseFiltered = resolve; });
  let sawFiltered = () => {};
  const filteredStarted = new Promise<void>((resolve) => { sawFiltered = resolve; });
  await page.route("**/search/suggest?**", async (route) => {
    const response = await route.fetch();
    if (new URL(route.request().url()).searchParams.get("type") === "person") {
      sawFiltered();
      await filteredGate;
    }
    await route.fulfill({ response });
  });
  await page.goto("/search?q=afterglow");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("Afterglow");
  await expect(page.getByRole("option", { name: /Afterglow Harbor Sessions/ })).toBeVisible();
  await input.press("ArrowDown");
  const response = page.waitForResponse((value) => value.url().includes("/search/suggest?q=Afterglow&type=person"));
  await page.getByRole("link", { name: "People", exact: true }).focus();
  await page.getByRole("link", { name: "People", exact: true }).press("Enter");
  await expect(input).toHaveValue("Afterglow");
  await filteredStarted;
  await input.focus();
  await expect(page.getByRole("option", { name: /Afterglow Harbor Sessions/ })).toHaveCount(0);
  releaseFiltered();
  await response;
  await expect(input).not.toHaveAttribute("aria-activedescendant");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Afterglow&type=person$/);
});

test("empty input and private lookup recents never enumerate public suggestions @flow", async ({ page }) => {
  const requests: string[] = [];
  const reads: string[] = [];
  await page.exposeFunction("recordPrivateRecentRead", (key: string) => reads.push(key));
  await page.addInitScript(() => {
    localStorage.setItem("vrdex.lookup.recentSearches", JSON.stringify(["private seed secret"]));
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "vrdex.lookup.recentSearches") {
        // Record the read even if a caller catches its storage error.
        window.dispatchEvent(new CustomEvent("private-recent-read", { detail: key }));
      }
      return read.call(this, key);
    };
  });
  await page.addInitScript(() => {
    window.addEventListener("private-recent-read", (event) => {
      if (event instanceof CustomEvent) {
        const recorder = Reflect.get(window, "recordPrivateRecentRead");
        if (typeof recorder === "function") void recorder(event.detail);
      }
    });
  });
  page.on("request", (request) => { if (request.url().includes("/suggest")) requests.push(request.url()); });
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.focus();
  await input.fill("   ");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("private seed secret")).toHaveCount(0);
  expect(requests).toEqual([]);
  await input.fill("basic");
  await expect(page.getByRole("option", { name: /BASICBIT/ })).toBeVisible();
  expect(requests.every((url) => new URL(url).pathname === "/search/suggest")).toBe(true);
  expect(reads).toEqual([]);
});

test("suggestion failure still permits explicit search @flow", async ({ page }) => {
  await page.route("**/search/suggest?**", (route) => route.fulfill({ status: 503, body: "<!doctype html>" }));
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  const failed = page.waitForResponse((response) => response.url().includes("/search/suggest"));
  await input.fill("basic");
  await failed;
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=basic$/);
});

test("clearing an in-flight request invalidates it before the same query is retyped @flow", async ({ page }) => {
  let releaseOld = () => {};
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let sawOld = () => {};
  const oldStarted = new Promise<void>((resolve) => { sawOld = resolve; });
  let releaseNew = () => {};
  const newGate = new Promise<void>((resolve) => { releaseNew = resolve; });
  let sawNew = () => {};
  const newStarted = new Promise<void>((resolve) => { sawNew = resolve; });
  let finishedOld = () => {};
  const oldFinished = new Promise<void>((resolve) => { finishedOld = resolve; });
  let count = 0;
  await page.route("**/search/suggest?**", async (route) => {
    const requestNumber = ++count;
    const response = await route.fetch();
    if (requestNumber === 1) {
      sawOld();
      await oldGate;
      await route.fulfill({ response });
      finishedOld();
    } else {
      sawNew();
      await newGate;
      await route.fulfill({ response });
    }
  });
  await page.goto("/discovery");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("basic");
  await oldStarted;
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await input.fill("basic");
  await newStarted;
  releaseOld();
  await oldFinished;
  await expect(page.getByRole("option")).toHaveCount(0);
  await input.press("ArrowDown");
  await expect(input).not.toHaveAttribute("aria-activedescendant");
  releaseNew();
  await expect(page.getByRole("option", { name: /BASICBIT/ })).toBeVisible();
  await expect(input).not.toHaveAttribute("aria-activedescendant");
});

test("GET search remains usable without JavaScript @flow", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/search?q=basic&type=person");
  const input = page.getByRole("combobox", { name: /Search/i });
  await expect(input.locator("xpath=ancestor::form")).toHaveAttribute("action", "/search");
  await expect(input.locator("xpath=ancestor::form")).toHaveAttribute("method", "get");
  await input.fill("Aurora");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Aurora&type=person$/);
  await context.close();
});
