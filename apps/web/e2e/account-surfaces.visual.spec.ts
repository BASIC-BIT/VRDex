import { expect, test } from "@playwright/test";

import {
  cleanupClerkTestAccountData,
  clerkTestAuthAvailability,
  createClerkTestAccount,
  deleteClerkTestAccount,
  signInClerkTestAccount,
  type ClerkTestAccount,
} from "./clerk-auth";
import { captureRouteScreenshot, waitForVisualReady } from "./public-routes";

/**
 * Signed-in screenshot coverage.
 *
 * Every other visual spec renders a public route or a Playwright fixture route,
 * so the account surfaces — the ones that exist *because* somebody is signed in —
 * had no screenshot coverage at all. The Clerk cutover rewrote how all of them
 * obtain identity, and nothing would have shown a regression in how they look.
 *
 * Tagged `@flow` as well as `@visual`, and that is what places it: the PR-time
 * `Playwright Public Preview` lane runs against local servers, and a local Convex
 * deployment pins `clerk-issuer.invalid` in `auth.config.ts` precisely so it
 * trusts no Clerk instance. Sign-in cannot succeed there, so a credentialed spec
 * in that lane would fail rather than skip. `Playwright Hosted Data Flow` already
 * supplies `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_SKIP_WEBSERVERS`, and the staging
 * Clerk keys, which is the only place these can run.
 *
 * `@visual` rather than `@snapshot` for capture: the snapshot lane diffs against
 * PNGs committed under `apps/web/e2e/__screenshots__`, which are Linux-rendered
 * and cannot be regenerated from a Windows checkout, and there is nothing to diff
 * against yet. Promote once a run has produced baselines worth committing.
 */
const clerkTestAuth = clerkTestAuthAvailability();

/** Same resolution the flow specs use: required hosted, defaulted locally. */
function e2eBrowserToken() {
  const token =
    process.env.VRDEX_E2E_BROWSER_TOKEN ??
    (process.env.PLAYWRIGHT_BASE_URL ? undefined : "local-playwright-token");

  if (!token) {
    throw new Error("VRDEX_E2E_BROWSER_TOKEN must be set for hosted Playwright runs.");
  }

  return token;
}

// Named so the reason travels into the report. `clerk-auth.ts` records why that
// matters: the `Playwright Auth Session Matrix` lane reported green for months
// over a spec that ran nothing, because a skipped file still exits 0. A skip
// here should read as "this did not run", never as coverage.
test.skip(
  !clerkTestAuth.available,
  clerkTestAuth.available ? "" : `Skipped, no coverage produced: ${clerkTestAuth.reason}`,
);

// Clerk auth and the E2E helpers are independently switchable, and with the
// helpers off `DELETE /api/e2e/auth` answers 403. `cleanupClerkTestAccountData`
// does not inspect the response, so the teardown would look successful while
// every run left behind a `users` row keyed to a deleted Clerk identity — the
// exact orphaning the production purge existed to clean up. Skipping is the
// honest outcome: without a working teardown these tests should not create
// accounts at all.
const authHelpersEnabled = process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS === "true";

test.skip(
  clerkTestAuth.available && !authHelpersEnabled,
  "Skipped, no coverage produced: VRDEX_ENABLE_E2E_AUTH_HELPERS is not \"true\", so the Convex rows these accounts provision could not be cleaned up.",
);

test.describe("account surfaces @visual @flow", () => {
  let account: ClerkTestAccount | undefined;

  test.beforeEach(async ({ page }, testInfo) => {
    // Matches the hosted flow specs. The default 30s covers this hook *and* the
    // test body, while `signInClerkTestAccount` alone allows a 15s Clerk load
    // followed by a 30s identity assertion — so account creation, navigation,
    // and capture can exhaust the outer budget with every individual step still
    // inside its intended hosted tolerance.
    test.setTimeout(90_000);

    account = await createClerkTestAccount(
      `${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`,
    );
    await signInClerkTestAccount(page, account);
  });

  test.afterEach(async ({ request }) => {
    // Convex rows first, then the Clerk user. Provisioning is on-demand from the
    // client with no webhook, so Convex never learns about a Clerk deletion —
    // deleting only the Clerk account would leave an unreachable `users` row per
    // run accumulating in the shared staging deployment, which is the same
    // orphaning the production purge existed to clean up.
    //
    // Never conditional on the test passing: a failed assertion still leaves a
    // real account behind.
    await cleanupClerkTestAccountData(request, e2eBrowserToken(), account);
    await deleteClerkTestAccount(account);
    account = undefined;
  });

  test("account overview", async ({ page }, testInfo) => {
    await page.goto("/account");
    // Asserted before capturing, so a screenshot of a half-rendered or
    // signed-out page cannot be filed as evidence the surface looks right.
    await expect(page.getByRole("heading", { name: account?.email ?? "" })).toBeVisible();
    await waitForVisualReady(page);
    // Asserted above, masked here. The email is the proof the page is signed in
    // *and* the only thing on it that differs run to run, since the address
    // carries a `Date.now()` suffix. Checking it and then painting over it keeps
    // both properties: the capture still proves identity rendered, and it stops
    // changing when the UI has not.
    await captureRouteScreenshot(page, testInfo, "account-overview-signed-in", {
      mask: [page.getByText(account?.email ?? "", { exact: false })],
    });
  });

  test("account privacy", async ({ page }, testInfo) => {
    await page.goto("/account/privacy");
    // A freshly created account owns no profile, so this panel renders its
    // empty state rather than the field-visibility editor. That is the surface
    // this lane can actually produce, and it is worth capturing: it is a
    // signed-in state, distinct from the signed-out one.
    //
    // Exact names, and specifically not `/privacy/i` — the signed-out heading
    // reads "Sign in to manage privacy", so a loose matcher passes on the page
    // that proves the opposite of what the screenshot claims. The negative
    // assertion is what makes the distinction hold rather than being assumed.
    //
    // ponytail: the populated editor has richer visual surface than this empty
    // state. Capturing it needs the account to own a profile, which is what
    // `auth-claim.flow.spec.ts` builds; fold this in there if the editor's
    // rendering ever needs watching.
    await expect(page.getByRole("heading", { name: "No owned profiles yet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to manage privacy" })).toHaveCount(0);
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "account-privacy-signed-in");
  });

  test("developer tokens", async ({ page }, testInfo) => {
    await page.goto("/developers/tokens");
    // `DeveloperTokensPanel` renders "Sign in required" until its Convex query
    // resolves, so the static page heading alone would let the signed-out notice
    // or a loading frame pass as signed-in evidence. "Personal tokens" only
    // exists once the panel has data. This surface also sat behind the
    // recent-authentication step-up the cutover removed, which is exactly what
    // changed and what nothing was watching.
    await expect(page.getByRole("heading", { name: "Personal tokens" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in required" })).toHaveCount(0);
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "developer-tokens-signed-in");
  });
});
