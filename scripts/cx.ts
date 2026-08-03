import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONVEX_TARGET_NAMES,
  CX_TARGET_HELP,
  convexCliPath,
  convexTargetEnv,
  targetSelectorFlagError,
} from "./convex-target";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const USAGE = [
  `Usage: pnpm cx -- <${CONVEX_TARGET_NAMES.join("|")}> <convex args...>`,
  "",
  "  pnpm cx -- prod run seedImports:listBatchesForReview",
  "  pnpm cx -- prod run migrations:publishGatedProfiles '{\"dryRun\": true}'",
  "  pnpm cx -- dev  env list",
  "  pnpm cx -- local dev --once --run health:status",
  "",
  "The target is required and never inferred. Credentials come from the main",
  "checkout's .env.local, are passed to the Convex CLI through its environment,",
  "and are never printed.",
].join("\n");

function run(name: string, convexArgs: string[]) {
  const forwardedSelector = targetSelectorFlagError(convexArgs, CX_TARGET_HELP);

  if (forwardedSelector !== undefined) {
    console.error(forwardedSelector);
    return { status: 1 };
  }

  const target = convexTargetEnv(name);

  if (!target.ok) {
    console.error(target.error);
    return { status: 1 };
  }

  console.error(`→ convex ${target.label} (${target.deployment}) via ${target.envPath}`);

  // The CLI entry point rather than the .bin shim: the shim needs a shell on
  // Windows, and cmd strips the quotes off a JSON argument, so
  // `run fn '{"dryRun": true}'` would arrive unparseable.
  return spawnSync(process.execPath, [convexCliPath, ...convexArgs], {
    cwd: repoRoot,
    env: target.env,
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

  return run(name, convexArgs).status ?? 1;
}

// Only when invoked as a command, so this stays importable by tests.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
