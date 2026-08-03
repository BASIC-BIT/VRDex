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
  if (secretKey() && publishableKey()) {
    return { available: true };
  }

  const missing = [
    secretKey() ? null : "CLERK_SECRET_KEY",
    publishableKey() ? null : "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ]
    .filter((name): name is string => name !== null)
    .join(" and ");

  if (process.env.VRDEX_ENABLE_E2E_CLERK_AUTH === "true") {
    throw new Error(
      `Hosted auth E2E is enabled for this target but ${missing} is not set. Configure the staging Clerk development instance keys, or unset VRDEX_ENABLE_E2E_CLERK_AUTH.`,
    );
  }

  return {
    available: false,
    reason: `Clerk test auth is not configured (${missing}). Local Convex deployments pin an unresolvable issuer and cannot validate Clerk tokens, so run this against a hosted target with VRDEX_ENABLE_E2E_CLERK_AUTH=true.`,
  };
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
 * Whether a helper response is the shared hosted target refusing the current
 * disposable domain because it predates that change.
 *
 * Deliberately narrow: it matches the allowlist message alone, so once staging
 * carries this revision a genuine helper failure fails the test instead of being
 * excused indefinitely. Hosted-only for the same reason — a local run is always
 * this branch, where a domain mismatch is a real bug.
 */
export function isHostedEmailDomainLag(status: number, body: string) {
  return (
    Boolean(process.env.PLAYWRIGHT_BASE_URL) &&
    status === 400 &&
    /E2E auth helpers only accept .* emails\./.test(body)
  );
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
      `${page.url()} never loaded Clerk. The target is missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, or is running a build from before the Clerk cutover — check its /deployment commit and whether its last deploy succeeded.`,
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

export async function signOutClerkTestAccount(page: Page) {
  await clerk.signOut({ page });
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
