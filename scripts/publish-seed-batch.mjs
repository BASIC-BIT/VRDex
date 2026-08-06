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

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);

const USAGE = [
  "Usage: pnpm ops:seed-publish -- --batch-id <external-batch-id> \\",
  "  --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] \\",
  "  [--reason <why the source permits publication>] [--accept-fields] [--limit <n>] [--apply] \\",
  `  [--target <${CONVEX_TARGET_NAMES.join("|")}>]`,
  "",
  "Without --apply this prints a read-only preview and writes nothing.",
  "--accept-fields accepts fields still marked unreviewed. Rejected and",
  "needs-correction fields are always left alone.",
  "",
  "Field visibility mode:",
  "  --set-visibility <public|unlisted|private> [--field-keys <a,b,c>]",
  "    [--rederive-values]",
  "",
  "Sets the stored visibility of a batch's accepted fields and carries it to any",
  "profile already published from them. Publication copies each field's",
  "visibility onto the profile, so a batch imported private publishes profiles",
  "that show nothing. Without --apply this runs as a dry run and writes nothing.",
  "",
  "--rederive-values also replays the accepted field values onto those profiles.",
  "They are community-editable, so that overwrites every correction made since",
  "publication with the import snapshot. Use it for a batch published before a",
  "normalization fix, not as a matter of course.",
].join("\n");

const FIELD_VISIBILITIES = ["public", "unlisted", "private"];

/**
 * Every option that takes a value, so a missing one is refused rather than read
 * as the option being absent.
 *
 * The whole list rather than the two that were reported: they only differed in
 * how visible the consequence was. `--set-visibility` selects the operation, so
 * losing its value runs a publication instead of a migration; `--reason` losing
 * its value would fail anyway; `--limit` would silently take the default. They
 * are the same mistake and refusing all of them is the same amount of code.
 */
export const VALUE_OPTIONS = [
  "--actor-issuer",
  "--actor-name",
  "--actor-subject",
  "--actor-token",
  "--batch-id",
  "--field-keys",
  "--limit",
  "--reason",
  "--set-visibility",
];

/**
 * Every option this script understands, `--target` included: the shared target
 * helper reads it off the same argv.
 */
export const KNOWN_OPTIONS = [
  ...VALUE_OPTIONS,
  "--target",
  "--accept-fields",
  "--apply",
  "--rederive-values",
];

/**
 * The options that consume the token after them, `--target` included.
 *
 * Walking the arguments needs to know this to tell a value apart from a stray
 * token: `--reason publish these` has a value the parser expects, while
 * `field-keys aliases` has two tokens nothing asked for.
 */
const VALUE_CONSUMING_OPTIONS = [...VALUE_OPTIONS, "--target"];

/**
 * The first token this script cannot account for, if any.
 *
 * Every argument has to be either an option it knows or the value consumed by
 * one, because a token nobody claimed is a token the operator believed was doing
 * something. Walking the list positionally rather than filtering it is the whole
 * point: checking only `--`-prefixed tokens left `field-keys aliases`, a
 * `--field-keys` with the dashes missed, passing silently -- and a
 * `--set-visibility public --apply` beside it makes every accepted field public
 * instead of the one that was named.
 *
 * The same for a misspelling that does keep its dashes. `--set-visibilty public
 * --apply` leaves the real `--set-visibility` unset, so the run falls past the
 * migration and bulk publishes every pending candidate in the batch.
 *
 * Repeats are refused rather than resolved. `readOption` takes the first match,
 * so `--set-visibility public --set-visibility private` runs one of them and
 * says nothing about which.
 *
 * A value option whose value is missing consumes nothing here, so the token
 * after it is still checked as an option and the missing value is caught by the
 * dedicated check rather than swallowed as this one's argument.
 *
 * A bare `--` is the package-manager separator, not an option.
 */
