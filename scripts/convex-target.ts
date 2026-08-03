import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoEnvLocal } from "./env-local";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

export const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");

/**
 * Every ambient Convex variable is cleared before a target's own values are
 * applied, including for `local`. A shell that has exported a production
 * deployment and key -- the manual dance this wrapper replaces -- would
 * otherwise turn an ostensibly local `--apply` into a production write, since
 * `local` is what the seed scripts use when `--target` is omitted.
 */
const AMBIENT_CONVEX_VARS = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_URL",
];

/**
 * `prefixes` is checked against the deployment string, so a production
 * deployment and key pasted under the `_DEV` names is rejected rather than run
 * against production while the banner reads "shared development".
 */
export const CONVEX_TARGETS = {
  local: {
    deploymentVar: "CONVEX_DEPLOYMENT",
    // The local backend authenticates nothing; a deploy key here would be a
    // cloud credential handed to 127.0.0.1.
    keyVar: undefined,
    label: "local anonymous backend",
    // Required, not optional: the ambient URL is cleared, so without this in the
    // env file the CLI is launched with no endpoint and fails to reach a running
    // backend instead of saying which variable is missing.
    passthroughVars: ["CONVEX_URL"],
    requiredPassthrough: true,
    prefixes: ["anonymous:", "local:"],
  },
  dev: {
    deploymentVar: "CONVEX_DEPLOYMENT_DEV",
    keyVar: "CONVEX_DEPLOY_KEY_DEV",
    label: "shared development / staging",
    passthroughVars: [],
    requiredPassthrough: false,
    prefixes: ["dev:"],
  },
  prod: {
    deploymentVar: "CONVEX_DEPLOYMENT_PROD",
    keyVar: "CONVEX_DEPLOY_KEY_PROD",
    label: "PRODUCTION",
    passthroughVars: [],
    requiredPassthrough: false,
    prefixes: ["prod:"],
  },
} as const;

export type ConvexTargetName = keyof typeof CONVEX_TARGETS;

export const CONVEX_TARGET_NAMES = Object.keys(CONVEX_TARGETS);

/**
 * Every Convex CLI flag that can point a command at a different deployment, or
 * supply different credentials. Four rounds of review each found one more entry
 * for this list, so it is no longer written from memory: `--prod`,
 * `--preview-name`, `--deployment-name`, and `--env-file` are what
 * `convex <command> --help` documents, and CONVEX_CLI_KNOWN_SAFE_FLAGS below
 * pins the rest so a flag added by a future Convex release fails a test rather
 * than quietly becoming a way through.
 *
 * `--local` and the self-hosted pair are not in that help output but belong
 * here anyway: `--local` is how `dev:backend:local` selects the anonymous
 * backend, and `--url`/`--admin-key` address a backend directly.
 */
const TARGET_SELECTOR_FLAGS = [
  "--prod",
  "--preview-name",
  "--preview-create",
  "--preview-run",
  "--deployment-name",
  "--deployment",
  "--dev-deployment",
  "--env-file",
  "--url",
  "--admin-key",
  "--local",
  "--configure",
  "--project",
  "--team",
];

/**
 * Flags on `convex run` that cannot change which deployment is reached. The
 * test asserts this plus TARGET_SELECTOR_FLAGS covers everything the installed
 * CLI advertises, so a new flag has to be classified deliberately.
 */
export const CONVEX_CLI_KNOWN_SAFE_FLAGS = [
  "--append",
  "--cmd",
  "--cmd-url-env-var-name",
  "--codegen",
  "--component",
  "--dry-run",
  "--format",
  "--help",
  "--history",
  "--identity",
  "--include-file-storage",
  "--ip-family",
  "--jsonl",
  "--limit",
  "--no",
  "--no-open",
  "--once",
  "--order",
  "--path",
  "--push",
  "--replace",
  "--replace-all",
  "--run",
  "--run-component",
  "--run-sh",
  "--speed-test",
  "--success",
  "--table",
  "--tail-logs",
  "--timeout",
  "--typecheck",
  "--typecheck-components",
  "--until-success",
  "--verbose",
  "--watch",
  "--yes",
];

/** The subcommands `cx` realistically forwards, and so must classify flags for. */
export const CONVEX_CLI_COMMANDS = [
  "run",
  "deploy",
  "env",
  "data",
  "dev",
  "import",
  "export",
  "logs",
];

