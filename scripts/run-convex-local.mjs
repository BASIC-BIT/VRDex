import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const convexHome = path.join(repoRoot, ".convex-home");
const convexTmp = path.join(repoRoot, ".convex-tmp");
const repoEnvLocalPath = path.join(repoRoot, ".env.local");
const webEnvLocalPath = path.join(repoRoot, "apps", "web", ".env.local");
const args = process.argv.slice(2);
const usesLocalDeployment = args.includes("--local");
const isLocalDevCommand = args[0] === "dev" && usesLocalDeployment;
const localDeploymentName = process.env.CONVEX_LOCAL_DEPLOYMENT_NAME || "anonymous-agent";
const localCloudPort = process.env.CONVEX_LOCAL_CLOUD_PORT || "3210";
const localSitePort = process.env.CONVEX_LOCAL_SITE_PORT || "3211";
const localConvexUrl = process.env.CONVEX_LOCAL_URL || `http://127.0.0.1:${localCloudPort}`;
const shouldRestoreRepoEnvLocal = usesLocalDeployment && (!process.stdin.isTTY || process.env.CI === "true");
const repoEnvLocalSnapshot = shouldRestoreRepoEnvLocal
  ? existsSync(repoEnvLocalPath)
    ? readFileSync(repoEnvLocalPath, "utf8")
    : null
  : undefined;

function hasArg(name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function convexCliArgs() {
  if (!isLocalDevCommand) {
    return args;
  }

  const localFlags = [];

  if (!hasArg("--local-cloud-port") && !hasArg("--local-site-port")) {
    localFlags.push("--local-cloud-port", localCloudPort, "--local-site-port", localSitePort);
  }

  if (!hasArg("--local-force-upgrade") && (!process.stdin.isTTY || process.env.CI === "true")) {
    localFlags.push("--local-force-upgrade");
  }

  return [args[0], ...localFlags, ...args.slice(1)];
}

const convexArgs = convexCliArgs();

function syncPublicConvexUrl() {
  if (usesLocalDeployment) {
    writeNextPublicConvexUrl(localConvexUrl);
    return;
  }

  const sourceEnvPath = repoEnvLocalPath;

  if (!existsSync(sourceEnvPath)) {
    return;
  }

  const file = readFileSync(sourceEnvPath, "utf8");
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

  writeNextPublicConvexUrl(convexUrl);
}

function writeNextPublicConvexUrl(convexUrl) {
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

    if (mergedLines.at(-1) === "") {
      mergedLines.pop();
    }

    mergedLines.push(nextPublicLine);
    writeFileSync(webEnvLocalPath, `${mergedLines.join("\n")}\n`);
    return;
  }

  writeFileSync(webEnvLocalPath, `${nextPublicLine}\n`);
}

function restoreRepoEnvLocal() {
  if (!shouldRestoreRepoEnvLocal) {
    return;
  }

  if (repoEnvLocalSnapshot === null) {
    rmSync(repoEnvLocalPath, { force: true });
    return;
  }

  writeFileSync(repoEnvLocalPath, repoEnvLocalSnapshot);
}

function convexEnv() {
  return {
    ...process.env,
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_TMPDIR: convexTmp,
    ...(usesLocalDeployment
      ? {
          CONVEX_DEPLOYMENT: `local:${localDeploymentName}`,
          CONVEX_DEPLOY_KEY: "",
          CONVEX_SELF_HOSTED_ADMIN_KEY: "",
          CONVEX_SELF_HOSTED_URL: "",
          CONVEX_URL: localConvexUrl,
        }
      : {}),
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

const child = spawn(convexBin, convexArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: convexEnv(),
});

try {
  syncPublicConvexUrl();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to initialize NEXT_PUBLIC_CONVEX_URL mirror: ${message}`);

  if (!child.killed) {
    child.kill();
  }

  restoreRepoEnvLocal();
  process.exit(1);
}

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
    const watchDir = repoRoot;
    const watchedFileName = path.basename(repoEnvLocalPath);

    publicUrlWatcher = watch(watchDir, (_eventType, filename) => {
      if (filename !== watchedFileName) {
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
  } catch (fallbackError) {
    const fallbackMessage =
      fallbackError instanceof Error ? fallbackError.message : String(fallbackError);

    console.error(
      "Failed to watch .env.local for NEXT_PUBLIC_CONVEX_URL sync:",
      `file watcher error: ${message}; directory watcher error: ${fallbackMessage}`,
    );
  }
}

function stopReparentedLocalExecutors() {
  if (process.platform !== "win32" || !usesLocalDeployment) {
    return;
  }

  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$target = $env:VRDEX_CONVEX_TMP_TO_STOP",
        "$matches = @(Get-CimInstance Win32_Process | Where-Object {",
        "  $_.Name -eq 'node.exe' -and",
        "  $_.CommandLine -like ('*' + $target + '*local.cjs*')",
        "})",
        "foreach ($match in $matches) {",
        "  Stop-Process -Id $match.ProcessId -Force -ErrorAction SilentlyContinue",
        "}",
      ].join("\n"),
    ],
    {
      env: {
        ...process.env,
        VRDEX_CONVEX_TMP_TO_STOP: convexTmp,
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

const forwardSignal = (signal) => {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    const result = spawnSync(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );

    if (result.status === 0) {
      stopReparentedLocalExecutors();
      return;
    }
  }

  child.kill(signal);
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
  restoreRepoEnvLocal();
  process.exit(1);
});

child.on("exit", (code, signal) => {
  publicUrlWatcher?.close();
  stopReparentedLocalExecutors();

  try {
    syncPublicConvexUrl();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to finalize NEXT_PUBLIC_CONVEX_URL mirror: ${message}`);
  }

  restoreRepoEnvLocal();

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
