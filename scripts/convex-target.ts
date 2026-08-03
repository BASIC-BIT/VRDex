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
    passthroughVars: ["CONVEX_URL"],
    prefixes: ["anonymous:", "local:"],
  },
  dev: {
    deploymentVar: "CONVEX_DEPLOYMENT_DEV",
    keyVar: "CONVEX_DEPLOY_KEY_DEV",
    label: "shared development / staging",
    passthroughVars: [],
    prefixes: ["dev:"],
  },
  prod: {
    deploymentVar: "CONVEX_DEPLOYMENT_PROD",
    keyVar: "CONVEX_DEPLOY_KEY_PROD",
    label: "PRODUCTION",
    passthroughVars: [],
    prefixes: ["prod:"],
  },
} as const;

export type ConvexTargetName = keyof typeof CONVEX_TARGETS;

export const CONVEX_TARGET_NAMES = Object.keys(CONVEX_TARGETS);

const LEGACY_TARGET_FLAGS = ["--prod", "--deployment"];

/**
 * The old flags are rejected rather than ignored. `--target` defaults to
 * `local`, so a leftover `ops:seed-publish -- --apply … --prod` from shell
 * history or an old runbook would otherwise publish to the local backend and
 * report success, which is worse than the failure it replaced.
 */
export function legacyTargetFlagError(argv: string[]) {
  const used = LEGACY_TARGET_FLAGS.filter((flag) => argv.includes(flag));

  if (used.length === 0) {
    return undefined;
  }

  return (
    `${used.join(" and ")} ${used.length === 1 ? "is" : "are"} no longer supported. ` +
    `Use --target <${CONVEX_TARGET_NAMES.join("|")}>. ` +
    "Without it this command would have run against local."
  );
}

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

  const passthrough: Record<string, string> = {};

  for (const variable of target.passthroughVars) {
    const value = values[variable]?.trim();

    if (value) {
      passthrough[variable] = value;
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

  return {
    deployment: resolved.deployment,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !AMBIENT_CONVEX_VARS.includes(key)),
      ),
      ...resolved.passthrough,
      CONVEX_DEPLOYMENT: resolved.deployment,
      ...(resolved.key === undefined ? {} : { CONVEX_DEPLOY_KEY: resolved.key }),
    },
    envPath,
    label: resolved.label,
    ok: true,
  };
}
