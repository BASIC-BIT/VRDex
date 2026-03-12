import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexHome = path.join(repoRoot, ".convex-home");
const convexTmp = path.join(repoRoot, ".convex-tmp");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/run-convex-local.mjs <convex args>");
  process.exit(1);
}

mkdirSync(convexHome, { recursive: true });
mkdirSync(convexTmp, { recursive: true });

const convexBin = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "convex.cmd" : "convex",
);

const child = spawn(convexBin, args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    // Belt-and-suspenders fallback in case a future script invocation omits
    // `--local` and would otherwise try to prompt for cloud auth.
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_TMPDIR: convexTmp,
    // Isolate anonymous Convex state from the user's real home directory.
    // This also affects subprocesses spawned by the Convex CLI.
    HOME: convexHome,
    USERPROFILE: convexHome,
  },
});

child.on("error", (error) => {
  const code = error.code ? ` [${error.code}]` : "";
  console.error(`Failed to spawn Convex CLI (${convexBin})${code}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
