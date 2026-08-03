import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONVEX_TARGET_NAMES, convexCliPath, convexTargetEnv } from "./convex-target.ts";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);

export const MAX_CONVEX_IMPORT_ARGS_BYTES = 20_000;

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Resolved before any file reading, so a mistyped target fails before the
// script touches the seed source at all.
const target = convexTargetEnv(option("--target") ?? "local");

if (!target.ok) {
  fail(target.error);
}

console.error(`→ convex ${target.label} (${target.deployment})`);

function serializedByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function chunkPermissionedSeedImport(
  payload,
  importedBy,
  maxArgsBytes = MAX_CONVEX_IMPORT_ARGS_BYTES,
) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.permissioned !== true ||
    !Array.isArray(payload.candidates)
  ) {
    throw new Error("Seed import JSON must contain a permissioned candidate array.");
  }

  if (payload.candidates.length === 0 || payload.candidates.length > 5_000) {
    throw new Error("Seed import JSON must contain 1 to 5000 candidates.");
  }

  const candidateIds = new Set();
  for (const candidate of payload.candidates) {
    const candidateId = candidate?.candidateId;
    if (typeof candidateId !== "string" || !candidateId.trim()) {
      throw new Error("Every seed candidate requires a candidateId.");
    }
    if (candidateIds.has(candidateId)) {
      throw new Error(`Duplicate seed candidate id "${candidateId}".`);
    }
    candidateIds.add(candidateId);
  }

  const { candidates, ...metadata } = payload;
  const chunks = [];
  let currentCandidates = [];

  function mutationArgs(chunkCandidates) {
    return {
      payload: { ...metadata, candidates: chunkCandidates },
      importedBy,
    };
  }

  for (const candidate of candidates) {
    const proposedCandidates = [...currentCandidates, candidate];
    const proposedArgs = mutationArgs(proposedCandidates);

    if (serializedByteLength(proposedArgs) <= maxArgsBytes) {
      currentCandidates = proposedCandidates;
      continue;
    }

    if (currentCandidates.length === 0) {
      throw new Error(
        `Seed candidate "${candidate.candidateId}" exceeds the safe Convex CLI argument limit.`,
      );
    }

    chunks.push(mutationArgs(currentCandidates));
    currentCandidates = [candidate];

    if (serializedByteLength(mutationArgs(currentCandidates)) > maxArgsBytes) {
      throw new Error(
        `Seed candidate "${candidate.candidateId}" exceeds the safe Convex CLI argument limit.`,
      );
    }
  }

  if (currentCandidates.length > 0) {
    chunks.push(mutationArgs(currentCandidates));
  }

  return chunks;
}

function runConvexMutation(mutationArgs) {
  return spawnSync(
    process.execPath,
    [
      convexCliPath,
      "run",
      "seedImports:importPermissionedJsonBatch",
      JSON.stringify(mutationArgs),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: target.env,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
}

function main() {
  const file = option("--file");
  const actorToken = option("--actor-token");
  const actorIssuer = option("--actor-issuer");
  const actorSubject = option("--actor-subject");
  const actorName = option("--actor-name");

  if (!file || !actorToken || !actorIssuer || !actorSubject) {
    fail(
      `Usage: pnpm ops:seed-import:json -- --file <outside-repo.json> --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] [--target <${CONVEX_TARGET_NAMES.join("|")}>]`,
    );
  }

  const inputPath = path.resolve(file);
  const relativeInputPath = path.relative(repoRoot, inputPath);
  if (!relativeInputPath.startsWith("..") && !path.isAbsolute(relativeInputPath)) {
    fail("Seed import files must live outside the repository.");
  }

  if (path.extname(inputPath).toLowerCase() !== ".json") {
    fail("Seed import input must be a JSON file.");
  }

  let payload;
  try {
    const stats = statSync(inputPath);
    if (!stats.isFile() || stats.size > 10 * 1024 * 1024) {
      fail("Seed import input must be a file no larger than 10 MiB.");
    }
    payload = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch {
    fail("Unable to read and parse the seed import JSON file.");
  }

  const importedBy = {
    tokenIdentifier: actorToken,
    issuer: actorIssuer,
    subject: actorSubject,
    ...(actorName ? { displayName: actorName } : {}),
  };

  let chunks;
  try {
    chunks = chunkPermissionedSeedImport(payload, importedBy);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Seed import JSON is invalid.");
  }

  let insertedCandidates = 0;
  let skippedCandidates = 0;
  let insertedFields = 0;

  for (const [index, mutationArgs] of chunks.entries()) {
    const result = runConvexMutation(mutationArgs);
    if (result.status !== 0) {
      fail(
        `Seed import failed in chunk ${index + 1} of ${chunks.length}. Inspect Convex deployment logs; source contents were not printed.`,
      );
    }

    let summary;
    try {
      summary = JSON.parse(result.stdout.trim());
    } catch {
      fail(`Seed import chunk ${index + 1} completed but its redacted summary could not be parsed.`);
    }

    insertedCandidates += summary.candidateCount ?? 0;
    skippedCandidates += summary.skippedCandidateCount ?? 0;
    insertedFields += summary.fieldCount ?? 0;
  }

  console.log(
    `Seed import processed ${payload.candidates.length} candidates in ${chunks.length} chunks; inserted ${insertedCandidates} candidates and ${insertedFields} fields, skipped ${skippedCandidates} existing candidates.`,
  );
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (entryPath?.toLowerCase() === scriptPath.toLowerCase()) {
  main();
}
