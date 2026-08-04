import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoFlowPage } from "./flow-navigation";

/**
 * Clerk-backed account fixture for the auth E2E specs (#226).
 *
 * The specs these replaced signed in by driving an email/password form and
 * minted accounts through `/api/e2e/auth`. Clerk owns both jobs now: accounts
 * come from the Backend API, and sign-in uses a testing token plus a one-time
 * sign-in ticket, so no form is driven and no email is ever delivered.
 *
 * ## Where this can run
 *
 * Hosted targets only. `convex/auth.config.ts` deliberately pins local
 * deployments to the unresolvable issuer `https://clerk-issuer.invalid`, so a
 * local backend rejects every Clerk token by design and no amount of test
 * wiring changes that. Local `@flow` runs therefore skip the auth specs rather
 * than fail them, and the hosted lane fails closed instead — see
 * `clerkTestAuthAvailability`.
 *
 * ## Prerequisite that is not in this repository
 *
 * `clerkSetup()` refuses a production secret key outright. The staging target
 * must be backed by a Clerk *development* instance, with the `convex` JWT
 * template installed on it — see `docs/backend/auth-sessions.md`. Pointing this
 * at the production instance fails at setup with a key-type error, not with
 * something that looks like a test bug.
 */

const CLERK_API_BASE = process.env.CLERK_API_URL?.trim().replace(/\/+$/, "") || "https://api.clerk.com";

const hostedExpectOptions = { timeout: process.env.PLAYWRIGHT_BASE_URL ? 30_000 : 10_000 };

export type ClerkTestAccount = {
  clerkUserId: string;
  email: string;
};

function secretKey() {
  return process.env.CLERK_SECRET_KEY?.trim() ?? "";
}

function publishableKey() {
  return (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ??
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ??
    ""
  );
}

/**
 * Whether the Clerk-backed specs can run here, and why not when they cannot.
 *
 * Two switches, because two different facts have to be true and they are owned
 * by different places. `VRDEX_ENABLE_E2E_AUTH_HELPERS` says the *deployment*
 * exposes `/api/e2e/auth`; `VRDEX_ENABLE_E2E_CLERK_AUTH` says *this runner* has
 * credentials for that deployment's Clerk instance. Merging the code cannot
 * turn CI red on its own, because the second switch starts off.
 *
 * Once it is on, missing keys throw rather than skip. A skipped Playwright file
 * exits 0, and the `Playwright Auth Session Matrix` lane is the cautionary
 * example: it reported green for months over a spec that ran nothing, and its
 * summary described three browsers of coverage that never executed.
 */
export function clerkTestAuthAvailability(): { available: true } | { available: false; reason: string } {
  // The flag is examined *first*, so it is genuinely the rollout switch the docs
  // describe. Both hosted workflows inject the Clerk secrets independently of
  // it, so keying off the keys alone meant an operator who had installed the
  // secrets but deliberately left the flag off could not stop these specs — they
  // would create accounts against a target nobody had declared ready.
  if (process.env.VRDEX_ENABLE_E2E_CLERK_AUTH !== "true") {
    return {
      available: false,
      reason:
        'Clerk test auth is not enabled here (VRDEX_ENABLE_E2E_CLERK_AUTH is not "true"). Local Convex deployments pin an unresolvable issuer and cannot validate Clerk tokens, so these specs run against a hosted target only.',
    };
  }

  // The two switches are set in different places and can disagree. When Clerk
  // auth is on but the deployment does not expose `/api/e2e/auth`, every spec
  // here skips its authenticated test on its own guard — and in
  // `auth-session.flow.spec.ts` the signed-out redirect test then passes alone,
  // so Playwright exits 0 and the workflow reports a healthy contract over
  // identity resolution, reload, sibling-tab, and sign-out never running.
  //
  // Rejected rather than skipped, for the same reason missing keys are: this
  // combination is someone asking for auth coverage against a target that
  // cannot provide it, which is a misconfiguration to surface.
  if (
    process.env.PLAYWRIGHT_BASE_URL &&
    process.env.VRDEX_ENABLE_E2E_AUTH_HELPERS !== "true"
  ) {
    throw new Error(
      "Clerk test auth is enabled but this target does not expose /api/e2e/auth (VRDEX_ENABLE_E2E_AUTH_HELPERS is not \"true\"). The authenticated specs would skip while the signed-out ones passed, reporting a contract that never ran. Enable the helper on the deployment, or unset VRDEX_ENABLE_E2E_CLERK_AUTH.",
    );
  }

  if (secretKey() && publishableKey()) {
    return { available: true };
  }

  const missing = [
    secretKey() ? null : "CLERK_SECRET_KEY",
    publishableKey() ? null : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ]
    .filter((name): name is string => name !== null)
    .join(" and ");

  // Enabled but unusable, so fail rather than skip.
  throw new Error(
    `Hosted auth E2E is enabled for this target but ${missing} is not set. Configure the staging Clerk development instance keys, or unset VRDEX_ENABLE_E2E_CLERK_AUTH.`,
  );
}

