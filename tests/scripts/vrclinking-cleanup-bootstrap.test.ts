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
    () => parseArgs(["--target", "production", "--site-url", "https://vrdex.net"]),
    /--target must be/,
  );
  assert.throws(() => parseArgs(["--target", "prod"]), /--site-url is required/);
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
