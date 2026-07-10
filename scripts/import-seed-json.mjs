import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const file = option("--file");
const actorToken = option("--actor-token");
const actorIssuer = option("--actor-issuer");
const actorSubject = option("--actor-subject");
const actorName = option("--actor-name");

if (!file || !actorToken || !actorIssuer || !actorSubject) {
  fail(
    "Usage: pnpm ops:seed-import:json -- --file <outside-repo.json> --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--actor-name <name>] [--prod|--preview-name <name>]",
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

if (payload === null || typeof payload !== "object" || payload.permissioned !== true) {
  fail("Seed import JSON must explicitly set permissioned to true.");
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  fail("Run this operator command through pnpm so the pinned package manager is used.");
}

const convexArgs = ["exec", "convex", "run"];
if (args.includes("--prod")) {
  convexArgs.push("--prod");
}
const previewName = option("--preview-name");
if (previewName) {
  convexArgs.push("--preview-name", previewName);
}
convexArgs.push(
  "seedImports:importPermissionedJsonBatch",
  JSON.stringify({
    payload,
    importedBy: {
      tokenIdentifier: actorToken,
      issuer: actorIssuer,
      subject: actorSubject,
      ...(actorName ? { displayName: actorName } : {}),
    },
  }),
);

const result = spawnSync(process.execPath, [npmExecPath, ...convexArgs], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  windowsHide: true,
});

if (result.status !== 0) {
  fail("Seed import failed. Inspect Convex deployment logs; source contents were not printed.");
}

let summary;
try {
  summary = JSON.parse(result.stdout.trim());
} catch {
  fail("Seed import completed but its redacted summary could not be parsed.");
}

console.log(
  summary.inserted
    ? `Seed import inserted ${summary.candidateCount} candidates and ${summary.fieldCount} fields.`
    : "Seed import already exists; no records were written.",
);
