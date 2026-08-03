import { expect, test } from "@playwright/test";

import {
  clerkTestAuthAvailability,
  createClerkTestAccount,
  deleteClerkTestAccount,
  signInClerkTestAccount,
  type ClerkTestAccount,
} from "./clerk-auth";
import { gotoFlowPage } from "./flow-navigation";

/**
 * The staging auth-session contract (#226).
 *
 * What this replaced tested Convex Auth's own machinery — refresh-token
 * rotation, `__convexAuth` cookies, and hand-seeded `absolute_expired` /
 * `invalid_refresh` / `revoked` session rows. None of that exists any more:
 * Clerk is the session authority, and `_browserSessionAuthority.ts` records
 * that the `revoked` state collapsed into plain `anonymous`. Re-testing Clerk's
 * own cookie handling would be testing a vendor.
 *
 * What is still ours, and is what this file covers, is the *seam*: whether a
 * Clerk session actually produces a Convex identity on this deployment. That
 * breaks for reasons no unit test can see — a `convex` JWT template missing
 * `aud: "convex"` or `email_verified`, or `CLERK_JWT_ISSUER_DOMAIN` naming a
 * different instance than the publishable key does. Each of those is
 * environment-specific, survives a green build, and surfaces as what looks like
 * a claim bug.
 *
 * Runs after each staging deploy through `pnpm test:e2e:hosted:auth-session`.
 */

const clerkTestAuth = clerkTestAuthAvailability();

test.describe.configure({ mode: "serial" });

const hostedExpectOptions = { timeout: process.env.PLAYWRIGHT_BASE_URL ? 30_000 : 10_000 };

function e2eBrowserToken() {
  const token = process.env.VRDEX_E2E_BROWSER_TOKEN ?? (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error("VRDEX_E2E_BROWSER_TOKEN must be set for hosted auth-session runs.");
  }

  return token;
}

function sessionRunSuffix(testInfo: { workerIndex: number; repeatEachIndex: number }) {
  const prefix = process.env.VRDEX_E2E_RUN_ID ?? "auth-session";

  return `${prefix}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`;
}

test("a Clerk session resolves to a verified Convex identity and clears on sign-out @auth-session-staging", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  test.skip(clerkTestAuth.available === false, clerkTestAuth.available === false ? clerkTestAuth.reason : "");
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL) && process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true",
    "Hosted auth E2E helpers are not enabled for this target.",
  );

  const e2eToken = e2eBrowserToken();
  const context = await browser.newContext();
  const page = await context.newPage();
  let account: ClerkTestAccount | undefined;

  try {
    account = await createClerkTestAccount(sessionRunSuffix(testInfo));

    // Asserts the identity end to end: the heading comes from the Convex `users`
    // row `ensureCurrentUser` provisioned out of the token, and "Verified" comes
    // from the `email_verified` claim inside it. A template missing either fails
    // here rather than three screens into a claim.
    await signInClerkTestAccount(page, account);

    // Survives a reload, so the Convex token is re-minted from the Clerk session
    // rather than held in page memory.
    await page.reload();
    await expect(page.getByRole("heading", { name: account.email })).toBeVisible(hostedExpectOptions);

    // ...and is shared with a sibling tab in the same context.
    const siblingPage = await context.newPage();
    await gotoFlowPage(siblingPage, "/account");
    await expect(siblingPage.getByRole("heading", { name: account.email })).toBeVisible(hostedExpectOptions);

    // Driven through the account UI rather than `clerk.signOut`. Calling Clerk
    // directly would keep passing if `SignOutControl` stopped invoking it, or if
    // its `signOut({ redirectUrl: "/sign-in" })` wiring regressed — and the
    // deleted session spec was the only other place that clicked the real
    // control. `account-sign-out.spec.ts` covers the dialog against a fixture
    // callback, so this is the one place the button meets real Clerk.
    await page.getByRole("button", { name: "Sign out" }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog.getByRole("heading", { name: "Sign out?" })).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Sign out", exact: true }).click();

    // The control's own redirect, not a navigation this test performed.
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/, hostedExpectOptions);

    // The sibling tab shared the session, so it must lose it too — a sign-out
    // that only clears the tab that performed it is not a sign-out.
    await gotoFlowPage(siblingPage, "/account");
    await expect(siblingPage).toHaveURL(/\/sign-in\?returnTo=/, hostedExpectOptions);
    await siblingPage.close();

    await gotoFlowPage(page, "/account");
    await expect(page).toHaveURL(/\/sign-in\?returnTo=/, hostedExpectOptions);
  } finally {
    if (account !== undefined) {
      await request.delete("/api/e2e/auth", {
        headers: { "x-vrdex-e2e-token": e2eToken },
        data: { email: account.email },
      });
      await deleteClerkTestAccount(account);
    }

    await context.close();
  }
});

/**
 * Needs no account, so it is the one assertion here that still runs when Clerk
 * is unconfigured — including on a deployment with no keys at all, where
 * `middleware.ts` deliberately keeps protected routes closed rather than
 * opening them because it cannot evaluate a session.
 */
test("a signed-out browser is sent to sign-in with its return path @auth-session-staging", async ({ page }) => {
  await gotoFlowPage(page, "/account");

  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Faccount/, hostedExpectOptions);
});
