import { expect, test, type BrowserContextOptions } from "@playwright/test";

type BrowserStorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStorageState(value: unknown): value is BrowserStorageState {
  return isRecord(value) && Array.isArray(value.cookies) && Array.isArray(value.origins);
}

function readStorageState() {
  const encoded = process.env.VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64?.trim();

  if (!encoded) {
    return undefined;
  }

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const parsed: unknown = JSON.parse(decoded);

  if (!isStorageState(parsed)) {
    throw new Error("VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64 must decode to a Playwright storageState JSON object.");
  }

  // Clerk owns the session cookies now. Its session cookie is `__session`, with
  // `__client_uat` alongside it on production instances; the two `__convexAuth`
  // cookies this used to require no longer exist.
  const currentAuthCookies = parsed.cookies.filter(
    (cookie) =>
      (cookie.name === "__session" || cookie.name.startsWith("__clerk")) &&
      typeof cookie.expires === "number" &&
      cookie.expires > Date.now() / 1_000,
  );

  if (currentAuthCookies.length === 0) {
    throw new Error(
      "The production auth smoke state is missing a current Clerk session cookie; export a fresh one-shot state.",
    );
  }

  return parsed;
}

const storageState = readStorageState();

test.describe("production authenticated account smoke @production-auth-one-shot", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Production auth smoke is hosted-only.");
  test.skip(
    process.env.VRDEX_PRODUCTION_AUTH_SMOKE_MODE !== "manual-one-shot",
    "Production authenticated smoke is restricted to an explicit manual one-shot run.",
  );
  test.skip(!storageState, "Configure VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64 to enable production auth smoke.");
  test.use(storageState ? { storageState } : {});

  test("OAuth-backed account session renders account readiness", async ({ page }) => {
    let response;
    try {
      response = await page.goto("/account");
    } catch {
      throw new Error("VRDEX_AUTH_SMOKE_TRANSPORT_FAILURE");
    }
    if (response && response.status() >= 500) {
      throw new Error("VRDEX_AUTH_SMOKE_SERVER_FAILURE");
    }
    await expect(page.getByRole("heading", { name: "Not signed in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByText("Sign-in and security", { exact: true })).toBeVisible();

    // Linked providers are no longer rendered here. Clerk owns that list and
    // shows it only after `openUserProfile()` opens its modal, so asserting a
    // standalone "Discord" or "Google" label would time out on a healthy
    // account. What this smoke can still prove without driving a vendor modal is
    // that an authenticated account reaches its own account page with the
    // management affordance present.
    await expect(
      page.getByRole("button", { name: "Manage sign-in methods" }),
    ).toBeVisible();
  });
});
