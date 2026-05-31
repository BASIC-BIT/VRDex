import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexHome = path.join(repoRoot, ".convex-home");
const convexTmp = path.join(repoRoot, ".convex-tmp");
const localConvexEnvNames = [
  "SITE_URL",
  "JWT_PRIVATE_KEY",
  "JWKS",
  "VRDEX_ENABLE_E2E_HELPERS",
  "VRDEX_ENABLE_E2E_AUTH_HELPERS",
  "VRDEX_E2E_CONVEX_SECRET",
];
const localDeploymentName = process.env.CONVEX_LOCAL_DEPLOYMENT_NAME || "anonymous-agent";
const localCloudPort = process.env.CONVEX_LOCAL_CLOUD_PORT || "3210";
const localConvexUrl = process.env.CONVEX_LOCAL_URL || `http://127.0.0.1:${localCloudPort}`;
const readyTimeoutMs = Number(process.env.CONVEX_LOCAL_READY_TIMEOUT_MS || 180_000);
const readyPollMs = Number(process.env.CONVEX_LOCAL_READY_POLL_MS || 500);
const healthStatus = makeFunctionReference("health:status");
const convexCli = path.join(repoRoot, "node_modules", "convex", "bin", "main.js");

function convexEnv() {
  return {
    ...process.env,
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_DEPLOYMENT: `local:${localDeploymentName}`,
    CONVEX_DEPLOY_KEY: "",
    CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    CONVEX_SELF_HOSTED_URL: "",
    CONVEX_URL: localConvexUrl,
    CONVEX_TMPDIR: convexTmp,
    TMPDIR: convexTmp,
    TEMP: convexTmp,
    TMP: convexTmp,
    HOME: convexHome,
    USERPROFILE: convexHome,
    XDG_CONFIG_HOME: path.join(convexHome, ".config"),
    XDG_DATA_HOME: path.join(convexHome, ".local", "share"),
    XDG_CACHE_HOME: path.join(convexHome, ".cache"),
    XDG_STATE_HOME: path.join(convexHome, ".local", "state"),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runConvex(args) {
  return spawnSync(process.execPath, [convexCli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: convexEnv(),
    timeout: 10_000,
  });
}

async function waitForFunctionsReady() {
  const startedAt = Date.now();
  let lastError = "Convex functions are not ready yet.";
  const client = new ConvexHttpClient(localConvexUrl);

  while (Date.now() - startedAt < readyTimeoutMs) {
    try {
      await client.query(healthStatus, {});
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await sleep(readyPollMs);
  }

  console.error(`Timed out waiting for local Convex functions to become ready: ${lastError}`);
  return false;
}

function syncEnvVarsOnce() {
  const entries = localConvexEnvNames
    .map((name) => [name, process.env[name]])
    .filter((entry) => entry[1] !== undefined && entry[1] !== "");

  for (const [name, value] of entries) {
    const result = spawnSync(process.execPath, [convexCli, "env", "set", name], {
      cwd: repoRoot,
      encoding: "utf8",
      env: convexEnv(),
      input: value,
    });

    if (result.status !== 0) {
      return { ok: false, name, result };
    }
  }

  return { ok: true };
}

if (!(await waitForFunctionsReady())) {
  process.exit(1);
}

if (!localConvexEnvNames.some((name) => process.env[name])) {
  process.exit(0);
}

mkdirSync(convexHome, { recursive: true });
mkdirSync(convexTmp, { recursive: true });

let lastFailure;
for (let attempt = 0; attempt < 80; attempt += 1) {
  const syncResult = syncEnvVarsOnce();
  if (syncResult.ok) {
    process.exit(0);
  }

  lastFailure = syncResult;

  await new Promise((resolve) => setTimeout(resolve, 250));
}

console.error("Failed to sync E2E helper env vars into the local Convex deployment.");
if (lastFailure) {
  const output = `${lastFailure.result.stdout || ""}${lastFailure.result.stderr || ""}`.trim();
  console.error(`Last failed variable: ${lastFailure.name}`);
  if (lastFailure.result.error) {
    console.error(lastFailure.result.error.message);
  }
  if (output) {
    console.error(output);
  }
}
process.exit(1);
