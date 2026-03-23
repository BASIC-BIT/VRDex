import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexHome = path.join(repoRoot, ".convex-home");
const convexTmp = path.join(repoRoot, ".convex-tmp");
const repoEnvLocalPath = path.join(repoRoot, ".env.local");
const webEnvLocalPath = path.join(repoRoot, "apps", "web", ".env.local");
const args = process.argv.slice(2);

function syncPublicConvexUrl() {
  if (!existsSync(repoEnvLocalPath)) {
    return;
  }

  const file = readFileSync(repoEnvLocalPath, "utf8");
  const lines = file.split(/\r?\n/);
  const convexUrlLine = lines.find((line) => line.startsWith("CONVEX_URL="));

  if (!convexUrlLine) {
    return;
  }

  const convexUrl = convexUrlLine
    .slice("CONVEX_URL=".length)
    .split("#")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");

  if (!convexUrl) {
    return;
  }

  const nextPublicLine = `NEXT_PUBLIC_CONVEX_URL=${convexUrl}`;

  if (existsSync(webEnvLocalPath)) {
    const currentWebEnv = readFileSync(webEnvLocalPath, "utf8");
    const currentLines = currentWebEnv.split(/\r?\n/);

    if (currentLines.some((line) => line === nextPublicLine)) {
      return;
    }

    const mergedLines = currentLines.filter(
      (line) => !line.startsWith("NEXT_PUBLIC_CONVEX_URL="),
    );

    mergedLines.push(nextPublicLine);
    writeFileSync(webEnvLocalPath, `${mergedLines.join("\n")}\n`);
    return;
  }

  writeFileSync(webEnvLocalPath, `${nextPublicLine}\n`);
}

if (args.length === 0) {
  console.error("Usage: node scripts/run-convex-local.mjs <convex args>");
  process.exit(1);
}

try {
  mkdirSync(convexHome, { recursive: true });
  mkdirSync(convexTmp, { recursive: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `Failed to create Convex isolation directories (${convexHome}, ${convexTmp}): ${message}`,
  );
  process.exit(1);
}

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
    TMPDIR: convexTmp,
    TEMP: convexTmp,
    TMP: convexTmp,
    // Isolate anonymous Convex state from the user's real home directory.
    // This also affects subprocesses spawned by the Convex CLI.
    HOME: convexHome,
    USERPROFILE: convexHome,
    XDG_CONFIG_HOME: path.join(convexHome, ".config"),
    XDG_DATA_HOME: path.join(convexHome, ".local", "share"),
    XDG_CACHE_HOME: path.join(convexHome, ".cache"),
    XDG_STATE_HOME: path.join(convexHome, ".local", "state"),
  },
});

syncPublicConvexUrl();

let publicUrlWatcher;

try {
  publicUrlWatcher = watch(repoEnvLocalPath, () => {
    try {
      syncPublicConvexUrl();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to mirror NEXT_PUBLIC_CONVEX_URL: ${message}`);
    }
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  try {
    publicUrlWatcher = watch(repoRoot, (_eventType, filename) => {
      if (filename !== ".env.local") {
        return;
      }

      try {
        syncPublicConvexUrl();
      } catch (watchError) {
        const watchMessage =
          watchError instanceof Error ? watchError.message : String(watchError);
        console.error(`Failed to mirror NEXT_PUBLIC_CONVEX_URL: ${watchMessage}`);
      }
    });
  } catch {
    console.error(
      `Failed to watch .env.local for NEXT_PUBLIC_CONVEX_URL sync: ${message}`,
    );
  }
}

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => {
  forwardSignal("SIGINT");
});

process.on("SIGTERM", () => {
  forwardSignal("SIGTERM");
});

child.on("error", (error) => {
  const code = error.code ? ` [${error.code}]` : "";
  console.error(`Failed to spawn Convex CLI (${convexBin})${code}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  publicUrlWatcher?.close();

  try {
    syncPublicConvexUrl();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to finalize NEXT_PUBLIC_CONVEX_URL mirror: ${message}`);
  }

  if (signal) {
    if (process.platform !== "win32") {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(1);
    return;
  }

  process.exit(code ?? 1);
});