export function unknownOption(argv, known = KNOWN_OPTIONS, consumesValue = VALUE_CONSUMING_OPTIONS) {
  const seen = new Set();
  let index = 0;

  while (index < argv.length) {
    const token = argv[index];

    if (token === "--") {
      index += 1;
      continue;
    }

    if (!token.startsWith("--")) {
      return { name: token, reason: "positional" };
    }

    // `--target=prod` as well as `--target prod`. The shared target helper reads
    // both, so refusing the equals form here would reject a run the rest of the
    // script is perfectly happy with.
    //
    // Only for `--target`. Every other option is read by `readOption`, which
    // matches the flag exactly, so a `--reason=why` would reach the run with no
    // reason at all -- and letting it past this check to be dropped silently is
    // the failure this function exists to stop. Refused as unrecognized instead,
    // which at least says so.
    const inlineTarget = token.startsWith("--target=");
    const name = inlineTarget ? "--target" : token;

    if (!known.includes(name)) {
      return { name: token, reason: "unknown" };
    }

    // Keyed on the resolved name, so `--target prod --target=dev` is still one
    // option given twice.
    if (seen.has(name)) {
      return { name: token, reason: "repeated" };
    }

    seen.add(name);

    const value = argv[index + 1];

    index +=
      !inlineTarget &&
      consumesValue.includes(name) &&
      value !== undefined &&
      !value.startsWith("--")
        ? 2
        : 1;
  }

  return undefined;
}

/**
 * The first migration-only flag supplied without `--set-visibility`, if any.
 *
 * Refused rather than ignored. These two belong to the visibility migration, and
 * without `--set-visibility` the run silently becomes a bulk publication
 * instead -- so `--rederive-values --apply`, meant to replay values onto profiles
 * that are already live, would publish every pending candidate in the batch. A
 * typo that changes which operation runs is not a typo to absorb.
 */
export function misplacedMigrationFlag(visibility, supplied) {
  if (visibility !== undefined) {
    return undefined;
  }

  return Object.keys(supplied).find((name) => supplied[name]);
}

/**
 * The first publication-only flag supplied *with* `--set-visibility`, if any.
 *
 * The mirror of the check above, and refused for the same reason rather than
 * ignored. `--accept-fields` belongs to publication, where it patches unreviewed
 * fields to accepted on the way through. The visibility migration selects fields
 * that are already accepted and has no such step, so the flag was recognized,
 * dropped, and the run reported success -- having promised to accept unreviewed
 * fields and left every one of them alone.
 *
 * Refused rather than implemented. Accepting a field is a review decision, and
 * `--set-visibility` is already the most destructive thing this script does;
 * giving it the power to mark unreviewed source data accepted on the way past is
 * a different operation, and it should be asked for by name.
 */
export function misplacedPublishFlag(visibility, supplied) {
  if (visibility === undefined) {
    return undefined;
  }

  return Object.keys(supplied).find((name) => supplied[name]);
}

export function readOption(argv, name) {
  const index = argv.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];

  // A missing next token, or one that is itself a flag, means the operator omitted
  // the value. Returning it would record e.g. "--accept-fields" as the publication
  // reason and still pass the required-argument checks.
  return value === undefined || value.startsWith("--") ? undefined : value;
}

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

// Assigned at the start of main(), never at module scope: tests import
// readOption from this file, and resolving a target on import fails wherever
// there is no .env.local -- CI, for one.
let target;

function requireTarget() {
  const legacy = targetSelectorFlagError(args, SEED_SCRIPT_TARGET_HELP);

  if (legacy) {
    fail(legacy);
  }

  const requested = resolveTargetName(args);

  if (requested.error) {
    fail(requested.error);
  }

  const resolved = convexTargetEnv(requested.name);

  if (!resolved.ok) {
    fail(resolved.error);
  }

  console.error(`→ convex ${resolved.label} (${resolved.deployment})`);

  return resolved;
}

function runConvex(functionName, functionArgs) {
  const result = spawnSync(
    process.execPath,
    [convexCliPath, "run", functionName, JSON.stringify(functionArgs)],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: target.env,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    fail(
      `Convex call ${functionName} failed. Inspect deployment logs; source contents were not printed.\n${result.stderr ?? ""}`,
    );
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return fail(`Convex call ${functionName} succeeded but its output could not be parsed.`);
  }
}

