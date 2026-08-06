import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupUrlFor,
  parseArgs,
  VRCLINKING_CLEANUP_VARIABLE_NAMES,
} from "../../scripts/bootstrap-vrclinking-cleanup.mjs";

/**
 * Derived from the site origin rather than supplied, so the Convex variable and
 * the route it posts to cannot disagree — a mismatch there fails closed and
 * silently, since a sweep has no caller waiting on it.
 */
test("derives the sweep URL from the deployment origin", () => {
  assert.equal(
    cleanupUrlFor("https://vrdex.net"),
    "https://vrdex.net/api/account/vrclinking-delegation/sweep",
  );
  // A path on the input is discarded rather than concatenated.
  assert.equal(
    cleanupUrlFor("https://staging.vrdex.net/whatever"),
    "https://staging.vrdex.net/api/account/vrclinking-delegation/sweep",
  );
});

test("refuses a target that is not a known deployment", () => {
  assert.throws(
    () =>
      parseArgs([
        "--target",
        "production",
        "--site-url",
        "https://vrdex.net",
        "--deployment-url",
        "https://x.vercel.app",
      ]),
    /--target must be/,
  );
  assert.throws(() => parseArgs(["--target", "prod"]), /--site-url is required/);
  // A Vercel environment change does not reach existing deployments, so a
  // rotation without a redeploy leaves Convex posting a bearer the live function
  // has never seen.
  assert.throws(
    () => parseArgs(["--target", "prod", "--site-url", "https://vrdex.net"]),
    /--deployment-url is required/,
  );
});

/**
 * Windows cannot spawn the `pnpm` and `npx` shims without a shell, and a shell
 * concatenates its arguments rather than escaping them. `new URL()` is not a
 * defence: every string below parses cleanly, and each one carries something
 * `cmd.exe` reads as a second command or a variable to expand. They would run
 * holding the operator's Vercel and Convex credentials.
 */
test("refuses URLs a shell could read as a second command", () => {
  const hostile = [
    "https://x.vercel.app/a&whoami",
    "https://x.vercel.app/a|whoami",
    "https://x.vercel.app/a%USERPROFILE%",
    "https://x.vercel.app/a>out",
    "https://x.vercel.app/?q=a&b",
    'https://x.vercel.app/a"b',
    "https://x.vercel.app/a^b",
  ];

  for (const value of hostile) {
    assert.doesNotThrow(() => new URL(value), `${value} should still parse as a URL`);
    assert.throws(
      () =>
        parseArgs(["--target", "prod", "--site-url", "https://vrdex.net", "--deployment-url", value]),
      /nothing a shell could read as a second command/,
      value,
    );
  }

  // The shapes actually used stay accepted: a bare origin, a subdomain, and the
  // generated Vercel deployment hostname.
  for (const value of [
    "https://vrdex.net",
    "https://staging.vrdex.net",
    "https://vr-dex-917snupst-basicbit.vercel.app",
  ]) {
    assert.deepEqual(
      parseArgs(["--target", "prod", "--site-url", value, "--deployment-url", value]).deploymentUrl,
      value,
    );
  }
});

/**
 * Both names, because the sweep is inert unless both are present and the cron
 * reports that state nowhere an operator sees.
 */
test("names both variables the sweep needs", () => {
  assert.deepEqual([...VRCLINKING_CLEANUP_VARIABLE_NAMES], [
    "VRCLINKING_CLEANUP_URL",
    "VRCLINKING_CLEANUP_TOKEN",
  ]);
});
