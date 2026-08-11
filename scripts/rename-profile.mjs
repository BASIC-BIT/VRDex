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
  "Usage: pnpm ops:profile-rename -- --slug <current-slug> \\",
  "  [--display-name <name>] [--new-slug <slug>] \\",
  "  --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] \\",
  "  --reason <why this identity is wrong> \\",
  "  [--confirm-claimed] [--apply] \\",
  `  [--target <${CONVEX_TARGET_NAMES.join("|")}>]`,
  "",
  "Without --apply this prints what would change and writes nothing.",
  "",
  "Fixes a name an import got wrong -- a display name that is a pasted URL, a",
  "placeholder where a person should be. Community editing can rename an",
  "unclaimed profile but deliberately refuses the slug, and there was no operator",
  "path for either, so the only options were archiving a real person over a bad",
  "name or leaving the bad name up.",
  "",
  "A reslug moves every stored reference to the old slug: world credit rows and",
  "the attributions denormalized onto worlds. It also breaks any existing link to",
  "the profile, and frees the old slug for anyone else to take, so it is worth",
  "reserving for a slug that was never meaningful.",
  "",
  "--confirm-claimed is required for a claimed profile, whose page somebody",
  "answers for.",
].join("\n");

const VALUE_OPTIONS = [
  "--slug",
  "--display-name",
  "--new-slug",
  "--reason",
  "--actor-token",
  "--actor-issuer",
  "--actor-subject",
  "--actor-name",
  "--target",
];
const KNOWN_OPTIONS = [...VALUE_OPTIONS, "--confirm-claimed", "--apply"];

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

  // The seed script's parser, not a second one: it already handles the
  // package-manager `--`, repeats, positional strays and `--target=`.
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
  const displayName = option("--display-name");
  const newSlug = option("--new-slug");
  const reason = option("--reason");
  const actorToken = option("--actor-token");
  const actorIssuer = option("--actor-issuer");
  const actorSubject = option("--actor-subject");
  const actorName = option("--actor-name");

  if (!slug) {
    fail(`--slug is required.\n\n${USAGE}`);
  }

  if (displayName === undefined && newSlug === undefined) {
    fail(`Give --display-name, --new-slug, or both.\n\n${USAGE}`);
  }

  if (!reason) {
    fail(`--reason is required, recording why this identity is being changed.\n\n${USAGE}`);
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

  const dryRun = !flag("--apply");
  const result = spawnSync(
    process.execPath,
    [
      convexCliPath,
      "run",
      "profileIdentity:setProfileIdentityAsOperator",
      JSON.stringify({
        slug,
        reason,
        dryRun,
        confirmClaimed: flag("--confirm-claimed"),
        ...(displayName === undefined ? {} : { displayName }),
        ...(newSlug === undefined ? {} : { newSlug }),
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
    fail(`Rename call failed.\n${result.stderr ?? ""}`);
  }

  let response;

  try {
    response = JSON.parse(result.stdout.trim());
  } catch {
    fail("The rename call succeeded but its output could not be parsed.");
  }

  const lines = [""];

  if (response.renamed) {
    lines.push(
      `${dryRun ? "Would rename" : "Renamed"} "${response.previousDisplayName}" to "${response.displayName}".`,
    );
  }

  if (response.reslugged) {
    lines.push(
      `${dryRun ? "Would move" : "Moved"} ${response.previousSlug} to ${response.slug}, ` +
        `and every world credit pointing at it.`,
    );
    lines.push(`Any existing link to /${response.previousSlug} stops resolving.`);
  }

  console.log(lines.join("\n"));

  if (dryRun) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to write.");
  }
}

main();
