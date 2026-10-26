import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expectHomePage, prepareVisualPage, waitForVisualReady } from "./public-routes";

test("approved wordmark is exact and visible on Home and both search shells @flow", async ({ page, request }) => {
  const canonical = await readFile("../../docs/brand/wordmark/vrdex-wordmark.svg");
  const asset = await request.get("/brand/vrdex-wordmark.svg");
  await expect(asset).toBeOK();
  expect(await asset.body()).toEqual(canonical);
  const license = await request.get("/brand/LICENSE-OpenSans.txt");
  await expect(license).toBeOK();
  expect(await license.body()).toEqual(await readFile("../../docs/brand/wordmark/LICENSE-OpenSans.txt"));
  for (const route of ["/", "/search?q=BASICBIT", "/search?q=BASICBIT&view=dj"]) {
    await page.goto(route);
    const wordmark = page.getByRole("navigation").first().getByRole("img", { name: "VRDex", exact: true });
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveAttribute("src", "/brand/vrdex-wordmark.svg");
    const box = await wordmark.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(469.002 / 132, 2);
    const explanation = page.getByText("Search across public people, communities, worlds, and events.", { exact: true });
    await expect(explanation).toHaveCount(route.includes("view=dj") ? 1 : 0);
    await page.getByRole("button", { name: "Toggle color theme", exact: true }).click();
    await expect(wordmark).toBeVisible();
    await expect(wordmark.locator("..")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await wordmark.locator("..").click();
    await expect(page).toHaveURL((url) => url.pathname === "/" && !url.search);
  }
  await page.goto("/discovery");
  const discoveryBrand = page.getByRole("navigation").first().getByRole("link", { name: "VRDex", exact: true });
  await expect(discoveryBrand).toHaveText("VRDex");
  await expect(discoveryBrand.locator("img")).toHaveCount(0);
});

test("new Home submissions and old root bookmarks retain distinct destinations @flow", async ({ page }) => {
  await page.goto("/");
  await expectHomePage(page);
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("  BASICBIT  ");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
  await expect(publicResultRow(page, "/basicbit")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Search view" })).toHaveCount(0);
  await page.goto("/?q=%20BASICBIT%20");
  await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
  await expect(page.getByLabel("DJ name")).toHaveValue("BASICBIT");
  await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
});

test("whitespace root query keeps Home and discovery reachable @flow", async ({ page }) => {
  await page.goto("/?q=%20%20%20");
  await expectHomePage(page);
  await expect(page.getByRole("combobox", { name: /Search/i })).toHaveValue("");
  await expect(page.getByRole("heading", { name: /My night|Upcoming events|Favorites|Timeline/i })).toHaveCount(0);
  await page.getByRole("link", { name: "Discovery", exact: true }).click();
  await expect(page).toHaveURL(/\/discovery$/);
  await expect(page.getByRole("heading", { name: "Discover VR", exact: true })).toBeVisible();
});

test("Home search, filters, refresh and history keep URL and results aligned @flow", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("Afterglow");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Afterglow$/);
  await expect(publicResultRow(page, "/playwright-afterglow-social")).toBeVisible();
  await expect(publicResultRow(page, "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions")).toBeVisible();
  await page.getByRole("link", { name: "Communities", exact: true }).click();
  const assertCommunityState = async () => {
    await expect(page).toHaveURL(/\/search\?q=Afterglow&type=community$/);
    await expect(input).toHaveValue("Afterglow");
    await expect(page.getByRole("link", { name: "Communities", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(publicResultRow(page, "/playwright-afterglow-social")).toBeVisible();
    await expect(publicResultRow(page, "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions")).toHaveCount(0);
  };
  await assertCommunityState();
  await page.reload();
  await assertCommunityState();
  await page.goBack();
  await expect(page).toHaveURL(/\/search\?q=Afterglow$/);
  await expect(input).toHaveValue("Afterglow");
  await expect(page.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(publicResultRow(page, "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions")).toBeVisible();
  await page.goForward();
  await assertCommunityState();
});

for (const destination of [
  { query: "BASICBIT", name: /BASICBIT/, path: "/basicbit" },
  { query: "Afterglow Social", name: /Afterglow Social/, path: "/playwright-afterglow-social" },
  { query: "Afterglow Harbor Sessions", name: /Afterglow Harbor Sessions/, path: "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions" },
  { query: "Neon Harbor", name: /Neon Harbor/, path: "/playwright-neon-harbor" },
]) {
  test(`Home preview opens canonical ${destination.path} @flow`, async ({ page, isMobile }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: /Search/i }).fill(destination.query);
    const option = page.getByRole("option", { name: destination.name }).first();
    await expect(option).toBeVisible();
    if (isMobile) await option.tap();
    else await option.click();
    await expect(page).toHaveURL((url) => url.pathname === destination.path && !url.search);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("Home rest and five-option preview stay within the viewport @flow", async ({ page }, info) => {
  await prepareVisualPage(page);
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  await page.goto("/");
  await expectHomePage(page);
  await waitForVisualReady(page);
  await page.screenshot({ path: info.outputPath("home-rest.png"), fullPage: true });
  const heading = page.getByRole("heading", { name: "DJs, clubs & events", exact: true });
  const before = await heading.boundingBox();
  const input = page.getByRole("combobox", { name: /Search/i });
  await input.fill("playwright");
  await expect(page.getByRole("option")).toHaveCount(5);
  expect(await heading.boundingBox()).toEqual(before);
  await expect(page.getByRole("link", { name: "View all results", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("home-preview.png"), fullPage: true });
});

function publicResultRow(page: Page, path: string) {
  return page.getByRole("region", { name: "Search results" }).locator(`a[href="${path}"]`).locator("..");
}

test("public result genres and Links disclose independently per person @flow", async ({ page }, info) => {
  await prepareVisualPage(page);
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  await page.goto("/search?q=VRDJ");
  await expect(page.getByRole("heading", { name: "Search results", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Search view" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "DJ links", exact: true })).toHaveCount(0);
  const first = publicResultRow(page, "/basicbit");
  const second = publicResultRow(page, "/playwright-moth");
  await expect(first.getByRole("link", { name: /BASICBIT/ })).toBeVisible();
  await expect(first.getByText("Software Dev | 3D Designer | VRDJ", { exact: true })).toBeVisible();
  await expect(first.getByText("DnB · House · Techno", { exact: true })).toBeVisible();
  await expect(first.getByText("Drum and Bass", { exact: true })).toHaveCount(0);
  await expect(first.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await expect(second.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await expect(first.getByText("Bass · 140 · Trap · Space Bass · Midtempo · UKG · Dancefloor · Neurofunk", { exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("public-results-collapsed.png"), fullPage: true });
  const overflow = first.getByText("+8", { exact: true });
  await overflow.focus();
  await overflow.press("Enter");
  await expect(first.getByText("Bass · 140 · Trap · Space Bass · Midtempo · UKG · Dancefloor · Neurofunk", { exact: true })).toBeVisible();
  await expect(first.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await first.getByText("Links", { exact: true }).click();
  await second.getByText("Links", { exact: true }).click();
  await expect(first.getByRole("button", { name: "Copy", exact: true }).first()).toBeVisible();
  await expect(second.getByRole("button", { name: "Copy", exact: true }).first()).toBeVisible();
  await expect(first.locator('a[href="/basicbit"] button, a[href="/basicbit"] summary')).toHaveCount(0);
  await expect(first.getByRole("link", { name: "Website: basicbit.net", exact: true })).toHaveAttribute("href", "https://basicbit.net/");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("public-results-expanded.png"), fullPage: true });
  await first.locator('a[href="/basicbit"]').click();
  await expect(page).toHaveURL(/\/basicbit$/, { timeout: 15_000 });
});

test("sparse public results omit empty disclosure controls @flow", async ({ page }, info) => {
  await prepareVisualPage(page);
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  await page.goto("/search?q=Sparse%20Import");
  const row = publicResultRow(page, "/playwright-sparse-import");
  await expect(row.getByRole("link", { name: /Sparse Import/ })).toBeVisible();
  await expect(row.getByRole("link", { name: "Claim this profile", exact: true })).toHaveAttribute("href", "/claim/playwright-sparse-import?source=search");
  await expect(row.getByText("Links", { exact: true })).toHaveCount(0);
  await expect(row.locator("summary")).toHaveCount(0);
  await expect(row.getByText("No public links", { exact: true })).toHaveCount(0);
  await waitForVisualReady(page);
  await page.screenshot({ path: info.outputPath("public-results-sparse.png"), fullPage: true });
});

test("long public names and link destinations fit narrow results @flow", async ({ page, isMobile }, info) => {
  await prepareVisualPage(page);
  await page.addInitScript(() => localStorage.setItem("vrdex-theme", "dark"));
  if (isMobile) await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/search?q=Princess%20Starlight");
  const row = publicResultRow(page, "/playwright-princess-starlight-interstellar-bassline");
  await expect(row.getByRole("link", { name: /Princess Starlight Interstellar Bassline Orchestra/ })).toBeVisible();
  await row.getByText("Links", { exact: true }).click();
  await expect(row.getByRole("link", { name: "Website: website.example.invalid", exact: true })).toHaveAttribute(
    "href", "https://website.example.invalid/playwright-princess-starlight-interstellar-bassline",
  );
  await waitForVisualReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("public-results-long.png"), fullPage: true });
});

for (const outcome of ["clipboard", "fallback", "failure", "fallback throws"] as const) {
  test(`public result ${outcome} copy preserves panels, focus and URL @flow`, async ({ page }) => {
    const copied: string[] = [];
    const fallbacks: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.exposeFunction("recordCopiedValue", (value: string) => copied.push(value));
    await page.exposeFunction("recordFallbackValue", (value: string) => fallbacks.push(value));
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (value: string) => {
          const record = Reflect.get(window, "recordCopiedValue");
          if (typeof record === "function") await record(value);
          if (mode !== "clipboard") throw new Error("Clipboard denied");
        },
      } });
      document.execCommand = (command) => {
        if (command !== "copy") throw new Error("Unexpected clipboard command");
        const record = Reflect.get(window, "recordFallbackValue");
        if (typeof record === "function") void record(document.activeElement instanceof HTMLTextAreaElement ? document.activeElement.value : "");
        if (mode === "fallback throws") throw new Error("Fallback denied");
        return mode === "fallback";
      };
    }, outcome);
    await page.goto("/search?q=VRDJ");
    const first = publicResultRow(page, "/basicbit");
    const second = publicResultRow(page, "/playwright-moth");
    await first.getByText("Links", { exact: true }).click();
    await second.getByText("Links", { exact: true }).click();
    const url = page.url();
    const button = first.locator("button").first();
    await button.click();
    await expect(first.getByRole("status").filter({ hasText: outcome === "failure" || outcome === "fallback throws" ? "Copy failed" : "Copied" })).toHaveCount(1);
    await expect(button).toBeFocused();
    await expect(first.locator('details[open]')).toHaveCount(1);
    await expect(second.locator('details[open]')).toHaveCount(1);
    await expect(second.getByRole("button", { name: "Copy", exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(url);
    await expect(page.locator("textarea")).toHaveCount(0);
    expect(copied).toEqual(["basic_bit"]);
    expect(fallbacks).toEqual(outcome === "clipboard" ? [] : ["basic_bit"]);
    expect(errors).toEqual([]);
    if (outcome === "clipboard" || outcome === "fallback") {
      await expect(button).toHaveAccessibleName("Copy");
      await expect(first.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(0);
    }
  });
}

test("overlapping public copies retain one reset timer and cancel it on unmount @flow", async ({ page }) => {
  await page.goto("/search?q=VRDJ");
  const row = publicResultRow(page, "/basicbit");
  await row.getByText("Links", { exact: true }).click();
  const button = row.getByRole("button", { name: "Copy", exact: true }).first();
  const now = new Date();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.evaluate(() => {
    const copies: Array<() => void> = [];
    const timers = new Set<number>();
    let fired = 0;
    const setTimer = window.setTimeout.bind(window);
    const clearTimer = window.clearTimeout.bind(window);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: () => new Promise<void>((resolve) => copies.push(resolve)),
    } });
    // Observe the real reset callbacks while Playwright controls browser time.
    Object.defineProperty(window, "setTimeout", { configurable: true, value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 1400 || typeof handler !== "function") return setTimer(handler, delay, ...args);
      const timer = setTimer(() => {
        timers.delete(timer);
        fired++;
        handler(...args);
      }, delay);
      timers.add(timer);
      return timer;
    } });
    Object.defineProperty(window, "clearTimeout", { configurable: true, value: (timer?: number) => {
      if (timer !== undefined) timers.delete(timer);
      clearTimer(timer);
    } });
    Reflect.set(window, "copyLifecycle", {
      count: () => copies.length,
      settle: (index: number) => copies[index]?.(),
      timers: () => ({ pending: timers.size, fired }),
    });
  });
  await button.click();
  await button.click();
  expect(await page.evaluate(() => Reflect.get(window, "copyLifecycle").count())).toBe(2);
  await page.evaluate(async () => {
    Reflect.get(window, "copyLifecycle").settle(0);
    await Promise.resolve();
  });
  await page.clock.runFor(900);
  await page.evaluate(() => Reflect.get(window, "copyLifecycle").settle(1));
  await expect(row.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
  expect(await page.evaluate(() => Reflect.get(window, "copyLifecycle").timers())).toEqual({ pending: 1, fired: 0 });
  await page.getByRole("link", { name: "Communities", exact: true }).click();
  await expect(page).toHaveURL(/\/search\?q=VRDJ&type=community$/);
  await expect(row).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "copyLifecycle").timers())).toEqual({ pending: 0, fired: 0 });
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => Reflect.get(window, "copyLifecycle").timers())).toEqual({ pending: 0, fired: 0 });
});

