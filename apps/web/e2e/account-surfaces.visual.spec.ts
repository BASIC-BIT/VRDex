import { expect, test } from "@playwright/test";

import {
  clerkTestAuthAvailability,
  createClerkTestAccount,
  deleteClerkTestAccount,
  signInClerkTestAccount,
  type ClerkTestAccount,
} from "./clerk-auth";
import { captureRouteScreenshot, prepareVisualPage, waitForVisualReady } from "./public-routes";

/**
 * Signed-in screenshot coverage.
 *
 * Every other visual spec renders a public route or a Playwright fixture route,
 * so the account surfaces — the ones that exist *because* somebody is signed in —
 * had no screenshot coverage at all. The Clerk cutover rewrote how all of them
 * obtain identity, and nothing would have shown a regression in how they look.
 *
 * `@visual` rather than `@snapshot` on purpose. The snapshot lane diffs against
 * PNGs committed under `apps/web/e2e/__screenshots__`, which are Linux-rendered
 * and cannot be regenerated from a Windows checkout; a new snapshot spec would
 * therefore land red and stay red until someone pulled baselines off a runner.
 * The visual lane uploads its captures as artifacts for review instead, which is
 * the useful half here — these pages are new to screenshot coverage, so there is
 * nothing to diff *against* yet. Promote them to `@snapshot` once a run has
 * produced baselines worth committing.
 */
const clerkTestAuth = clerkTestAuthAvailability();

// Named so the reason travels into the report. `clerk-auth.ts` records why that
// matters: the `Playwright Auth Session Matrix` lane reported green for months
// over a spec that ran nothing, because a skipped file still exits 0. A skip
// here should read as "this did not run", never as coverage.
test.skip(
  !clerkTestAuth.available,
  clerkTestAuth.available ? "" : `Skipped, no coverage produced: ${clerkTestAuth.reason}`,
);

test.describe("account surfaces @visual", () => {
  let account: ClerkTestAccount | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    await prepareVisualPage(page);
    account = await createClerkTestAccount(
      `${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`,
    );
    await signInClerkTestAccount(page, account);
  });

  test.afterEach(async () => {
    // Never conditional on the test passing: a failed assertion still leaves a
    // real Clerk user behind on the shared development instance.
    await deleteClerkTestAccount(account);
    account = undefined;
  });

  test("account overview", async ({ page }, testInfo) => {
    await page.goto("/account");
    // Asserted before capturing, so a screenshot of a half-rendered or
    // signed-out page cannot be filed as evidence the surface looks right.
    await expect(page.getByRole("heading", { name: account?.email ?? "" })).toBeVisible();
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "account-overview-signed-in");
  });

  test("account security", async ({ page }, testInfo) => {
    await page.goto("/account/security");
    // Clerk owns the session list now. The heading is VRDex's, which is what
    // makes it a stable thing to assert on across upstream component changes.
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "account-security-signed-in");
  });

  test("developer tokens", async ({ page }, testInfo) => {
    await page.goto("/developers/tokens");
    // This surface used to sit behind the recent-authentication step-up that the
    // cutover removed, so how it renders for an ordinary signed-in account is
    // exactly what changed and what nothing was watching.
    await expect(page.getByRole("heading", { name: /tokens/i })).toBeVisible();
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "developer-tokens-signed-in");
  });
});
