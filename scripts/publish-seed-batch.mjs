import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");
const args = process.argv.slice(2);

const USAGE = [
  "Usage: pnpm ops:seed-publish -- --batch-id <external-batch-id> \\",
  "  --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] \\",
  "  [--reason <why the source permits publication>] [--accept-fields] [--limit <n>] [--apply] \\",
  "  [--prod|--deployment <name>]",
  "",
  "Without --apply this prints a read-only preview and writes nothing.",
  "--accept-fields accepts fields still marked unreviewed. Rejected and",
  "needs-correction fields are always left alone.",
].join("\n");

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function flag(name) {
  return args.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function runConvex(functionName, functionArgs) {
  const convexArgs = ["run"];

  if (flag("--prod")) {
    convexArgs.push("--prod");
  }

  const deployment = option("--deployment");
  if (deployment) {
    convexArgs.push("--deployment", deployment);
  }

  convexArgs.push(functionName, JSON.stringify(functionArgs));

  const result = spawnSync(process.execPath, [convexCliPath, ...convexArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });

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

function main() {
  const batchId = option("--batch-id");

  if (!batchId) {
    fail(USAGE);
  }

  printPreview(runConvex("seedImports:previewBatchPublication", { externalBatchId: batchId }));

  if (!flag("--apply")) {
    console.log("\nPreview only. Nothing was written. Re-run with --apply to publish.");
    return;
  }

  const actorToken = option("--actor-token");
  const actorIssuer = option("--actor-issuer");
  const actorSubject = option("--actor-subject");
  const actorName = option("--actor-name");
  const reason = option("--reason");

  if (!actorToken || !actorIssuer || !actorSubject) {
    fail(`--apply requires actor identity.\n\n${USAGE}`);
  }

  if (!reason) {
    fail(`--apply requires --reason recording why the source permits publication.\n\n${USAGE}`);
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