test("expanded public links agree with legacy provider formatting @flow", async ({ page }) => {
  await page.goto("/search?q=BASICBIT");
  const row = publicResultRow(page, "/basicbit");
  await row.getByText("Links", { exact: true }).click();
  const values = await row.locator("input[readonly]").evaluateAll((inputs) => inputs.map((input) => input.getAttribute("value")));
  const preview = await row.getByRole("link", { name: "VRCDN preview", exact: true }).getAttribute("href");
  await expect(row.getByRole("link", { name: "Twitch: twitch.tv", exact: true })).toHaveAttribute("href", "https://www.twitch.tv/basic_bit");
  expect(values).toEqual(["basic_bit", "https://stream.vrcdn.live/live/basicbit.live.ts", "rtspt://stream.vrcdn.live/live/basicbit"]);
  await page.goto("/search?q=BASICBIT&view=dj");
  const legacy = page.locator(".lookup-result-card").filter({ has: page.locator('a[href="/basicbit"]') }).first();
  expect(await legacy.locator("input[readonly]").evaluateAll((inputs) => inputs.map((input) => input.getAttribute("value")))).toEqual(values);
  await expect(legacy.getByRole("link", { name: "VRCDN preview", exact: true })).toHaveAttribute("href", preview!);
});

test("non-person public results retain canonical metadata and viewer-local event dates @flow", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, timezoneId: "America/Los_Angeles" });
  const page = await context.newPage();
  await page.goto("/search?q=Afterglow");
  const event = publicResultRow(page, "/playwright-afterglow-social/events/playwright-afterglow-harbor-sessions");
  await expect(event.getByText("Afterglow Social", { exact: true })).toBeVisible();
  await expect(event.getByText("Late-night harbor club session with house, trance, and warm social energy.", { exact: true })).toBeVisible();
  const time = event.locator("time");
  const timestamp = await time.getAttribute("datetime");
  expect(timestamp).not.toBeNull();
  await expect(time).toHaveText(new Intl.DateTimeFormat("en", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(timestamp!)));
  const community = publicResultRow(page, "/playwright-afterglow-social");
  await expect(community.getByText("A warm VRChat club night for music-first communities.", { exact: true })).toBeVisible();
  await expect(event.locator("summary")).toHaveCount(0);
  await expect(community.locator("summary")).toHaveCount(0);
  await community.locator('a[href="/playwright-afterglow-social"]').click();
  await expect(page).toHaveURL(/\/playwright-afterglow-social$/);
  await page.goto("/search?q=Neon%20Harbor");
  const world = publicResultRow(page, "/playwright-neon-harbor");
  await expect(world.getByText("Cyberpunk harbor club world with layered dance floors and quiet balcony corners.", { exact: true })).toBeVisible();
  await expect(world.locator("summary")).toHaveCount(0);
  await world.locator('a[href="/playwright-neon-harbor"]').click();
  await expect(page).toHaveURL(/\/playwright-neon-harbor$/);
  await context.close();
});

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

