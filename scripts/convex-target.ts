import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoEnvLocal } from "./env-local";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

export const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");

/**
 * Every ambient Convex variable is cleared before a target's own values are
 * applied. `pnpm dev:backend:local` leaves `CONVEX_URL` pointing at
 * 127.0.0.1:3210, and a later production call in the same shell fails against
 * the local backend while the command line still reads `prod`.
 */
const AMBIENT_CONVEX_VARS = [
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_URL",
];

export const CONVEX_TARGETS = {
  dev: {
    deploymentVar: "CONVEX_DEPLOYMENT_DEV",
    keyVar: "CONVEX_DEPLOY_KEY_DEV",
    label: "shared development / staging",
  },
  prod: {
    deploymentVar: "CONVEX_DEPLOYMENT_PROD",
    keyVar: "CONVEX_DEPLOY_KEY_PROD",
    label: "PRODUCTION",
  },
} as const;

export type ConvexTargetName = keyof typeof CONVEX_TARGETS;

export const CONVEX_TARGET_NAMES = ["local", ...Object.keys(CONVEX_TARGETS)];

type ResolvedConvexTarget =
  | { deployment: string; key: string; label: string; ok: true }
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
  const key = values[target.keyVar]?.trim();
  // Both are named, rather than just the first missing one, so a half-configured
  // environment takes one round trip to fix instead of two.
  const missing = [
    deployment ? undefined : target.deploymentVar,
    key ? undefined : target.keyVar,
  ].filter((entry): entry is string => entry !== undefined);

  if (missing.length > 0) {
    return {
      error: `Cannot target ${name}: .env.local is missing ${missing.join(" and ")}.`,
      ok: false,
    };
  }

  return { deployment, key, label: target.label, ok: true };
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
 * Ordered so the main checkout wins outright. `loadRepoEnvLocal` keeps the first
 * value it sees for a key, so a worktree that has acquired its own `.env.local`
 * would otherwise shadow centrally rotated credentials with stale ones.
 */
function envRoots() {
  const main = mainCheckoutRoot();

  return main === undefined || main === repoRoot ? [repoRoot] : [main, repoRoot];
}

export type ConvexTargetEnv =
  | { env: NodeJS.ProcessEnv; label: string; deployment: string; envPath: string; ok: true }
  | { error: string; ok: false };

/**
 * The child environment for one Convex CLI call against `name`. The deploy key
 * travels here rather than on a command line, and is never returned to a caller
 * that might log it.
 */
export function convexTargetEnv(name: string): ConvexTargetEnv {
  // The ambient environment already points at the local backend: `.env.local`
  // sets CONVEX_DEPLOYMENT=anonymous:... and CONVEX_URL. Overriding anything
  // here would only break the case that already works. Starting that backend
  // stays `pnpm dev:backend:local`, which owns ports and executor cleanup.
  if (name === "local") {
    return {
      deployment: process.env.CONVEX_DEPLOYMENT ?? "local",
      env: process.env,
      envPath: "ambient environment",
      label: "local anonymous backend",
      ok: true,
    };
  }

  const values: NodeJS.ProcessEnv = {};
  const roots = envRoots();
  let envPath: string | undefined;

  for (const root of roots) {
    const attempt = loadRepoEnvLocal({ cwd: root, env: values });

    if (attempt.loaded && envPath === undefined) {
      envPath = attempt.path;
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
      CONVEX_DEPLOYMENT: resolved.deployment,
      CONVEX_DEPLOY_KEY: resolved.key,
    },
    envPath,
    label: resolved.label,
    ok: true,
  };
}
