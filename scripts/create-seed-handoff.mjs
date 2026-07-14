import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexCliPath = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const candidateId = option("--candidate-id");
const fieldIds = option("--field-ids")
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean) ?? [];
const profileId = option("--profile-id");
const actorToken = option("--actor-token");
const actorIssuer = option("--actor-issuer");
const actorSubject = option("--actor-subject");
const actorName = option("--actor-name");
const baseUrl = option("--base-url");
const expiresInHours = Number(option("--expires-in-hours") ?? "72");

if (!candidateId || !actorToken || !actorIssuer || !actorSubject) {
  fail(
    "Usage: pnpm ops:seed-handoff:create -- --candidate-id <id> --actor-token <id> --actor-issuer <issuer> --actor-subject <subject> [--field-ids <id,id>] [--profile-id <id>] [--expires-in-hours <hours>] [--base-url <url>] [--prod|--deployment <name>]",
  );
}

if (!Number.isFinite(expiresInHours) || expiresInHours <= 0 || expiresInHours > 2160) {
  fail("Handoff expiry must be between 0 and 2160 hours.");
}

const token = randomBytes(32).toString("base64url");
const convexArgs = ["run"];
if (args.includes("--prod")) {
  convexArgs.push("--prod");
}
const deployment = option("--deployment");
if (deployment) {
  convexArgs.push("--deployment", deployment);
}
convexArgs.push(
  "seedHandoffs:createInvitation",
  JSON.stringify({
    token,
    candidateId,
    offeredFieldIds: fieldIds,
    ...(profileId ? { profileId } : {}),
    expiresAt: Date.now() + expiresInHours * 60 * 60 * 1_000,
    createdBy: {
      tokenIdentifier: actorToken,
      issuer: actorIssuer,
      subject: actorSubject,
      ...(actorName ? { displayName: actorName } : {}),
    },
  }),
);

const result = spawnSync(process.execPath, [convexCliPath, ...convexArgs], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  windowsHide: true,
});

if (result.status !== 0) {
  fail("Handoff invitation creation failed. No token was stored or printed.");
}

const normalizedBaseUrl = baseUrl?.replace(/\/$/, "");
console.log(
  normalizedBaseUrl
    ? `${normalizedBaseUrl}/handoff/${token}`
    : `Handoff token (displayed once): ${token}`,
);
