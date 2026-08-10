import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONVEX_TARGET_NAMES,
  convexCliPath,
  convexTargetEnv,
  SEED_SCRIPT_TARGET_HELP,
  resolveTargetName,
  targetSelectorFlagError,
} from "./convex-target.ts";
import { readOption, unknownOption } from "./publish-seed-batch.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);

const USAGE = [
  "Usage: pnpm ops:profile-archive -- --slug <profile-slug> \\",
  "  --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] \\",
  "  --reason <why this row should not be on the site> \\",
  "  [--unarchive] [--confirm-claimed] [--apply] \\",
  `  [--target <${CONVEX_TARGET_NAMES.join("|")}>]`,
  "",
  "Without --apply this prints what would change and writes nothing.",
  "",
  "Archival hides a profile from every public surface and releases the search",
  "terms it contributed. It is reversible with --unarchive, and it never deletes:",
  "the row, its slug and its audit trail all survive, because releasing the slug",
  "would let a later import take the name and rebuild the identity elsewhere.",
  "",
  "This is not suppression. Suppression records that somebody asked to be hidden",
  "and is resolved by a reviewer; archival is the operator saying a row should",
  "not exist -- a name that is a pasted URL, a placeholder that is not a person.",
  "Filing the wrong one puts a fabricated take-down in the moderation history.",
  "",
  "--confirm-claimed is required to archive a claimed profile, which takes a page",
  "away from the person answerable for it.",
].join("\n");

const VALUE_OPTIONS = [
  "--slug",
  "--reason",
  "--actor-token",
  "--actor-issuer",
  "--actor-subject",
  "--actor-name",
  "--target",
];
const KNOWN_OPTIONS = [...VALUE_OPTIONS, "--unarchive", "--confirm-claimed", "--apply"];

function option(name) {
  return readOption(args, name);
}

function flag(name) {
  return args.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  if (args.length === 0 || flag("--help") || flag("-h")) {
    console.log(USAGE);
    return;
  }

  // The sibling seed script's parser rather than a second one. It already
  // handles the package-manager `--`, repeated options, positional strays and
  // the `--target=` equals form -- each of them a lesson that script paid for,
  // and a hand-rolled copy here got the very first one wrong.
  const unknown = unknownOption(args, KNOWN_OPTIONS, VALUE_OPTIONS);

  if (unknown !== undefined) {
    fail(
      `${unknown.reason === "repeated" ? "Repeated" : "Unrecognized"} option "${unknown.name}".\n\n${USAGE}`,
    );
  }

  for (const name of VALUE_OPTIONS) {
    if (args.includes(name) && option(name) === undefined) {
      fail(`${name} needs a value.\n\n${USAGE}`);
    }
  }

  const slug = option("--slug");
  const reason = option("--reason");
  const actorToken = option("--actor-token");
  const actorIssuer = option("--actor-issuer");
  const actorSubject = option("--actor-subject");
  const actorName = option("--actor-name");

  if (!slug) {
    fail(`--slug is required.\n\n${USAGE}`);
  }

  if (!reason) {
    fail(`--reason is required, recording why this profile is coming off the site.\n\n${USAGE}`);
  }

  if (!actorToken || !actorIssuer || !actorSubject) {
    fail(`This run requires actor identity.\n\n${USAGE}`);
  }

  const legacySelector = targetSelectorFlagError(args, SEED_SCRIPT_TARGET_HELP);

  if (legacySelector) {
    fail(legacySelector);
  }

  const requested = resolveTargetName(args);

  if (requested.error) {
    fail(requested.error);
  }

  const target = convexTargetEnv(requested.name);

  if (!target.ok) {
    fail(target.error);
  }

  console.error(`→ convex ${target.label} (${target.deployment})`);

  const archived = !flag("--unarchive");
  const dryRun = !flag("--apply");
  const result = spawnSync(
    process.execPath,
    [
      convexCliPath,
      "run",
      "profileArchival:setProfileArchivedAsOperator",
      JSON.stringify({
        slug,
        archived,
        reason,
        dryRun,
        confirmClaimed: flag("--confirm-claimed"),
        actor: {
          tokenIdentifier: actorToken,
          issuer: actorIssuer,
          subject: actorSubject,
          ...(actorName ? { displayName: actorName } : {}),
        },
      }),
    ],
    { cwd: repoRoot, encoding: "utf8", env: target.env, windowsHide: true },
  );

  if (result.status !== 0) {
    fail(`Archival call failed.\n${result.stderr ?? ""}`);
  }

  let response;

  try {
    response = JSON.parse(result.stdout.trim());
  } catch {
    fail("The archival call succeeded but its output could not be parsed.");
  }

  const verb = archived ? "Archive" : "Restore";

  if (response.changed === false) {
    console.log(
      `\n${response.displayName} (${response.slug}) is already ${response.publicSurfacingState}. Nothing to do.`,
    );
    return;
  }

  console.log(
    `\n${dryRun ? `Would ${verb.toLowerCase()}` : `${verb}d`} ${response.displayName} (${response.slug}): ` +
      `now ${response.publicSurfacingState}.`,
  );

  if (dryRun) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to write.");
  }
}

main();
