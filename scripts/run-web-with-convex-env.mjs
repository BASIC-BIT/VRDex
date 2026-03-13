import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const envFilePath = path.join(repoRoot, ".env.local");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error(
    "Usage: node scripts/run-web-with-convex-env.mjs <command> [args...]",
  );
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  let contents;

  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[run-web-with-convex-env] Could not read ${filePath}: ${message}`);
    return {};
  }

  const parsed = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    let value = normalizedLine.slice(separatorIndex + 1).trim();

    if (isQuotedValue(value)) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function isQuotedValue(value) {
  if (value.length < 2) {
    return false;
  }

  const quote = value[0];

  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    return false;
  }

  let escaped = false;

  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === quote) {
      return false;
    }
  }

  if (escaped) {
    return false;
  }

  return true;
}

const fileEnv = parseEnvFile(envFilePath);
const env = {
  ...process.env,
};

for (const key of ["CONVEX_DEPLOYMENT", "CONVEX_SITE_URL", "CONVEX_URL"]) {
  if (Object.prototype.hasOwnProperty.call(fileEnv, key)) {
    env[key] = fileEnv[key];
  }
}

if (
  Object.prototype.hasOwnProperty.call(fileEnv, "NEXT_PUBLIC_CONVEX_URL") &&
  fileEnv.NEXT_PUBLIC_CONVEX_URL
) {
  env.NEXT_PUBLIC_CONVEX_URL = fileEnv.NEXT_PUBLIC_CONVEX_URL;
} else if (Object.prototype.hasOwnProperty.call(fileEnv, "CONVEX_URL") && fileEnv.CONVEX_URL) {
  env.NEXT_PUBLIC_CONVEX_URL = fileEnv.CONVEX_URL;
} else if (!env.NEXT_PUBLIC_CONVEX_URL && env.CONVEX_URL) {
  env.NEXT_PUBLIC_CONVEX_URL = env.CONVEX_URL;
}

const [command, ...commandArgs] = args;
const child = spawn(command, commandArgs, {
  cwd: repoRoot,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

const signalHandlers = new Map();

for (const signal of ["SIGINT", "SIGTERM"]) {
  const handler = () => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

child.on("error", (error) => {
  const code = error.code ? ` [${error.code}]` : "";
  console.error(`Failed to spawn web command (${command})${code}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    if (process.platform !== "win32") {
      for (const [registeredSignal, handler] of signalHandlers) {
        process.removeListener(registeredSignal, handler);
      }

      process.kill(process.pid, signal);
      return;
    }

    process.exit(1);
    return;
  }

  process.exit(code ?? 1);
});
