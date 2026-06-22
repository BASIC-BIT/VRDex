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

  return parsed;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const storageState = readStorageState();
const expectedProvider = process.env.VRDEX_PRODUCTION_AUTH_SMOKE_PROVIDER?.trim().toLowerCase();

test.describe("production authenticated account smoke @production-auth", () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Production auth smoke is hosted-only.");
  test.skip(!storageState, "Configure VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64 to enable production auth smoke.");
  test.use(storageState ? { storageState } : {});

  test("OAuth-backed account session renders account readiness", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Not signed in" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByText("Linked providers", { exact: true })).toBeVisible();
    await expect(page.getByText("No providers linked yet", { exact: true })).toHaveCount(0);

    if (expectedProvider) {
      await expect(page.getByText(new RegExp(`^${escapeRegExp(expectedProvider)}$`, "i"))).toBeVisible();
      return;
    }

    await expect(page.getByText(/^(discord|google)$/i).first()).toBeVisible();
  });
});
