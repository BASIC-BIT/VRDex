#!/usr/bin/env node
/**
 * Provisions the paired variables the delegated-key cleanup sweep needs.
 *
 * The sweep is the only cleanup path that is not driven by a request, so it is
 * what retires a key written by a POST that died after a revoke had already
 * cancelled its reservation. Its variables were dashboard-only, which meant a
 * deployment could enable the delegation form, run the cron daily, and have it
 * report `configured: false` forever while keys accumulated — visible nowhere.
 *
 * Three values, one secret shared across two providers:
 *
 *   Convex  VRCLINKING_CLEANUP_URL     where to post obligations
 *   Convex  VRCLINKING_CLEANUP_TOKEN   the shared bearer
 *   Vercel  VRCLINKING_CLEANUP_TOKEN   the same bearer, to check against
 *
 * Generated rather than chosen, and printed nowhere: the token goes straight
 * from `randomBytes` into both providers. Rerunning rotates it, and rotating is
 * safe in either order — a mismatched pair fails closed, costing one sweep.
 *
 * The token never becomes a process argument on either side: `convex env set`
 * and `vercel env add` both read it from stdin, and argv is readable by any
 * other process on the box for as long as the command runs.
 *
 * Usage:
 *   node scripts/bootstrap-vrclinking-cleanup.mjs --target prod
 *     --site-url https://vrdex.net --deployment-url <vercel-deployment-url>
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const VRCLINKING_CLEANUP_VARIABLE_NAMES = Object.freeze([
  "VRCLINKING_CLEANUP_URL",
  "VRCLINKING_CLEANUP_TOKEN",
]);

/** The route the cron posts to. Derived, so the two halves cannot disagree. */
export function cleanupUrlFor(siteUrl) {
  const origin = new URL(siteUrl).origin;

  return `${origin}/api/account/vrclinking-delegation/sweep`;
}