for (const entry of ["/", "/discovery"]) test(`${entry} empty input and private lookup recents never enumerate public suggestions @flow`, async ({ page }) => {
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
  await page.goto(entry);
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

test("Home and full search exclude private seed terms and nonpublic profile fields @flow", async ({ page, request }, info) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "Uses anonymous local Convex fixtures only.");
  const headers = { "x-vrdex-e2e-token": process.env.VRDEX_E2E_BROWSER_TOKEN ?? "local-playwright-token" };
  const runId = `playwright-home-privacy-${info.project.name}-${Date.now()}`;
  const displayName = `Home Visibility ${info.project.name} ${Date.now()}`;
  const privateTerm = `secret${Date.now()}`;
  const suggestRequests: string[] = [];
  page.on("request", (value) => { if (value.url().includes("/suggest")) suggestRequests.push(value.url()); });
  try {
    const created = await request.post("/api/e2e/profile-submissions", {
      headers,
      data: { runId, profileType: "person", displayName, aliases: [privateTerm], bio: privateTerm,
        roleTags: [privateTerm], outboundLinks: [{ type: "website", url: "https://example.invalid/private" }],
        fieldVisibility: { aliases: "private", bio: "unlisted", personRoleTags: "private", outboundLinks: "private" } },
    });
    await expect(created).toBeOK();
    const { profilePath } = await created.json();
    await page.goto("/");
    const input = page.getByRole("combobox", { name: /Search/i });
    const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/search/suggest");
    await input.fill(displayName);
    const payload = await (await response).json();
    expect(payload.results.some((value: { routePath: string }) => value.routePath === profilePath)).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(privateTerm);
    expect(JSON.stringify(payload)).not.toContain("example.invalid/private");
    await input.press("Enter");
    const row = publicResultRow(page, profilePath);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(privateTerm);
    await expect(row.getByText("Links", { exact: true })).toHaveCount(0);
    for (const term of [privateTerm, "nwinn"]) {
      await page.goto("/");
      const suggested = page.waitForResponse((value) => new URL(value.url()).pathname === "/search/suggest");
      await input.fill(term);
      expect((await (await suggested).json()).results).toEqual([]);
      await input.press("Enter");
      await expect(publicResultRow(page, profilePath)).toHaveCount(0);
      await expect(page.getByText("DJ Northstar", { exact: true })).toHaveCount(0);
      await expect(page.getByText("No public results matched that search yet.", { exact: true })).toBeVisible();
    }
    expect(suggestRequests.length).toBeGreaterThan(0);
    expect(suggestRequests.every((value) => new URL(value).pathname === "/search/suggest")).toBe(true);
  } finally {
    const cleanup = await request.delete("/api/e2e/profile-submissions", { headers, data: { runId } });
    await expect(cleanup).toBeOK();
  }
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
  await page.goto("/");
  await expectHomePage(page);
  const homeInput = page.getByRole("combobox", { name: /Search/i });
  await homeInput.fill("BASICBIT");
  await homeInput.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
  await expect(publicResultRow(page, "/basicbit")).toBeVisible();
  await page.goto("/search?q=basic&type=person");
  const input = page.getByRole("combobox", { name: /Search/i });
  await expect(input.locator("xpath=ancestor::form")).toHaveAttribute("action", "/search");
  await expect(input.locator("xpath=ancestor::form")).toHaveAttribute("method", "get");
  await input.fill("Aurora");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=Aurora&type=person$/);
  await context.close();
});
