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
  "",
  "Sets the stored visibility of a batch's accepted fields and re-derives every",
  "profile already published from them. Publication copies each field's",
  "visibility onto the profile, so a batch imported private publishes profiles",
  "that show nothing. Without --apply this runs as a dry run and writes nothing.",
].join("\n");

const FIELD_VISIBILITIES = ["public", "unlisted", "private"];

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
  if (preview.fieldCount > 0 && preview.publiclyVisibleFieldCount === 0) {
    console.log(
      "  warning: no accepted field would be visible. Publication is blocked on no_publicly_visible_field; use --set-visibility first.",
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
      ...(fieldKeys === undefined ? {} : { fieldKeys }),
      ...(cursor === undefined || cursor === null ? {} : { cursor }),
    });

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

  console.log(
    `\n${dryRun ? "Would set" : "Set"} ${fieldsChangedTotal} accepted fields to ${visibility} across ${processedTotal} candidates, ` +
      `re-deriving ${profilesRederivedTotal} published profiles.`,
  );

  // Reported every run, including zero. A re-derivation that silently discarded
  // a stream link would otherwise be indistinguishable from one that carried it.
  console.log(
    `Links: ${linksDeduplicatedTotal} collapsed onto an existing link, ${linksDroppedTotal} could not be normalized.`,
  );

  if (skipped.length > 0) {
    console.log("Profiles left alone:");
    for (const entry of skipped) {
      console.log(`  ${entry.externalCandidateId}: ${entry.reason}`);
    }
  }

  if (dryRun) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to write.");
  }
}

function main() {
  target = requireTarget();

  const batchId = option("--batch-id");

  if (!batchId) {
    fail(USAGE);
  }

  const visibility = option("--set-visibility");

  if (visibility !== undefined && !FIELD_VISIBILITIES.includes(visibility)) {
    fail(`--set-visibility must be one of ${FIELD_VISIBILITIES.join(", ")}.`);
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

  if (skipped.length > 0) {
    reportSkipped(skipped);
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath?.toLowerCase() === scriptPath.toLowerCase()) {
  main();
}