export function parseArgs(argv) {
  const options = { target: "", siteUrl: "", deploymentUrl: "", vercelEnvironment: "production" };

  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--target":
        options.target = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--site-url":
        options.siteUrl = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--deployment-url":
        options.deploymentUrl = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--vercel-environment":
        options.vercelEnvironment = argv[index + 1] ?? "";
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${argv[index]}`);
    }
  }

  assert.ok(
    ["local", "dev", "prod"].includes(options.target),
    "--target must be one of local, dev, prod.",
  );
  assert.ok(options.siteUrl, "--site-url is required, and must be the deployment's public origin.");
  // Required, not optional. A Vercel environment change does not reach
  // deployments that already exist, so without a redeploy Convex starts posting
  // a bearer the live function has never seen — the sweep 401s and keys pile up
  // with nothing reporting it.
  assert.ok(
    options.deploymentUrl,
    "--deployment-url is required: the running deployment must be redeployed to pick up the new token.",
  );

  // Constrained, not merely parsed, because Windows needs `shell: true` to
  // reach the `.cmd` shims for `pnpm` and `npx`, and a shell concatenates rather
  // than escapes. `new URL()` is no defence on its own: `&`, `|` and `%` are all
  // legal in a path or query and all mean something to `cmd.exe`, so a URL
  // pasted from the wrong place could run a second command holding the
  // operator's Vercel and Convex credentials.
  //
  // The bearer never travels this way, since it goes to stdin. What does is
  // these three strings, so each is held to the narrowest shape that still
  // admits every real value: `target` is a whitelist, the environment is a bare
  // name, and both URLs are an https origin with an optional plain path. Vercel
  // deployment URLs and site origins carry no query, so none is allowed.
  for (const [flag, value] of [
    ["--site-url", options.siteUrl],
    ["--deployment-url", options.deploymentUrl],
  ]) {
    assert.doesNotThrow(() => new URL(value), `${flag} must be a URL.`);
    assert.ok(
      /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/.test(value),
      `${flag} must be an https origin with an optional plain path, and nothing a shell could read as a second command.`,
    );
  }

  assert.ok(
    /^[a-z0-9_-]+$/i.test(options.vercelEnvironment),
    "--vercel-environment must be a plain environment name.",
  );

  return options;
}

/**
 * `pnpm` and `npx` are `.cmd` shims on Windows, and Node refuses to spawn those
 * without a shell — so `shell: false` made this script unrunnable on the one
 * machine an operator actually holds. A shell costs nothing here that matters:
 * the bearer is written to stdin and never appears in `args`, which is the whole
 * reason `shell: false` was chosen in the first place. What travels through the
 * shell is a target name, two URLs, and an environment name.
 */
const SPAWN_THROUGH_SHELL = process.platform === "win32";

function run(command, args, label, input) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: SPAWN_THROUGH_SHELL,
    ...(input === undefined ? {} : { input }),
  });

  assert.equal(
    result.status,
    0,
    `${label} failed: ${result.stderr?.trim() || result.stdout?.trim() || result.error?.message || "no output"}`,
  );
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = randomBytes(32).toString("hex");
  const cleanupUrl = cleanupUrlFor(options.siteUrl);

  // Read-only, and first, because the rotation cannot be half-applied and left.
  // Convex's token is set below; if the Vercel write or the redeploy then fails
  // — no login, no project link, a mistyped deployment URL — Convex is already
  // posting a bearer the live function has never seen, and every sweep answers
  // 401 daily while revoked keys accumulate with nothing surfacing it. No
  // ordering closes that window, because whichever provider moves first is the
  // one left disagreeing. These two calls fail on exactly the causes that would
  // strand the rotation, and change nothing when they pass.
  run(
    "npx",
    ["--yes", "vercel@latest", "env", "ls", options.vercelEnvironment],
    "Checking Vercel access before rotating the token",
  );
  run(
    "npx",
    ["--yes", "vercel@latest", "inspect", options.deploymentUrl],
    "Checking the deployment URL before rotating the token",
  );

  run(
    "pnpm",
    ["cx", options.target, "env", "set", "VRCLINKING_CLEANUP_URL", cleanupUrl],
    "Setting VRCLINKING_CLEANUP_URL in Convex",
  );
  // No value argument: `convex env set NAME` reads it from stdin, which keeps the
  // bearer out of argv where any other local process could read it.
  run(
    "pnpm",
    ["cx", options.target, "env", "set", "VRCLINKING_CLEANUP_TOKEN"],
    "Setting VRCLINKING_CLEANUP_TOKEN in Convex",
    token,
  );

  // Vercel reads the value from stdin so it never becomes a process argument,
  // which `ps` and shell history both expose.
  const vercel = spawnSync(
    "npx",
    [
      "--yes",
      "vercel@latest",
      "env",
      "add",
      "VRCLINKING_CLEANUP_TOKEN",
      options.vercelEnvironment,
      "--force",
    ],
    { input: token, encoding: "utf8", shell: SPAWN_THROUGH_SHELL },
  );

  assert.equal(
    vercel.status,
    0,
    `Setting VRCLINKING_CLEANUP_TOKEN in Vercel failed: ${vercel.stderr?.trim() || vercel.error?.message || "no output"}`,
  );

  // Vercel applies an environment change to future deployments only, so the
  // running function still holds the old token — or none — until it is rebuilt.
  // Convex is already posting the new one, so skipping this leaves the sweep
  // answering 401 daily with nothing surfacing it.
  // `--target`, not `--yes`: `vercel redeploy` has never accepted the latter,
  // so this step failed every time it was reached and left the two providers
  // holding a token the running function did not have.
  run(
    "npx",
    ["--yes", "vercel@latest", "redeploy", options.deploymentUrl, "--target", options.vercelEnvironment],
    "Redeploying so the new token reaches the running function",
  );

  console.log(
    `Cleanup sweep configured for ${options.target}. Convex posts obligations to ${cleanupUrl}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
