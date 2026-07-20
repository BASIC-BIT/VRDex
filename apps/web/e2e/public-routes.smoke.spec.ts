import { expect, test } from "@playwright/test";

import {
  capturedRoutes,
  expectEventPage,
  expectSearchPage,
  prepareVisualPage,
  productionSmokeRoutes,
} from "./public-routes";

const routes = process.env.PLAYWRIGHT_BASE_URL ? productionSmokeRoutes : capturedRoutes;
const isHostedRun = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test.beforeEach(async ({ page }) => {
  await prepareVisualPage(page);
});

for (const route of routes) {
  test(`${route.name} renders`, async ({ page }) => {
    await page.goto(route.path);
    await route.expectPage(page);
  });
}

test("sign-in reveals email and password on request", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("Email")).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);

  await page.getByRole("button", { name: "Use email and password" }).click();

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use email and password" })).toHaveCount(0);
});

test("legacy discovery query redirects to search", async ({ page }) => {
  await page.goto("/discover?q=aurora");
  await expect(page).toHaveURL(/\/search\?q=aurora$/);

  if (process.env.PLAYWRIGHT_BASE_URL) {
    await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
    return;
  }

  await expectSearchPage(page);
});

test("OpenAPI YAML document is served", async ({ page }) => {
  const response = await page.request.get("/api/v0/openapi.yaml");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/yaml");

  const body = await response.text();

  expect(body).toContain("openapi: 3.1.0");
  expect(body).toContain("/api/v0/openapi.yaml:");
});

test("public API supports browser CORS and preflight", async ({ page }) => {
  const origin = "https://developer.example.test";
  const response = await page.request.get("/api/v0/openapi.json", {
    headers: { Origin: origin },
  });

  expect(response.ok()).toBe(true);
  expect(response.headers()["access-control-allow-origin"]).toBe("*");
  expect(response.headers()["access-control-allow-credentials"]).toBeUndefined();
  expect(response.headers()["access-control-expose-headers"]).toContain("RateLimit-Limit");

  const preflight = await page.request.fetch("/api/v0/developer/oauth-apps/example", {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Method": "PATCH",
    },
  });

  expect(preflight.ok()).toBe(true);
  expect(preflight.headers()["access-control-allow-origin"]).toBe("*");
  expect(preflight.headers()["access-control-allow-credentials"]).toBeUndefined();
  expect(preflight.headers()["access-control-allow-methods"]).toContain("PATCH");
  expect(preflight.headers()["access-control-allow-headers"]).toContain("Authorization");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("Cookie");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("X-CSRF-Token");
  expect(preflight.headers()["access-control-allow-headers"]).not.toContain("X-Arbitrary-Client-Header");
  expect(preflight.headers()["access-control-max-age"]).toBe("600");
});

test.describe("hosted lookup smoke", () => {
  test.skip(!isHostedRun, "Hosted-only smoke coverage.");

  test("anonymous public API search succeeds", async ({ page }) => {
    const response = await page.request.get("/api/v0/search?q=basicbit&limit=1");
    const responseText = await response.text();

    expect(response.status(), responseText).toBe(200);

    const body = JSON.parse(responseText) as { results?: unknown };
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("lookup route and suggest endpoint render", async ({ page }) => {
    await page.goto("/lookup");
    await expect(page.getByRole("heading", { name: /DJ link lookup/i })).toBeVisible();
    await expect(page.getByLabel("DJ name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Lookup", exact: true })).toBeVisible();

    const suggestResponse = await page.request.get("/lookup/suggest?q=a");
    expect(suggestResponse.ok()).toBe(true);
    const suggestBody = await suggestResponse.json();
    expect(Array.isArray(suggestBody.results)).toBe(true);
  });
});

test.describe("fixture lookup smoke", () => {
  test.skip(isHostedRun, "Fixture-specific lookup suggestions are local-only.");

  test("event short link redirects to its public event", async ({ page }) => {
    await page.goto("/l/afh2x67");
    await expect(page).toHaveURL(/\/e\/playwright-afterglow-harbor-sessions$/);
    await expectEventPage(page);
  });

  test("lookup suggestions select a public person row", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByLabel("DJ name").fill("b");
    const basicBitOption = page.getByRole("option", { name: /BASICBIT/i });
    await expect(basicBitOption).toHaveCount(1);
    await expect(basicBitOption).not.toContainText("Private seed");
    await basicBitOption.click();
    await expect(page).toHaveURL(/\/lookup\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "VRCDN preview", exact: true })).toBeVisible();
    await expect(page.locator('input[value="basic_bit"]')).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Discord:/ })).toHaveCount(0);
    await expect(page.locator('input[value="https://stream.vrcdn.live/live/basicbit.live.ts"]')).toHaveCount(2);
    await expect(page.locator('input[value="rtspt://stream.vrcdn.live/live/basicbit"]')).toHaveCount(2);
    await expect(page.locator('input[value="https://www.twitch.tv/basic_bit"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Twitch: twitch.tv", exact: true })).toBeVisible();
    await expect(page.getByText("BASIC", { exact: true })).toHaveCount(2);
    const copyButton = page.getByRole("button", { name: "Copy" }).first();
    const copyButtonWidth = await copyButton.evaluate((element) => element.getBoundingClientRect().width);
    await copyButton.click();
    const copiedButton = page.getByRole("button", { name: "Copied" }).first();
    await expect(copiedButton).toBeVisible();
    const copiedButtonWidth = await copiedButton.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(copiedButtonWidth - copyButtonWidth)).toBeLessThan(0.5);
    await expect.poll(async () => await page.evaluate(() => JSON.parse(window.localStorage.getItem("vrdex.lookup.recentSearches") ?? "[]")[0])).toBe("BASICBIT");
    await page.getByRole("button", { name: "Clear lookup" }).click();
    await page.getByLabel("DJ name").focus();
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
  });

  test("lookup suggestions include authorized private seed rows", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByLabel("DJ name").fill("nwinn");

    const privateOption = page.getByRole("option", { name: /DJ Northstar.*Private seed.*NWinn/i });

    await expect(privateOption).toBeVisible();
    await privateOption.click();
    await expect(page).toHaveURL(/\/lookup\?q=DJ%20Northstar$/);
    await expect(page.locator(".lookup-result-card.lookup-private-result").filter({ hasText: "DJ Northstar" })).toBeVisible();
  });

  test("bulk lookup summaries dedupe overlapping public and private rows", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByRole("button", { name: "Bulk" }).click();
    await page.getByLabel("Lineup text").fill("BASICBIT");
    await page.getByRole("button", { name: "Lookup lineup" }).click();

    const summaryRow = page.locator(".lookup-bulk-row").filter({ hasText: "BASICBIT" });

    await expect(summaryRow).toBeVisible();
    await expect(summaryRow.locator(".text-sm")).toHaveText("BASICBIT");
  });
});