export const CONVEX_TARGET_SELECTOR_FLAGS: readonly string[] = TARGET_SELECTOR_FLAGS;

/**
 * `--target x` and `--target=x` both count. The bare `option()` helpers in the
 * launchers only match the first form, so the conventional equals form fell
 * through to the `local` default -- an explicit-looking production publication
 * completing against the local backend and reporting success.
 */
export function resolveTargetName(argv: string[]): { name: string } | { error: string } {
  const separate = argv.indexOf("--target");
  const equals = argv.find((arg) => arg.startsWith("--target="));
  const occurrences =
    argv.filter((arg) => arg === "--target" || arg.startsWith("--target=")).length;

  if (separate === -1 && equals === undefined) {
    return { name: "local" };
  }

  // Order used to decide nothing -- the equals form won regardless -- so a
  // wrapper supplying `--target=local` ahead of an operator's `--target prod`
  // wrote locally and reported success. Ambiguity is an error instead.
  if (occurrences > 1) {
    return { error: "--target was given more than once. Supply exactly one." };
  }

  const value =
    equals === undefined ? argv[separate + 1] : equals.slice("--target=".length);

  // Present but empty is an operator error, not a request for the default.
  if (value === undefined || value === "" || value.startsWith("--")) {
    return { error: `--target needs a value: one of ${CONVEX_TARGET_NAMES.join(", ")}.` };
  }

  return { name: value };
}

/**
 * Selector flags are rejected rather than ignored, in both directions. A
 * leftover `ops:seed-publish -- --apply … --prod` from shell history would
 * otherwise publish to the local backend and report success -- worse than the
 * failure it replaced -- and a selector forwarded through `cx` would be applied
 * by the child CLI after the banner had already named a different deployment.
 */
