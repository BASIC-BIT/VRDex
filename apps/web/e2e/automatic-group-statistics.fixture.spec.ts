import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/Indianapolis" });

test("public population preserves gaps, zero and actual pointer/keyboard observation times @visual", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/playwright-group-population");
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
  await expect(page.locator(".population-history").locator("..")).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("0 people", { exact: true })).toBeVisible();
  const curve = page.locator('.population-history .recharts-line-curve');
  await expect(curve).toHaveCount(2);
  for (const path of await curve.all()) expect((await path.getAttribute("d"))?.match(/M/g)?.length).toBe(2);
  await page.getByRole("slider", { name: "Observation" }).focus();
  await page.keyboard.press("Home");
  const first = page.getByRole("status", { name: "Observation details" });
  await expect(first).toContainText("12 people");
  const keyboardTime = await first.locator("time").getAttribute("datetime");
  expect(keyboardTime).toMatch(/:17\.000Z$/);
  await page.locator('[data-observed-at]').first().hover();
  await expect(page.locator('.recharts-tooltip-wrapper time')).toHaveAttribute("datetime", keyboardTime!);
  await page.evaluate(() => scrollTo(0, 0));
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: testInfo.outputPath("public-population-gap.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("public profile JSON, DOM, links and history exclude private server fixture records @visual", async ({ page }, testInfo) => {
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/v0/communities/")) requests.push(request.url()); });
  const initialResponse = page.waitForResponse(response => response.url().endsWith("/api/v0/communities/playwright-group-population"));
  await page.goto("/playwright-group-population");
  const initial = await initialResponse;
  expect(initial.ok()).toBeTruthy();
  const json = await initial.json();
  const historicalResponse = page.waitForResponse(response => response.url().includes("statisticsStartAt="));
  await page.getByLabel("Inspect day").fill("2026-10-20");
  const historical = await historicalResponse;
  expect(historical.ok()).toBeTruthy();
  const historicalJson = await historical.json();
  const requested = new URL(historical.url());
  expect(requested.searchParams.get("statisticsStartAt")).toBe("1792468800000");
  expect(requested.searchParams.get("statisticsEndAt")).toBe("1792555200000");
  await expect(page.getByText("No observations", { exact: true })).toBeVisible();
  const backResponse = page.waitForResponse(response => response.url().endsWith("/api/v0/communities/playwright-group-population"));
  await page.getByRole("button", { name: "Last 24 hours" }).click();
  const back = await backResponse;
  expect(back.ok()).toBeTruthy();
  const backJson = await back.json();
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
  const requestCount = requests.length;
  await page.getByLabel("Inspect day").fill("2025-11-02");
  await expect(page.getByRole("alert").filter({ hasText: "Choose a completed day" })).toBeVisible();
  expect(requests.length).toBe(requestCount);
  expect(json.telemetry.populationSeries.buckets).toHaveLength(720);
  const evidence = JSON.stringify({ network: [json, historicalJson, backJson], dom: await page.content(), links: await page.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href"))), history: await page.evaluate(() => ({ url: location.href, state: history.state, navigation: performance.getEntriesByType("navigation").map(entry => entry.name) })), requests });
  expect(evidence).not.toContain("PRIVATE_LOCATION_TASK7_SENTINEL");
  expect(evidence).not.toContain("usr_private_task7");
  expect(evidence).not.toContain("wrld_private_task7");
  await testInfo.attach("public-privacy-evidence", { body: evidence, contentType: "application/json" });
});

test("current zero expires without a reload @visual", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await page.goto("/playwright-group-population");
  await expect(page.getByText("0 people", { exact: true })).toBeVisible();
  await page.clock.fastForward(7 * 60_000);
  await expect(page.getByText("Stale", { exact: true })).toBeVisible();
  await expect(page.getByText("0 people", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
});

test("a failed range read keeps the last successful range and existing control can retry @visual", async ({ page }) => {
  await page.goto("/playwright-group-population");
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
  await page.route("**/api/v0/communities/*?statisticsStartAt=*", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.getByLabel("Inspect day").fill("2026-10-20");
  await expect(page.getByRole("alert").filter({ hasText: "Profile read failed" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
  await expect(page.getByLabel("Inspect day")).toHaveValue("");
  await page.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Profile read failed" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
});

test("dense 24-hour observations retain exact keyboard times and pointer details @visual", async ({ page }, testInfo) => {
  await page.goto("/playwright-group-population-dense");
  await expect(page.locator(".population-history").locator("..")).toHaveAttribute("aria-busy", "false");
  const slider = page.getByRole("slider", { name: "Observation" });
  await expect(slider).toHaveAttribute("max", "719");
  await slider.focus();
  await page.keyboard.press("Home");
  const details = page.getByRole("status", { name: "Observation details" });
  const firstTime = await details.locator("time").getAttribute("datetime");
  expect(firstTime).toMatch(/:17\.000Z$/);
  await page.keyboard.press("ArrowRight");
  const secondTime = await details.locator("time").getAttribute("datetime");
  expect(Date.parse(secondTime!) - Date.parse(firstTime!)).toBe(120_000);
  await page.locator('[data-observed-at]').first().hover();
  await expect(page.locator('.recharts-tooltip-wrapper time')).toHaveAttribute("datetime", firstTime!);
  await page.evaluate(() => scrollTo(0, 0));
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: testInfo.outputPath("public-population-dense.png"), fullPage: true });
});

for (const omission of ["telemetry", "populationSeries"] as const) test(`successful refresh removes previously visible ${omission} @visual`, async ({ page }, testInfo) => {
  await page.goto("/playwright-group-population");
  await expect(page.getByRole("img", { name: "Population history" })).toBeVisible();
  await expect(page.getByText("0 people", { exact: true })).toBeVisible();
  await expect(page.locator(".population-history").locator("..")).toHaveAttribute("aria-busy", "false");
  await page.route("**/api/v0/communities/*", async route => {
    const response = await route.fetch();
    const profile = await response.json();
    if (omission === "telemetry") delete profile.telemetry;
    else { delete profile.telemetry.populationSeries; delete profile.telemetry.currentPopulation; }
    await route.fulfill({ response, json: profile });
  });
  await page.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(page.getByRole("img", { name: "Population history" })).toHaveCount(0);
  await expect(page.getByText("0 people", { exact: true })).toHaveCount(0);
  if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: testInfo.outputPath(`permission-refresh-${omission}.png`), fullPage: true });
});

test("empty, stale and managed-disabled population states remain usable at ordinary widths @visual", async ({ page }, testInfo) => {
  for (const state of ["empty", "stale", "managed-disabled", "managed"]) {
    await page.goto(`/playwright-group-population-${state}`);
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    if (state === "empty") await expect(page.getByText("No observations", { exact: true })).toBeVisible();
    if (state === "stale") { await expect(page.getByText("Stale", { exact: true })).toBeVisible(); await expect(page.getByText("0 people", { exact: true })).toHaveCount(0); }
    if (state === "managed-disabled") await expect(page.getByRole("img", { name: "Population history" })).toHaveCount(0);
    if (state === "managed") { await expect(page.getByRole("heading", { name: "Recent instances" })).toBeVisible(); await expect(page.getByText("Afterglow night", { exact: true })).toBeVisible(); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.evaluate(() => scrollTo(0, 0));
    if (process.env.PLAYWRIGHT_CAPTURE_SCREENSHOTS !== "false") await page.screenshot({ path: testInfo.outputPath(`public-population-${state}.png`), fullPage: true });
  }
});
