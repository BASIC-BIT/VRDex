import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadRepoEnvLocal } from "./env-local";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

/**
 * Every ambient Convex variable is cleared before the target's own values are
 * applied. `pnpm dev:backend:local` leaves `CONVEX_URL` pointing at
 * 127.0.0.1:3210, and a later `convex run --prod` in the same shell fails
 * against the local backend while the command line still reads `--prod`. The
 * target here is a required positional precisely so it can never be inherited.
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

type ResolvedConvexTarget =
  | { deployment: string; key: string; label: string; ok: true }
  | { error: string; ok: false };

const USAGE = [
  "Usage: pnpm cx -- <local|dev|prod> <convex args...>",
  "",
  "  pnpm cx -- prod run seedImports:listBatchesForReview",
  "  pnpm cx -- prod run migrations:publishGatedProfiles '{\"dryRun\": true}'",
  "  pnpm cx -- dev  env list",
  "  pnpm cx -- local dev --once --run health:status",
  "",
  "The target is required and never inferred. Credentials come from the repo",
  "root .env.local, are passed to the Convex CLI through its environment, and",
  "are never printed.",
].join("\n");

export function resolveConvexTarget(
  name: string,
  values: Record<string, string | undefined>,
): ResolvedConvexTarget {
  if (!Object.hasOwn(CONVEX_TARGETS, name)) {
    return {
      error: `Unknown target "${name}". Expected one of: local, ${Object.keys(CONVEX_TARGETS).join(", ")}.`,
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

// The CLI entry point rather than the .bin shim: the shim needs a shell on
// Windows, and cmd strips the quotes off a JSON argument on the way through, so
// `run fn '{"dryRun": true}'` arrives unparseable.
const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");

function runLocal(convexArgs: string[]) {
  // The local backend already has a working entry point that owns port
  // selection, the isolated Convex home, and executor cleanup. Reimplementing
  // any of that here would be a second source of truth for local runs.
  const localArgs = convexArgs.includes("--local") ? convexArgs : [...convexArgs, "--local"];

  console.error("→ convex local anonymous backend");

  return spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "run-convex-local.mjs"), ...localArgs],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

/**
 * The main checkout, which is where the ignored `.env.local` lives. Nearly all
 * work here happens in a worktree -- `guard-main-worktree` pushes it there -- and
 * a worktree never carries the env file. Git already knows the relationship, so
 * ask it rather than adding a variable the operator has to keep pointed right.
 */
function mainCheckoutRoot() {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  if (result.status !== 0) {
    return undefined;
  }

  const commonDir = result.stdout.trim();

  return commonDir ? path.dirname(commonDir) : undefined;
}

function runCloud(name: string, convexArgs: string[]) {
  const values: NodeJS.ProcessEnv = {};
  const roots = [repoRoot, mainCheckoutRoot()].filter(
    (root, index, all): root is string => root !== undefined && all.indexOf(root) === index,
  );
  const loaded = roots
    .map((root) => loadRepoEnvLocal({ cwd: root, env: values }))
    .find((attempt) => attempt.loaded);

  if (loaded === undefined) {
    console.error(`Cannot target ${name}: no .env.local in ${roots.join(" or ")}.`);
    return { status: 1 };
  }

  const resolved = resolveConvexTarget(name, values as Record<string, string | undefined>);

  if (!resolved.ok) {
    console.error(resolved.error);
    return { status: 1 };
  }

  console.error(`→ convex ${resolved.label} (${resolved.deployment}) via ${loaded.path}`);

  return spawnSync(process.execPath, [convexCliPath, ...convexArgs], {
    cwd: repoRoot,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !AMBIENT_CONVEX_VARS.includes(key)),
      ),
      CONVEX_DEPLOYMENT: resolved.deployment,
      CONVEX_DEPLOY_KEY: resolved.key,
    },
    stdio: "inherit",
  });
}

function main(argv: string[]) {
  const [name, ...convexArgs] = argv;

  if (name === undefined || name === "--help" || name === "-h") {
    console.error(USAGE);
    return 1;
  }

  if (convexArgs.length === 0) {
    console.error("No Convex command given.\n");
    console.error(USAGE);
    return 1;
  }

  const result = name === "local" ? runLocal(convexArgs) : runCloud(name, convexArgs);

  return result.status ?? 1;
}

// Only when invoked as a command, so the resolver above stays importable by tests.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