function printPreview(preview) {
  console.log(`Batch ${preview.externalBatchId} (${preview.sourceName})`);
  console.log(`  batch review state:    ${preview.batchReviewState}`);
  console.log(`  publication policy:    ${preview.publicationPolicy}`);
  console.log(`  candidates:            ${preview.candidateCount}`);
  console.log(`  already published:     ${preview.alreadyPublishedCount}`);
  console.log(`  candidate review:      ${JSON.stringify(preview.candidateReviewStates)}`);
  console.log(`  candidate publication: ${JSON.stringify(preview.candidatePublicationStates)}`);
  console.log(`  candidate types:       ${JSON.stringify(preview.candidateProfileTypes)}`);
  console.log(`  fields:                ${preview.fieldCount}`);
  console.log(`  field review:          ${JSON.stringify(preview.fieldReviewStates)}`);
  console.log(`  accepted visibility:   ${JSON.stringify(preview.acceptedFieldVisibilities)}`);
  console.log(`  publicly visible:      ${preview.publiclyVisibleFieldCount}`);

  // The number that predicts whether anyone will see anything. A batch of
  // accepted fields that are all private publishes profiles holding a display
  // name and a slug, which is what happened to nwinn_2026_07_16_ad79dca17a.
  //
  // Keyed on the candidates the gate would actually refuse, not on the field
  // count. The gate exempts a merge into a profile the public can already read,
  // so a batch of those shows zero visible fields and publishes anyway -- and
  // recommending `--set-visibility` there would make imported private fields
  // public to fix nothing.
  if (preview.blockedOnNoVisibleFieldCount > 0) {
    console.log(
      `  warning: ${preview.blockedOnNoVisibleFieldCount} candidate(s) have no field anyone would see${
        preview.fieldStatsComplete ? "" : ` (of ${preview.fieldStatsSampledCandidates} sampled; there may be more)`
      }.`,
    );
    console.log(
      "  publication is blocked on no_publicly_visible_field for those; use --set-visibility first.",
    );
  } else if (preview.fieldCount > 0 && preview.publiclyVisibleFieldCount === 0) {
    // Both counters come from a sample, so "no candidate is blocked" is only
    // sayable when the sample was the whole batch. Otherwise the reassurance is
    // about the first fifty rows and reads as if it were about all of them --
    // which is worse than saying nothing, because it is the reader's cue to stop
    // checking.
    console.log(
      preview.fieldStatsComplete
        ? "  note: no accepted field is publicly visible, but every candidate merges into a profile that already is."
        : `  note: no accepted field is publicly visible in the first ${preview.fieldStatsSampledCandidates} candidates, and each of those merges into a profile that already is. Later candidates were not sampled.`,
    );
  }

  if (preview.candidateCountComplete === false) {
    console.log(
      `  note: candidate counts truncated at ${preview.candidateCount}; the batch holds more.`,
    );
  }

  if (preview.fieldStatsComplete === false) {
    console.log(
      `  note: field counts sampled from the first ${preview.fieldStatsSampledCandidates} of ${preview.candidateCount} candidates.`,
    );
  }
}

