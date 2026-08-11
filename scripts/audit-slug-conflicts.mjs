import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONVEX_TARGET_NAMES,
  convexCliPath,
  convexTargetEnv,
  resolveTargetName,
} from "./convex-target.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);

const USAGE = [
  `Usage: pnpm ops:slug-audit -- [--target <${CONVEX_TARGET_NAMES.join("|")}>]`,
  "",
  "Reports slugs that stopped being reachable, or stopped being unique, when",
  "profiles, worlds, and events moved to the site root.",
  "",
  "Read-only. It never writes, because both problems need a human to pick the",
  "winner: which of two entities keeps a name, and what an entity sitting on a",
  "route name should be called instead.",
].join("\n");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}

const requested = resolveTargetName(args);

if (requested.error !== undefined) {
  fail(requested.error);
}

const target = convexTargetEnv(requested.name);

if (!target.ok) {
  fail(target.error);
}

console.error(`→ convex ${target.label} (${target.deployment})`);

const result = spawnSync(
  process.execPath,
  [convexCliPath, "run", "slugAudit:conflicts", "{}"],
  { cwd: repoRoot, encoding: "utf8", env: target.env, windowsHide: true },
);

// Keyed on the result rather than the exit status. The Convex CLI prints the
// query's return value and then, on Windows, trips a libuv assertion while tearing
// its event loop down -- it does that running this query by hand too. A parsed
// report means the query ran; no report means it did not, whatever the status says.
const jsonStart = result.stdout.indexOf("{");

if (jsonStart === -1) {
  fail(
    `Could not read the audit result.\n${result.stdout}\n${result.stderr ?? ""}`.trimEnd(),
  );
}

const report = JSON.parse(result.stdout.slice(jsonStart));
const lines = [];

lines.push(
  `Checked ${report.checked.profiles} profiles, ${report.checked.worlds} worlds, ` +
    `${report.checked.events} events against ${report.liveRouteCount} live route names.`,
);

if (report.duplicates.length === 0) {
  lines.push("", "No slug is held by more than one entity.");
} else {
  lines.push("", `${report.duplicates.length} slug(s) held by more than one entity:`);
  for (const duplicate of report.duplicates) {
    lines.push(`  /${duplicate.slug}`);
    // Resolution order, so the first line is the one that wins today and every
    // other holder is currently unreachable.
    for (const [index, holder] of duplicate.holders.entries()) {
      const status = index === 0 ? "resolves" : "UNREACHABLE";
      lines.push(`    ${status.padEnd(11)} ${holder.kind.padEnd(9)} ${holder.displayName} (${holder.id})`);
    }
  }
}

if (report.shadowedByRoute.length === 0) {
  lines.push("", "No entity holds a live route name.");
} else {
  lines.push(
    "",
    `${report.shadowedByRoute.length} entit(y/ies) hold a live route name and have no reachable page:`,
  );
  for (const holder of report.shadowedByRoute) {
    lines.push(`  /${holder.slug}  ${holder.kind.padEnd(9)} ${holder.displayName} (${holder.id})`);
  }
}

if (report.nestedRoutesShadowed.length === 0) {
  lines.push("", "No entity holds a route prefix.");
} else {
  lines.push(
    "",
    `${report.nestedRoutesShadowed.length} entit(y/ies) hold a route prefix. The public page` +
      " still works; the owner-facing subpaths under it do not:",
  );
  for (const holder of report.nestedRoutesShadowed) {
    lines.push(
      `  /${holder.slug}  ${holder.kind.padEnd(9)} ${holder.displayName} (${holder.id})` +
        `  -- /${holder.slug}/edit goes to the ${holder.slug} routes`,
    );
  }
}

const clean =
  report.duplicates.length === 0 &&
  report.shadowedByRoute.length === 0 &&
  report.nestedRoutesShadowed.length === 0;

lines.push("", clean ? "Nothing to migrate." : "Rename the losing rows before the root routes ship.");

console.log(lines.join("\n"));
process.exit(clean ? 0 : 1);
