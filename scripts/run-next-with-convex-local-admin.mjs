import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const webRoot = path.join(repoRoot, "apps", "web");
const deploymentName = process.env.CONVEX_LOCAL_DEPLOYMENT_NAME || "anonymous-agent";
const configCandidates = [
  path.join(repoRoot, ".convex", "local", "default", "config.json"),
  path.join(
    repoRoot,
    ".convex-home",
    ".convex",
    "anonymous-convex-backend-state",
    deploymentName,
    "config.json",
  ),
];

function localAdminKey() {
  const configPath = configCandidates.find((candidate) => existsSync(candidate));

  if (configPath === undefined) {
    throw new Error(`Local Convex deployment config was not found at ${configCandidates.join(" or ")}.`);
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));

  if (typeof config.adminKey !== "string" || config.adminKey.trim() === "") {
    throw new Error(`Local Convex deployment config at ${configPath} does not contain an admin key.`);
  }

  return config.adminKey.trim();
}

const nextArgs = process.argv.slice(2);

if (nextArgs.length === 0) {
  console.error("Usage: node scripts/run-next-with-convex-local-admin.mjs <next args>");
  process.exit(1);
}

let adminKey;

try {
  adminKey = localAdminKey();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: webRoot,
  env: { ...process.env, CONVEX_ADMIN_TOKEN: adminKey },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.once("error", (error) => {
  console.error(`Failed to start Next.js: ${error.message}`);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  process.exit(signal === null ? (code ?? 1) : 1);
});
