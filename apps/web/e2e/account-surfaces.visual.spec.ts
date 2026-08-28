import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  cleanupClerkTestAccountData,
  clerkTestAuthAvailability,
  createClerkTestAccount,
  deleteClerkTestAccount,
  deleteClerkTestAccountByEmail,
  hostedTargetRunsCurrentRevision,
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

/**
 * Every assertion below waits on a Convex-backed render, and `test.setTimeout`
 * does not change `expect` timeouts — the config sets no `expect.timeout`, so
 * they default to 5s. `signInClerkTestAccount` allows 30s for the same hosted
 * identity seam, which is the tolerance these should share; a 5s budget makes
 * the strengthened signed-in assertions the flakiest part of the suite.
 */
const hostedExpectOptions = { timeout: process.env.PLAYWRIGHT_BASE_URL ? 30_000 : 10_000 };

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

/**
 * Cleanup passes before the teardown gives up and keeps the Clerk identity.
 *
 * Three, not two: two proves only that one extra round trip found nothing, and a
 * single late `ensureCurrentUser` would then be caught by the second pass with no
 * pass left to confirm it. Three is one confirmation beyond one caught racer,
 * which is as far as a bounded loop is worth taking — past that, provisioning
 * outrunning teardown is a real defect and should fail rather than be absorbed.
 */
const CLEANUP_DRAIN_PASSES = 3;

/**
 * Everything on a signed-in capture that varies between identical runs.
 *
 * Both entries trace to the same fact: the account email carries a
 * `${workerIndex}-${repeatEachIndex}-${Date.now()}` prefix, so it differs on
 * every run *and* between parallel workers and retries of the same run.
 *
 * The second one is not obvious. `NavUtilities` builds its avatar label as
 * `viewer?.user.name ?? viewer?.user.email ?? "Account"`, and a fresh Clerk
 * account has no name — so with no profile image `EntityImage` renders the first
 * character of that email. On worker 0 the nav shows "0"; on worker 2 it shows
 * "2", with the page otherwise identical. Masking the email text does not cover
 * it, because it is a different element deriving from the same value.
 */
function unstableSignedInRegions(page: Page, email: string | undefined) {
  return [
    page.getByText(email ?? "", { exact: false }),
    page.getByRole("link", { name: "Account" }),
  ];
}

async function skipUntilHostedTargetRunsCurrentRevision(request: APIRequestContext) {
  test.skip(
    !(await hostedTargetRunsCurrentRevision(request)),
    "Shared staging does not carry this feature-branch route yet; post-merge staging covers it.",
  );
}

test.skip(
  clerkTestAuth.available && !authHelpersEnabled,
  "Skipped, no coverage produced: VRDEX_ENABLE_E2E_AUTH_HELPERS is not \"true\", so the Convex rows these accounts provision could not be cleaned up.",
);