function reportSkipped(skipped) {
  const blockerCounts = {};

  for (const entry of skipped) {
    for (const blocker of entry.blockers) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }

  console.log("Skipped by blocker:");
  for (const [blocker, count] of Object.entries(blockerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${blocker}: ${count}`);
  }

  console.log("Skipped candidates:");
  for (const entry of skipped) {
    console.log(`  ${entry.externalCandidateId}: ${entry.blockers.join(", ")}`);
  }
}

function setFieldVisibility({ batchId, visibility, reason, reviewer, limit }) {
  const fieldKeysOption = option("--field-keys");

  // A missing value is refused up front by `VALUE_OPTIONS`, so reaching here
  // with `undefined` means the flag was genuinely absent: restrict nothing, on
  // purpose. Read the other way, `--set-visibility public --field-keys --apply`
  // would set *every* accepted field in the batch public.
  const fieldKeys = fieldKeysOption
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (fieldKeysOption !== undefined && (fieldKeys === undefined || fieldKeys.length === 0)) {
    fail("--field-keys needs at least one comma-separated field key.");
  }

  const dryRun = !flag("--apply");
  let processedTotal = 0;
  let fieldsChangedTotal = 0;
  let profilesRederivedTotal = 0;
  let linksDroppedTotal = 0;
  let linksDeduplicatedTotal = 0;
  let cursor;
  let simulatedProfiles = [];
  let simulationComplete = true;
  const skipped = [];

  console.log("");

  for (;;) {
    const page = runConvex("seedImports:bulkSetFieldVisibility", {
      externalBatchId: batchId,
      visibility,
      reason,
      reviewer,
      dryRun,
      limit,
      rederiveValues: flag("--rederive-values"),
      ...(fieldKeys === undefined ? {} : { fieldKeys }),
      ...(cursor === undefined || cursor === null ? {} : { cursor }),
      ...(simulatedProfiles.length === 0 ? {} : { simulatedProfiles }),
    });

    // Carried into the next page so one merged profile is not counted once per
    // page, and so a dry run's suppression recheck sees what the earlier page
    // decided rather than the row as it stood before the run. Several candidates
    // can publish to the same profile, and an applied run's later page reads the
    // earlier patch where a dry run has nothing to read.
    //
    // The mutation returns an empty array where none of this changes an answer,
    // which is every applied run that is not re-deriving values, so the usual
    // production migration carries nothing between pages at all.
    simulatedProfiles = page.simulatedProfiles ?? simulatedProfiles;
    simulationComplete = simulationComplete && page.simulationComplete !== false;

    processedTotal += page.processed;
    fieldsChangedTotal += page.fieldsChanged;
    profilesRederivedTotal += page.profilesRederived;
    linksDroppedTotal += page.linksDropped;
    linksDeduplicatedTotal += page.linksDeduplicated;
    skipped.push(...page.skipped);

    console.log(`  fields ${fieldsChangedTotal}, profiles ${profilesRederivedTotal}`);

    if (page.isDone || page.nextCursor === null || page.nextCursor === undefined) {
      break;
    }

    cursor = page.nextCursor;
  }

  const rederiveValues = flag("--rederive-values");

  console.log(
    `\n${dryRun ? "Would set" : "Set"} ${fieldsChangedTotal} accepted fields to ${visibility} across ${processedTotal} candidates, ` +
      `updating ${profilesRederivedTotal} published profiles ` +
      `(${rederiveValues ? "visibility and values" : "visibility only"}).`,
  );

  // Reported every run, including zero, and on a visibility-only run too: it is
  // what a value re-derivation *would* do to the links, which is the number an
  // operator needs before deciding to ask for one.
  console.log(
    `Links: ${linksDeduplicatedTotal} would collapse onto an existing link, ${linksDroppedTotal} could not be normalized.`,
  );

  if (skipped.length > 0) {
    console.log("Profiles left alone:");
    for (const entry of skipped) {
      console.log(`  ${entry.externalCandidateId}: ${entry.reason}`);
    }
  }

  // Said out loud, because past the bound these numbers stop being the promise
  // the runbook makes about them. The state a page carries forward is the one
  // part of the call that grows with the batch rather than the page, so it is
  // capped; a batch large enough to reach the cap gets a warning rather than a
  // total that quietly drifted from what the write will do.
  if (!simulationComplete) {
    console.log(
      "\nWarning: this batch has more distinct published profiles than the run carries\n" +
        "between pages, so the totals above are approximate. Past that point a profile\n" +
        "two candidates share can be counted twice, and a suppression skip can be\n" +
        "reported that the apply would not hit.\n" +
        "\n" +
        "--limit does not help: the carry holds every distinct profile seen so far, not\n" +
        "one entry per page, and the mutation clamps the page size regardless. What the\n" +
        "numbers say about the writes is unchanged -- an applied run reads back what it\n" +
        "wrote, so it is the reporting that degrades here and not the migration.",
    );
  }

  if (dryRun) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to write.");
  }
}

function main() {
  target = requireTarget();

  // Before anything reads an option, because what this catches is a run doing
  // something other than what was typed. Every other check here assumes the
  // options it is looking at are the ones the operator meant.
  const badOption = unknownOption(args);

  if (badOption !== undefined) {
    const complaint = {
      unknown: `Unknown option ${badOption.name}.`,
      repeated: `${badOption.name} was given more than once.`,
      positional: `Unexpected argument ${badOption.name}. Options need their leading --.`,
    }[badOption.reason];

    fail(`${complaint}\n\n${USAGE}`);
  }

  const batchId = option("--batch-id");

  if (!batchId) {
    fail(USAGE);
  }

  // Every option that takes a value, checked once rather than one at a time.
  // `readOption` returns undefined both for an absent flag and for one whose
  // value is missing or itself flag-shaped, and for a mode selector those mean
  // opposite things: `--set-visibility --apply` read as "no visibility mode"
  // falls through to a bulk publication and publishes pending candidates, when
  // the operator was asking to migrate visibility and only forgot to say to
  // what. `--field-keys` had the same hole; naming them together is what stops
  // the next one being found the same way.
  for (const name of VALUE_OPTIONS) {
    if (flag(name) && option(name) === undefined) {
      fail(`${name} needs a value.\n\n${USAGE}`);
    }
  }

  const visibility = option("--set-visibility");

  if (visibility !== undefined && !FIELD_VISIBILITIES.includes(visibility)) {
    fail(`--set-visibility must be one of ${FIELD_VISIBILITIES.join(", ")}.`);
  }

  const misplacedFlag = misplacedMigrationFlag(visibility, {
    "--rederive-values": flag("--rederive-values"),
    // `flag`, not `option`: `--field-keys` with a missing value still means the
    // operator asked for it, and reading that as absent would let the misplaced
    // form through to a bulk publication.
    "--field-keys": flag("--field-keys"),
  });

  if (misplacedFlag) {
    fail(`${misplacedFlag} only applies with --set-visibility.\n\n${USAGE}`);
  }

  const misplacedPublishOnlyFlag = misplacedPublishFlag(visibility, {
    "--accept-fields": flag("--accept-fields"),
  });

  if (misplacedPublishOnlyFlag) {
    fail(`${misplacedPublishOnlyFlag} does not apply with --set-visibility.\n\n${USAGE}`);
  }

  printPreview(runConvex("seedImports:previewBatchPublication", { externalBatchId: batchId }));

  if (visibility === undefined && !flag("--apply")) {
    console.log("\nPreview only. Nothing was written. Re-run with --apply to publish.");
    return;
  }

  const actorToken = option("--actor-token");
  const actorIssuer = option("--actor-issuer");
  const actorSubject = option("--actor-subject");
  const actorName = option("--actor-name");
  const reason = option("--reason");

  if (!actorToken || !actorIssuer || !actorSubject) {
    fail(`This run requires actor identity.\n\n${USAGE}`);
  }

  if (!reason) {
    fail(`This run requires --reason recording the decision.\n\n${USAGE}`);
  }

  const limitOption = option("--limit");
  const limit = limitOption === undefined ? 25 : Number.parseInt(limitOption, 10);

  if (!Number.isInteger(limit) || limit < 1) {
    fail("--limit must be a positive integer.");
  }

  const reviewer = {
    tokenIdentifier: actorToken,
    issuer: actorIssuer,
    subject: actorSubject,
    ...(actorName ? { displayName: actorName } : {}),
  };

  if (visibility !== undefined) {
    setFieldVisibility({ batchId, visibility, reason, reviewer, limit });
    return;
  }

  let publishedTotal = 0;
  let processedTotal = 0;
  let linksDroppedTotal = 0;
  let linksDeduplicatedTotal = 0;
  let cursor;
  const skipped = [];

  console.log("");

  for (;;) {
    const page = runConvex("seedImports:bulkPublishBatch", {
      externalBatchId: batchId,
      reason,
      acceptFields: flag("--accept-fields"),
      limit,
      reviewer,
      ...(cursor === undefined || cursor === null ? {} : { cursor }),
    });

    publishedTotal += page.published;
    processedTotal += page.processed;
    linksDroppedTotal += page.linksDropped ?? 0;
    linksDeduplicatedTotal += page.linksDeduplicated ?? 0;
    skipped.push(...page.skipped);

    console.log(`  published ${publishedTotal}, skipped ${skipped.length}`);

    if (page.haltedByPolicyChange) {
      console.log(
        "  halted: the batch policy or review state changed mid-run, so publication stopped.",
      );
      break;
    }

    if (page.isDone) {
      break;
    }

    // The cursor always advances past the page just read, so a batch where every
    // candidate is blocked still terminates instead of re-reading page one.
    if (page.nextCursor === null || page.nextCursor === undefined) {
      break;
    }

    cursor = page.nextCursor;
  }

  console.log(
    `\nProcessed ${processedTotal} candidates: published ${publishedTotal}, skipped ${skipped.length}.`,
  );
  // Said out loud even at zero. An accepted link that normalization discards does
  // not block publication when the candidate has other visible content, so the
  // run would otherwise report a clean publish over data it had thrown away --
  // which is the failure this whole slice exists to stop repeating.
  console.log(
    `Links: ${linksDeduplicatedTotal} collapsed onto an existing link, ${linksDroppedTotal} could not be normalized.`,
  );

  if (skipped.length > 0) {
    reportSkipped(skipped);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath?.toLowerCase() === scriptPath.toLowerCase()) {
  main();
}
