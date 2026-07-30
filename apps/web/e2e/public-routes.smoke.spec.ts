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

test("sign-in offers a route to create an account", async ({ page }) => {
  await page.goto("/sign-in");

  // The credential fields and the progressive-disclosure button belonged to the
  // removed VRDex form; Clerk's identifier-first UI owns them now and asserting
  // its markup would break on any upstream change. What is still VRDex's, and
  // still worth guarding, is that a visitor can reach account creation — the
  // action Clerk routes to `/sign-up`, which needs its own catch-all route to
  // exist rather than 404.
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();

  await page.goto("/sign-up");
  await expect(
    page.getByRole("heading", { name: "Create account", exact: true }),
  ).toBeVisible();
});

test("legacy discovery query redirects to search", async ({ page }) => {
  await page.goto("/discover?q=aurora");
  await expect(page).toHaveURL(/\/search\?q=aurora$/);

  if (process.env.PLAYWRIGHT_BASE_URL) {
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Results for aurora/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Search VRDex/i })).toBeVisible();
    return;
  }

  await expectSearchPage(page);
});

test("private profile claim actions stay on owner-aware routes", async ({ page }) => {
  test.skip(isHostedRun, "The Playwright-only claim fixture is not enabled on hosted targets.");

  await page.goto("/playwright/claim?private=1");

  await expect(page.getByRole("link", { name: "Back to account" })).toHaveAttribute("href", "/account");
  await expect(page.getByRole("link", { name: "Manage profile" })).toHaveAttribute(
    "href",
    "/account/appearance?profileId=playwright-profile",
  );
  await expect(page.getByRole("link", { name: "View profile" })).toHaveCount(0);
  await expect(page.getByText("vrdex.net/p/basicbit")).toHaveCount(0);

  await page.getByRole("link", { name: "Manage profile" }).click();
  await expect(page).toHaveURL(/\/account\/appearance\?profileId=playwright-profile$/);
  await expect(page.getByRole("link", { name: "View profile" })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page).toHaveURL(/\/search\?view=dj$/);
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

  test("profile claim actions stay separate and keyboard focusable", async ({ page }) => {
    await page.goto("/c/playwright-afterglow-social");

    const communityCard = page.getByRole("region", { name: "Afterglow Social" });
    const communityClaim = page
      .getByRole("complementary", { name: "Profile ownership" })
      .getByRole("link", { name: "Claim profile" });

    await expect(communityCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
    await communityClaim.focus();
    await expect(communityClaim).toBeFocused();

    await page.goto("/p/playwright-dj-aurora");

    const personCard = page.getByRole("region", { name: "DJ Aurora" });
    const personClaim = page
      .getByRole("complementary", { name: "Profile ownership" })
      .getByRole("link", { name: "Claim profile" });

    await expect(personCard.getByRole("link", { name: "Claim profile" })).toHaveCount(0);
    await personClaim.focus();
    await expect(personClaim).toBeFocused();

    await page.goto("/p/basicbit");
    await expect(page.getByRole("complementary", { name: "Profile ownership" })).toHaveCount(0);
  });

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
    await page.getByLabel("DJ name").press("ArrowDown");
    await expect(page.getByRole("option", { selected: true })).toHaveClass(/bg-surface-strong/);
    await basicBitOption.click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
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

  test("lookup hides stale suggestions as soon as the visible query changes", async ({ page }) => {
    await page.goto("/search?view=dj");
    const lookupInput = page.getByLabel("DJ name");

    await lookupInput.fill("b");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await lookupInput.fill("unrelated query");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveCount(0);
  });

  test("standard search hides stale suggestions as soon as the visible query changes", async ({ page }) => {
    await page.goto("/search");
    const searchInput = page.getByRole("combobox", { name: /Search/i });

    await searchInput.fill("basic");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await searchInput.fill("unrelated query");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveCount(0);
  });

  test("standard search keeps typeahead and submission within the active entity filter", async ({ page }) => {
    await page.goto("/search?q=BASICBIT&type=person");
    const searchInput = page.getByRole("combobox", { name: /Search/i });
    const suggestionResponse = page.waitForResponse((response) =>
      response.url().includes("/search/suggest?q=Afterglow&type=person"),
    );

    await searchInput.fill("Afterglow");
    await suggestionResponse;
    await expect(page.getByRole("option", { name: /Afterglow Harbor Sessions/i })).toHaveCount(0);
    await expect(page.getByRole("option", { name: /Afterglow Social/i })).toHaveCount(0);

    await searchInput.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=Afterglow&type=person$/);
    await expect(page.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  });

  test("unified search preserves BASICBIT identity across standard and DJ views", async ({ page }) => {
    await page.goto("/search?q=BASICBIT");

    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
    const standardResults = page.getByRole("region", { name: "Search results" });
    await expect(standardResults.getByRole("link", { name: /BASICBIT/ })).toHaveCount(1);
    await expect(standardResults.getByText("BASICBIT", { exact: true })).toBeVisible();
    await expect(standardResults.getByText("Software Dev | 3D Designer | VRDJ")).toBeVisible();
    await expect(standardResults.getByRole("img", { name: "BASICBIT" })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Search results" }).getByText("BASICBIT", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "DJ links" }).click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("heading", { name: "Search VRDex" })).toBeVisible();
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Website: basicbit.net", exact: true })).toBeVisible();
    const djAvatar = page.locator(".lookup-avatar img").first();
    await expect(djAvatar).toBeVisible();
    await expect(djAvatar).toHaveAttribute("src", /basicbit-avatar\.png/);

    await page.reload();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "BASICBIT", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "All VRDex" }).click();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");

    await page.goForward();
    await expect(page).toHaveURL(/\/search\?q=BASICBIT$/);
    await expect(page.getByRole("link", { name: "All VRDex" })).toHaveAttribute("aria-current", "page");
  });

  test("search views share empty states and legacy lookup preserves its query", async ({ page }) => {
    await page.goto("/lookup?q=No%20Matching%20Fixture");
    await expect(page).toHaveURL(/\/search\?q=No(?:%20|\+)Matching(?:%20|\+)Fixture&view=dj$/);
    await expect(page.getByText("No matches found.", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "All VRDex" }).click();
    await expect(page).toHaveURL(/\/search\?q=No(?:%20|\+)Matching(?:%20|\+)Fixture$/);
    await expect(page.getByText("No public results matched that search yet.", { exact: true })).toBeVisible();

    await page.goto("/search?q=BASICBIT&view=dj&type=world");
    await expect(page).toHaveURL(/\/search\?q=BASICBIT&view=dj$/);
    await expect(page.getByRole("link", { name: "DJ links" })).toHaveAttribute("aria-current", "page");
  });

  test("standard search supports keyboard typeahead and sparse profile fallbacks", async ({ page }) => {
    await page.goto("/search");
    const searchInput = page.getByRole("combobox", { name: /Search/i });

    await searchInput.fill("basic");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toBeVisible();
    await searchInput.press("ArrowDown");
    await expect(page.getByRole("option", { name: /BASICBIT/i })).toHaveClass(/bg-surface-strong/);
    await searchInput.press("Enter");
    await expect(page).toHaveURL(/\/p\/basicbit$/);

    await page.goto("/search?q=Sparse%20Import");
    const sparseResult = page.getByRole("region", { name: "Search results" });
    await expect(sparseResult.getByText("Sparse Import", { exact: true })).toBeVisible();
    await expect(sparseResult.getByRole("img", { name: "Sparse Import" })).toHaveCount(0);
    await expect(sparseResult.getByRole("link", { name: "Claim this profile" })).toHaveAttribute(
      "href",
      "/claim/playwright-sparse-import?source=search",
    );
    await expect(sparseResult.getByText("Imported profile seed", { exact: true })).toBeVisible();

    await page.goto("/search?q=Sparse%20Import&view=dj");
    await expect(page.getByRole("link", { name: "Sparse Import", exact: true })).toBeVisible();
    await expect(page.getByText("Imported profile seed / Unclaimed", { exact: true }).first()).toBeVisible();

    await page.goto("/search?q=DJ%20Aurora&view=dj");
    await expect(page.getByText("Community submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Community submitted / Community submitted", { exact: true })).toHaveCount(0);
  });

  test("lookup suggestions include authorized private seed rows", async ({ page }) => {
    await page.goto("/lookup");
    await page.getByLabel("DJ name").fill("nwinn");

    const privateOption = page.getByRole("option", { name: /DJ Northstar.*Private seed.*NWinn/i });

    await expect(privateOption).toBeVisible();
    await privateOption.click();
    await expect(page).toHaveURL(/\/search\?q=DJ%20Northstar&view=dj$/);
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