// `@account-visual` so the hosted lane can own this suite separately. Its two
// projects matter here: the account surfaces have a distinct mobile layout, and
// `test:e2e:hosted` pins `--project=desktop-chromium`, so left in that lane the
// mobile instances would exist only in the local `@visual` run — where the
// availability gate skips them and no mobile capture would ever be produced.
test.describe("account surfaces @visual @flow @account-visual", () => {
  let account: ClerkTestAccount | undefined;

  // Set before the creation request, so it survives the case `account` cannot:
  // Clerk committing the POST and the response never arriving. `account` stays
  // undefined there while a real user exists, and this is the only handle on it.
  let reservedEmail: string | undefined;

  let authenticated = false;

  test.beforeEach(async ({ page }, testInfo) => {
    // Resolved before an account exists, because it throws on a hosted run with
    // no `VRDEX_E2E_BROWSER_TOKEN`. Called only from the teardown, that throw
    // landed *after* a real Clerk account had been created and before either
    // cleanup ran, so every attempt leaked a pair. Failing here costs nothing.
    e2eBrowserToken();

    // Same normalization every other `@visual` spec applies, minus the clock.
    // These pages render timestamps, so the freeze is exactly what they want —
    // but Clerk decides token freshness from `Date.now()`, and a page reporting
    // 2025 while holding a token minted today is reasoning about refresh against
    // a clock nearly two years out while Convex validates `exp` against the real
    // one. Live timestamps are the reason these are `@visual` and not yet
    // `@snapshot`; see the file header.
    await prepareVisualPage(page, { freezeClock: false });

    authenticated = false;
    reservedEmail = undefined;

    // Matches the hosted flow specs. The default 30s covers this hook *and* the
    // test body, while `signInClerkTestAccount` alone allows a 15s Clerk load
    // followed by a 30s identity assertion — so account creation, navigation,
    // and capture can exhaust the outer budget with every individual step still
    // inside its intended hosted tolerance.
    test.setTimeout(90_000);

    account = await createClerkTestAccount(
      `${testInfo.workerIndex}-${testInfo.repeatEachIndex}-${Date.now()}`,
      {
        onEmailReserved: (email) => {
          reservedEmail = email;
        },
      },
    );
    await signInClerkTestAccount(page, account, {
      onAuthenticated: () => {
        authenticated = true;
      },
    });
  });

  test.afterEach(async ({ page, request }) => {
    // Closed before anything is deleted, because the page is still signed in and
    // still subscribed. `ProvisionedChildren` in `src/app/ConvexClientProvider.tsx`
    // watches `accounts.viewer` and calls `ensureCurrentUser` whenever that row is
    // absent, so deleting the row under a live page makes the page put it straight
    // back — keyed to a Clerk identity that is about to be deleted, which is the
    // unreachable row this teardown exists to prevent.
    //
    // The failure screenshot survives: Playwright captures it in
    // `didFinishTestFunction`, which the worker runs *before* the `afterEach`
    // hooks. So does the retry trace. What does not is the aria snapshot in
    // `error-context.md`, taken during fixture teardown from `context.pages()[0]`
    // — a closed page means it is skipped. Accepted: for a visual spec the PNG is
    // the evidence, and every alternative here is worse. Signing out instead
    // would keep the page but flips `isAuthenticated` asynchronously, so the
    // subscription outlives the call by an unbounded amount; navigating to
    // `about:blank` would snapshot `about:blank`.
    await page.close();

    // Convex rows first, then the Clerk user. Provisioning is on-demand from the
    // client with no webhook, so Convex never learns about a Clerk deletion —
    // deleting only the Clerk account would leave an unreachable `users` row per
    // run accumulating in the shared staging deployment, which is the same
    // orphaning the production purge existed to clean up.
    //
    // Never conditional on the test passing: a failed assertion still leaves a
    // real account behind.
    //
    // Repeated until a pass finds nothing, because one pass cannot prove the row
    // stayed gone. Closing the page stops the client issuing *new* work, but a
    // mutation Convex has already accepted is not cancellable from here, and
    // `ProvisionedChildren` issues one per navigation rather than only when the
    // row is missing: `syncedIdentity` is a ref, so every `page.goto` remounts
    // the component and resets it to `null`, which fails the
    // `identitySignature === syncedIdentity.current` guard and re-fires
    // `ensureCurrentUser`. Nothing in the test body awaits that mutation, so each
    // test ends with one plausibly still in flight.
    //
    // Deleting the Clerk identity does not settle it either — Convex validates
    // the token's signature and issuer, not whether the user still exists, so an
    // accepted mutation succeeds after the identity is gone.
    //
    // So the loop drains instead: a pass that deletes something means a mutation
    // landed after the previous one, and only a pass that finds nothing ends it.
    // That bounds the hole at "still unresolved after a full extra round trip to
    // the same deployment" rather than closing it, which no client-side action
    // can do. Still deleting at the cap is a failure, not a shrug — something is
    // actively recreating the row and the Clerk identity must be kept.
    // Falls back to the reserved email when creation never returned an id.
    // `createClerkTestAccount` throws if the response is lost, but Clerk may have
    // committed the user anyway — so without this the teardown has nothing to
    // work with and every retry strands another disposable account. The email is
    // all the Convex route resolves by, and `deleteClerkTestAccountByEmail`
    // covers the Clerk side by lookup.
    const created = account;
    const target = created ?? (reservedEmail ? { email: reservedEmail } : undefined);

    account = undefined;
    reservedEmail = undefined;

    let lastCleanup: Awaited<ReturnType<typeof cleanupClerkTestAccountData>>;
    let cleaned = false;
    let drained = false;

    for (let pass = 0; pass < CLEANUP_DRAIN_PASSES; pass += 1) {
      lastCleanup = await cleanupClerkTestAccountData(request, e2eBrowserToken(), target);

      // The gate above checks the *runner's* `VRDEX_ENABLE_E2E_AUTH_HELPERS`, a
      // different variable on a different machine from the four the route requires
      // (`VRDEX_ENABLE_E2E_HELPERS`, `VRDEX_ENABLE_E2E_AUTH_HELPERS`,
      // `VRDEX_E2E_BROWSER_TOKEN`, `VRDEX_E2E_CONVEX_SECRET`). It can answer 403 or
      // 400 with the runner flag set, and `request.delete` resolves either way, so
      // the gate alone cannot tell a completed cleanup from a rejected one.
      // `ok()` is not the same claim as "the row is gone".
      const body =
        lastCleanup !== undefined && lastCleanup.ok()
          ? ((await lastCleanup.json()) as { deleted?: boolean })
          : undefined;

      if (body?.deleted === true) {
        cleaned = true;
        continue;
      }

      // 200 with `{ deleted: false }` means no row is there. On the first pass
      // that is a failure — sign-in got far enough to make an account, so a row
      // should exist — and on a later pass it is the drain completing. `cleaned`
      // is what tells them apart. Anything else (a 403 from the route's own gate,
      // a 400, a transport error) leaves both false and fails below.
      drained = body?.deleted === false;
      break;
    }

    // The Clerk identity is deleted only once the Convex row is confirmed gone
    // and confirmed to have stayed gone, and that ordering is the whole point.
    // Deleting it first makes a failed cleanup permanent: the row survives keyed
    // to an identity that no longer exists, so the thing you would use to find
    // and re-clean it is what was just removed.
    //
    // Keeping both on failure looks like a leak and is the opposite — a
    // recoverable pair, visible in the Clerk dashboard, re-cleanable through the
    // ordinary path. The test still fails loudly below.
    //
    // Unless the account was never signed in. `signInClerkTestAccount` can fail
    // before `clerk.signIn()` — `requireClerkOnTarget` is a 15s network wait
    // against the target — and then no token ever existed, so no
    // `ensureCurrentUser` could have run and there is no row to protect. Requiring
    // `cleaned` there kept the Clerk user on every attempt, which is a plain leak
    // rather than a recoverable pair: absence is confirmed, not raced.
    const rowSettled = authenticated ? cleaned && drained : drained;

    // Two deletion paths, because a lost creation response leaves no user id.
    // With one, delete by id — cheapest and exact. Without one, look the email up
    // and delete whatever Clerk actually holds for it, which is the only way to
    // reach a user this run created but never learned the id of.
    const clerkDeletion =
      rowSettled && created !== undefined ? await deleteClerkTestAccount(created) : undefined;
    const clerkRecovery =
      rowSettled && created === undefined && target !== undefined
        ? await deleteClerkTestAccountByEmail(target.email)
        : undefined;

    const email = target?.email;

    // No response is not success. `deleteClerkTestAccount` never throws — it runs
    // from `finally` blocks elsewhere — so a DNS failure, reset connection, or
    // timeout comes back as `undefined`, indistinguishable from a 200 to anything
    // that only checks the response it did get. This branch runs only once
    // `cleaned` is true, so the request was definitely attempted.
    //
    // 404 is success: the user being absent is the state this is trying to reach.
    //
    // On the recovery path it takes both fields. `checked` alone only says the
    // lookup ran — a user it found and could not delete (429, 5xx) still leaves a
    // disposable account in the tenant, so `failed` has to be zero as well.
    // `deleted: 0` with `checked` and no failures is the ordinary answer when the
    // creation request never landed, and is not a failure.
    const clerkDeleted =
      created !== undefined
        ? clerkDeletion !== undefined && (clerkDeletion.ok || clerkDeletion.status === 404)
        : clerkRecovery?.checked === true && clerkRecovery.failed === 0;

    // `!cleaned` is only a failure when the account reached an authenticated
    // page, since that is the only case where a row should exist. A sign-in that
    // failed earlier legitimately leaves nothing to delete, and the Clerk user
    // has already been removed above.
    const failure = !drained
      ? `Convex cleanup for ${email} never reached a clean pass in ${CLEANUP_DRAIN_PASSES} attempts (HTTP ${lastCleanup?.status()}). The Clerk user was kept so the pair can still be cleaned up by hand.`
      : authenticated && !cleaned
        ? `Convex cleanup did not delete a row for ${email} (HTTP ${lastCleanup?.status()}) even though sign-in completed. The Clerk user was kept rather than orphaning a row that may still land.`
        : !clerkDeleted
          ? `Clerk did not confirm deletion of ${email} (${
              created === undefined
                ? clerkRecovery?.checked === true
                  ? `creation returned no id; the recovery lookup found ${clerkRecovery.failed} user(s) it could not delete`
                  : "creation returned no id and the recovery lookup did not complete"
                : clerkDeletion
                  ? `HTTP ${clerkDeletion.status}`
                  : "no response"
            }). A disposable user is left in the staging tenant.`
          : undefined;

    expect(failure, failure ?? "").toBeUndefined();
  });

  test("account overview", async ({ page }, testInfo) => {
    await page.goto("/account");
    // Asserted before capturing, so a screenshot of a half-rendered or
    // signed-out page cannot be filed as evidence the surface looks right.
    await expect(page.getByRole("heading", { name: account?.email ?? "" })).toBeVisible(
      hostedExpectOptions,
    );
    await waitForVisualReady(page);
    // Asserted above, masked here. The email is the proof the page is signed in,
    // and it is also the thing that differs run to run. Checking it and then
    // painting over it keeps both properties: the capture still proves identity
    // rendered, and it stops changing when the UI has not.
    await captureRouteScreenshot(page, testInfo, "account-overview-signed-in", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });

  test("account privacy", async ({ page, request }, testInfo) => {
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
    // Tolerated only while the target is behind this commit. This lane runs
    // against staging, which serves the previous release for as long as a branch
    // is in review, so a change to this empty state cannot be green on the PR
    // that makes it — the fix and the assertion land together and staging has
    // neither yet. The gate closes the moment staging carries the commit, which
    // is the post-merge health run, so the lagging shape is never accepted twice.
    const emptyState = page.getByRole("heading", { name: "No owned profiles yet" });

    await expect(
      (await hostedTargetRunsCurrentRevision(request))
        ? emptyState
        : emptyState.or(page.getByText("You do not manage any profiles yet.")),
    ).toBeVisible(hostedExpectOptions);
    await expect(page.getByRole("heading", { name: "Sign in to manage privacy" })).toHaveCount(
      0,
      hostedExpectOptions,
    );
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "account-privacy-signed-in", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });

  test("managed events", async ({ page, request }, testInfo) => {
    await skipUntilHostedTargetRunsCurrentRevision(request);
    await page.goto("/account/events");
    await expect(page.getByRole("heading", { name: "Events" })).toBeVisible(hostedExpectOptions);
    await expect(page.getByText("No events")).toBeVisible(hostedExpectOptions);
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "managed-events-empty", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });

  test("media contributions", async ({ page, request }, testInfo) => {
    await skipUntilHostedTargetRunsCurrentRevision(request);
    await page.goto("/account/media-contributions");
    await expect(page.getByRole("heading", { name: "Media contributions" })).toBeVisible(
      hostedExpectOptions,
    );
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "media-contributions-empty", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });

  test("media review access", async ({ page, request }, testInfo) => {
    await skipUntilHostedTargetRunsCurrentRevision(request);
    await page.goto("/account/media-review");
    await expect(page.getByRole("heading", { name: "Media review" })).toBeVisible(
      hostedExpectOptions,
    );
    await expect(page.getByText("Profile media review access is required.")).toBeVisible(
      hostedExpectOptions,
    );
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "media-review-no-access", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });

  test("developer tokens", async ({ page }, testInfo) => {
    await page.goto("/developers/tokens");
    // `DeveloperTokensPanel` renders "Sign in required" until its Convex query
    // resolves, so the static page heading alone would let the signed-out notice
    // or a loading frame pass as signed-in evidence. "Personal tokens" only
    // exists once the panel has data. This surface also sat behind the
    // recent-authentication step-up the cutover removed, which is exactly what
    // changed and what nothing was watching.
    await expect(page.getByRole("heading", { name: "Personal tokens" })).toBeVisible(
      hostedExpectOptions,
    );
    await expect(page.getByRole("heading", { name: "Sign in required" })).toHaveCount(
      0,
      hostedExpectOptions,
    );
    await waitForVisualReady(page);
    await captureRouteScreenshot(page, testInfo, "developer-tokens-signed-in", {
      mask: unstableSignedInRegions(page, account?.email),
    });
  });
});