export function targetSelectorFlagError(argv: string[], howToTarget: string) {
  const used = TARGET_SELECTOR_FLAGS.filter((flag) =>
    argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`)),
  );

  if (used.length === 0) {
    return undefined;
  }

  return `${used.join(" and ")} ${used.length === 1 ? "is" : "are"} not accepted here. ${howToTarget}`;
}

export const SEED_SCRIPT_TARGET_HELP =
  `Use --target <${CONVEX_TARGET_NAMES.join("|")}>. ` +
  "Without it this command would have run against local.";

export const CX_TARGET_HELP =
  "The deployment is the target argument to cx, which this would override after " +
  "the banner had already named a different one.";

type ResolvedConvexTarget =
  | {
      deployment: string;
      key: string | undefined;
      label: string;
      ok: true;
      passthrough: Record<string, string>;
    }
  | { error: string; ok: false };

export function resolveConvexTarget(
  name: string,
  values: Record<string, string | undefined>,
): ResolvedConvexTarget {
  if (!Object.hasOwn(CONVEX_TARGETS, name)) {
    return {
      error: `Unknown target "${name}". Expected one of: ${CONVEX_TARGET_NAMES.join(", ")}.`,
      ok: false,
    };
  }

  const target = CONVEX_TARGETS[name as ConvexTargetName];
  const deployment = values[target.deploymentVar]?.trim();
  const key = target.keyVar === undefined ? undefined : values[target.keyVar]?.trim();
  // Both are named, rather than just the first missing one, so a half-configured
  // environment takes one round trip to fix instead of two.
  const missing = [
    deployment ? undefined : target.deploymentVar,
    target.keyVar !== undefined && !key ? target.keyVar : undefined,
  ].filter((entry): entry is string => entry !== undefined);

  if (missing.length > 0) {
    return {
      error: `Cannot target ${name}: .env.local is missing ${missing.join(" and ")}.`,
      ok: false,
    };
  }

  if (!target.prefixes.some((prefix) => deployment!.startsWith(prefix))) {
    return {
      error:
        `Cannot target ${name}: ${target.deploymentVar} is "${deployment}", which does not start with ` +
        `${target.prefixes.map((prefix) => `"${prefix}"`).join(" or ")}. ` +
        "Check that the right deployment is under the right variable name.",
      ok: false,
    };
  }

  // A deploy key carries its own deployment ahead of a "|", and CONVEX_DEPLOY_KEY
  // alone is enough for the CLI to pick a deployment -- the workflows rely on
  // exactly that. So a correctly named dev deployment paired with a production
  // key would authenticate to production while the banner read "development".
  // Only the deployment portion is compared, never the secret after the "|", and
  // a key in some other shape is left alone rather than guessed at.
  const keyDeployment = key?.includes("|") ? key.slice(0, key.indexOf("|")) : undefined;

  if (keyDeployment !== undefined && keyDeployment !== deployment) {
    return {
      error:
        `Cannot target ${name}: ${target.keyVar} is a key for "${keyDeployment}", but ` +
        `${target.deploymentVar} is "${deployment}". The key decides which deployment the ` +
        "CLI reaches, so these must name the same one.",
      ok: false,
    };
  }

  const passthrough: Record<string, string> = {};

  for (const variable of target.passthroughVars) {
    const value = values[variable]?.trim();

    if (value) {
      passthrough[variable] = value;
      continue;
    }

    if (target.requiredPassthrough) {
      return {
        error: `Cannot target ${name}: .env.local is missing ${variable}.`,
        ok: false,
      };
    }
  }

  return { deployment: deployment!, key, label: target.label, ok: true, passthrough };
}

/**
 * The main checkout, which is where the ignored `.env.local` lives. Nearly all
 * work here happens in a worktree -- `guard-main-worktree` pushes it there -- and
 * a worktree never carries the env file. Git already knows the relationship, so
 * ask it rather than adding a variable the operator has to keep pointed right.
 */
export function mainCheckoutRoot() {
  const result = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return undefined;
  }

  const commonDir = result.stdout.trim();

  return commonDir ? path.dirname(commonDir) : undefined;
}

/**
 * Ordered so the main checkout is consulted first. Only one file is ever read:
 * merging them per key would let a stale worktree `.env.local` supply a pair
 * that central rotation has just removed from the main file, and the command
 * would run on withdrawn credentials while reporting the main file as its
 * source.
 */
function envRoots() {
  const main = mainCheckoutRoot();

  return main === undefined || main === repoRoot ? [repoRoot] : [main, repoRoot];
}

export type ConvexTargetEnv =
  | { env: NodeJS.ProcessEnv; label: string; deployment: string; envPath: string; ok: true }
  | { error: string; ok: false };

/**
 * The child environment for one Convex CLI call against `name`. Every value
 * comes from the env file rather than the calling shell, and the deploy key
 * travels here rather than on a command line.
 */
export function convexTargetEnv(name: string): ConvexTargetEnv {
  const values: NodeJS.ProcessEnv = {};
  const roots = envRoots();
  let envPath: string | undefined;

  for (const root of roots) {
    const attempt = loadRepoEnvLocal({ cwd: root, env: values });

    if (attempt.loaded) {
      envPath = attempt.path;
      break;
    }
  }

  if (envPath === undefined) {
    return { error: `Cannot target ${name}: no .env.local in ${roots.join(" or ")}.`, ok: false };
  }

  const resolved = resolveConvexTarget(name, values as Record<string, string | undefined>);

  if (!resolved.ok) {
    return { error: resolved.error, ok: false };
  }

  // Windows environment names are case-insensitive, so an ambient `Convex_URL`
  // would survive an exact-name filter and still be read as CONVEX_URL by the
  // child.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !AMBIENT_CONVEX_VARS.includes(key.toUpperCase()),
    ),
  );

  // Pinned to "" rather than deleted. The child runs in this checkout and the
  // Convex CLI loads its own .env.local from there -- one that
  // run-convex-local.mjs writes -- so a deleted CONVEX_URL would be refilled
  // with a localhost endpoint after a hosted target had been chosen and
  // announced. A variable that is already set is not overridden by that load.
  const cleared = Object.fromEntries(AMBIENT_CONVEX_VARS.map((name) => [name, ""]));

  return {
    deployment: resolved.deployment,
    env: {
      ...inherited,
      ...cleared,
      ...resolved.passthrough,
      CONVEX_DEPLOYMENT: resolved.deployment,
      ...(resolved.key === undefined ? {} : { CONVEX_DEPLOY_KEY: resolved.key }),
    },
    envPath,
    label: resolved.label,
    ok: true,
  };
}