// `clerkSetup` fetches one testing token and caches it on `process.env`, so it
// is per-worker state. Memoised rather than hung off a Playwright setup project
// so the visual, snapshot, and storybook lanes never have to hold Clerk keys.
let clerkSetupPromise: Promise<void> | null = null;

async function ensureClerkSetup() {
  clerkSetupPromise ??= clerkSetup({ publishableKey: publishableKey() });

  await clerkSetupPromise;
}

async function clerkBackendRequest(path: string, init: RequestInit) {
  const response = await fetch(`${CLERK_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/json",
    },
  });

  return response;
}

/**
 * The address is `+clerk_test` so Clerk suppresses every delivery attempt,
 * including the "new device" notice a ticket sign-in would otherwise trigger,
 * and `@e2e.vrdex.net` because `normalizeE2eEmail` in `convex/e2e.ts` accepts
 * that domain and nothing else.
 *
 * Not `.local`, which the first hosted run proved Clerk rejects outright:
 * `422 form_param_format_invalid: Email address must be a valid email address.`
 */
export const E2E_EMAIL_DOMAIN = "@e2e.vrdex.net";

export function clerkTestEmail(runSuffix: string) {
  const normalized = runSuffix.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 48);

  return `${normalized}+clerk_test${E2E_EMAIL_DOMAIN}`;
}

/**
 * Whether the target is serving this exact commit.
 *
 * A local run always is, by definition. For hosted runs this matches on `main`
 * and nothing else, because staging only ever deploys `main`: a feature branch
 * reads `false` and keeps the tolerances below, while the post-merge health lane
 * reads `true` and loses them. That asymmetry is the point — the branch
 * genuinely is ahead of staging, and after merge it genuinely is not.
 */
export async function hostedTargetRunsCurrentRevision(request: APIRequestContext) {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    return true;
  }

  const revision = process.env.GITHUB_SHA?.trim().slice(0, 7);

  if (!revision) {
    return false;
  }

  return (await deploymentRevisionText(request)).includes(revision);
}

/**
 * Whatever this target will say about the revision it runs.
 *
 * `/deployment` was the original Vercel bring-up page and is now
 * `/api/deployment`, which answers as data. Shared staging tracks `main`, so it
 * serves the page until this merges and the route afterwards — both are read
 * here for the length of that overlap, exactly as the adapter accepts both
 * reference shapes for the length of its own.
 *
 * ponytail: transitional. Drop the `/deployment` fallback once staging carries
 * this branch.
 */
async function deploymentRevisionText(request: APIRequestContext) {
  for (const path of ["/api/deployment", "/deployment"]) {
    const response = await request.get(path);

    if (response.ok()) {
      return await response.text();
    }
  }

  return "";
}

/**
 * Why a `/api/e2e/auth` failure is the shared hosted target lagging this branch,
 * or `null` when it is a real failure.
 *
 * Staging only ever runs `main`, so a branch that adds or changes a helper is
 * ahead of it until it merges. Three distinct shapes mean the same thing, and
 * each one cost a hosted run to discover:
 *
 * - `404` — the route itself is not deployed. `/api/e2e/auth` was deleted with
 *   Convex Auth and only this branch restores it.
 * - `400` naming the disposable-email allowlist — the route is deployed but
 *   still on the domain this branch replaces.
 * - `400 Unsupported E2E auth helper action.` — the route is deployed but
 *   predates the action being called.
 *
 * Hosted-only, and each shape is matched specifically rather than "any 4xx": a
 * local run is always this branch, where every one of these is a real bug, and
 * once staging catches up a genuine failure has to fail rather than be excused
 * indefinitely as an old deployment.
 */
export async function hostedHelperLagReason(
  request: APIRequestContext,
  status: number,
  body: string,
): Promise<string | null> {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    return null;
  }

  // Nothing is lag once the target is running this exact commit. Without this,
  // the post-merge `deployed-health.yml` lane would annotate and pass through a
  // later regression that deleted or misrouted `/api/e2e/auth` — the tolerance
  // outliving the deployment gap it was written for, which is how a lane starts
  // reporting green over nothing.
  if (await hostedTargetRunsCurrentRevision(request)) {
    return null;
  }

  if (status === 404) {
    return "The shared hosted target does not serve /api/e2e/auth yet; this branch restores the route the Clerk cutover removed.";
  }

  if (status === 400 && /E2E auth helpers only accept .* emails\./.test(body)) {
    return "The shared hosted target still rejects the disposable E2E email domain this branch moves to.";
  }

  if (status === 400 && body.includes("Unsupported E2E auth helper action.")) {
    return "The shared hosted target does not expose the E2E auth helper action this branch adds.";
  }

  return null;
}

/**
 * Backend-API-created email addresses arrive already verified, which is what
 * puts `email_verified` in the `convex` JWT template's output. Every claim-level
 * guard reads that claim, so a user created any other way fails claiming with
 * `EMAIL_NOT_VERIFIED` rather than anything that names the real cause.
 */
export async function createClerkTestAccount(runSuffix: string): Promise<ClerkTestAccount> {
  await ensureClerkSetup();

  const email = clerkTestEmail(runSuffix);
  const response = await clerkBackendRequest("/v1/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [email],
      skip_password_requirement: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Clerk test user creation failed (${response.status}): ${await response.text()}`);
  }

  const user = (await response.json()) as { id?: unknown };

  if (typeof user.id !== "string" || user.id === "") {
    throw new Error("Clerk test user creation returned no user id.");
  }

  return { clerkUserId: user.id, email };
}

