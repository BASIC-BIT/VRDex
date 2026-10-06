import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { convexCliPath, convexTargetEnv, resolveTargetName } from "./convex-target.ts";
import { readOption, unknownOption } from "./publish-seed-batch.mjs";

export function migrationInput(args) {
  const values = ["--target", "--cursor", "--limit", "--correction-file"];
  if (unknownOption(args, [...values, "--apply"], values)) throw new Error("Unknown or repeated migration option.");
  const file = readOption(args, "--correction-file");
  const dryRun = !args.includes("--apply");
  if (file) return { operation: "correctPrimaryToKit", input: { ...JSON.parse(readFileSync(file, "utf8")), dryRun } };
  const limit = Number(readOption(args, "--limit") ?? 40);
  if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw new Error("Migration limit must be 1..40.");
  return { operation: "convertBatch", input: { dryRun, cursor: readOption(args, "--cursor") ?? null, limit } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const command = migrationInput(args);
  const requested = resolveTargetName(args);
  if (requested.error) throw new Error(requested.error);
  const target = convexTargetEnv(requested.name);
  if (!target.ok) throw new Error(target.error);
  console.error(`convex ${target.label} (${target.deployment}), ${command.input.dryRun ? "dry-run" : "apply"}`);
  const result = spawnSync(process.execPath, [convexCliPath, "run", `mediaKitPublicationMigration:${command.operation}`, JSON.stringify(command.input)],
    { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), env: target.env, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || "Migration operation failed.");
  console.log(result.stdout.trim());
}
