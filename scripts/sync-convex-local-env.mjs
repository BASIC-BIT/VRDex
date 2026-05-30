import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexHome = path.join(repoRoot, ".convex-home");
const convexTmp = path.join(repoRoot, ".convex-tmp");
const localConvexEnvNames = ["VRDEX_ENABLE_E2E_HELPERS", "VRDEX_E2E_CONVEX_SECRET"];
const localDeploymentName = process.env.CONVEX_LOCAL_DEPLOYMENT_NAME || "anonymous-agent";
const localCloudPort = process.env.CONVEX_LOCAL_CLOUD_PORT || "3210";
const localConvexUrl = process.env.CONVEX_LOCAL_URL || `http://127.0.0.1:${localCloudPort}`;
const convexBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);

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

function syncEnvVarsOnce() {
  const entries = localConvexEnvNames
    .map((name) => [name, process.env[name]])
    .filter((entry) => entry[1] !== undefined && entry[1] !== "");

  for (const [name, value] of entries) {
    const result = spawnSync(convexBin, ["env", "set", name, value], {
      cwd: repoRoot,
      encoding: "utf8",
      env: convexEnv(),
      shell: process.platform === "win32",
    });

    if (result.status !== 0) {
      return false;
    }
  }

  return true;
}

if (!localConvexEnvNames.some((name) => process.env[name])) {
  process.exit(0);
}

mkdirSync(convexHome, { recursive: true });
mkdirSync(convexTmp, { recursive: true });

for (let attempt = 0; attempt < 80; attempt += 1) {
  if (syncEnvVarsOnce()) {
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
}

console.error("Failed to sync E2E helper env vars into the local Convex deployment.");
process.exit(1);