/**
 * Fails fast when the target does not load Clerk at all.
 *
 * Without this the symptom is a 90-second test timeout whose only stack frame
 * is the `finally` block's cleanup failing against a torn-down context — an
 * error that names neither the cause nor the fix. `clerk.signIn` waits on
 * `window.Clerk` indefinitely, so a target serving a pre-Clerk build just hangs.
 *
 * That is not hypothetical: the first hosted run of this suite hit exactly it.
 * Staging had been stuck on a pre-cutover commit for days because every deploy
 * failed on an unset `CLERK_JWT_ISSUER_DOMAIN`, and the E2E timeout said nothing
 * about any of that.
 */
async function requireClerkOnTarget(page: Page) {
  const loaded = await page
    .waitForFunction(() => Boolean((window as unknown as { Clerk?: unknown }).Clerk), undefined, {
      timeout: 15_000,
    })
    .catch(() => null);

  if (loaded === null) {
    throw new Error(
      `${page.url()} never loaded Clerk. The target is missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, or is running a build from before the Clerk cutover — check its /api/deployment commit and whether its last deploy succeeded.`,
    );
  }
}

/**
 * Signs in and waits for the Convex side to catch up.
 *
 * `users:ensureCurrentUser` runs from `ConvexClientProvider` on the first
 * authenticated page load, so the `users` row this account needs does not exist
 * until a signed-in page has rendered. Every `/api/e2e/auth` helper resolves the
 * account by email against that row, so returning before `/account` shows the
 * identity would make the next helper call fail with "E2E user not found."
 */
export async function signInClerkTestAccount(page: Page, account: ClerkTestAccount) {
  await ensureClerkSetup();
  await setupClerkTestingToken({ page });

  // Clerk has to be loaded on a page it is allowed to run on before the helper
  // can drive it, and `/` is public.
  await gotoFlowPage(page, "/");
  await requireClerkOnTarget(page);
  await clerk.signIn({ page, emailAddress: account.email });

  await gotoFlowPage(page, "/account");
  await expect(page.getByRole("heading", { name: account.email })).toBeVisible(hostedExpectOptions);
  await expect(page.getByText("Verified", { exact: true })).toBeVisible(hostedExpectOptions);
}

/**
 * Deletes the Clerk user. The Convex rows keyed to it are torn down separately
 * through `/api/e2e/auth`, because Convex never learns about a Clerk deletion —
 * provisioning is on-demand from the client, with no webhook to fire.
 *
 * Never throws: this runs from `finally` blocks, where masking the assertion
 * failure that got us there would be worse than leaking one disposable account.
 */
export async function deleteClerkTestAccount(account: ClerkTestAccount | undefined) {
  if (!account || !secretKey()) {
    return;
  }

  try {
    await clerkBackendRequest(`/v1/users/${encodeURIComponent(account.clerkUserId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    console.warn(`Failed to delete Clerk test user ${account.clerkUserId}:`, error);
  }
}

/** Convex-side teardown for the account, mirroring `cleanupAuthUserByEmail`. */
export async function cleanupClerkTestAccountData(
  request: APIRequestContext,
  e2eToken: string,
  account: ClerkTestAccount | undefined,
) {
  if (!account) {
    return;
  }

  await request.delete("/api/e2e/auth", {
    headers: { "x-vrdex-e2e-token": e2eToken },
    data: { email: account.email },
  });
}
