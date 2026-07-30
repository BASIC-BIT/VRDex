import { spawnSync } from "node:child_process";

const classifications = {
  authStateRejected: "auth_state_rejected",
  configurationMissing: "configuration_missing",
  missingState: "missing_state",
  passed: "passed",
  serverFailure: "server_failure",
  transportFailure: "transport_failure",
};

function finish(classification, exitCode) {
  process.stdout.write(`${classification}\n`);
  process.exitCode = exitCode;
}

if (!process.env.VRDEX_PRODUCTION_AUTH_SMOKE_STORAGE_STATE_B64?.trim()) {
  finish(classifications.missingState, 2);
} else if (
  !process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.VRDEX_PRODUCTION_AUTH_SMOKE_MODE !== "manual-one-shot"
) {
  finish(classifications.configurationMissing, 2);
} else {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = npmExecPath
    ? [
        npmExecPath,
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.production-auth.config.mjs",
      ]
    : [
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.production-auth.config.mjs",
      ];
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capturedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.error) {
    finish(classifications.transportFailure, 1);
  } else if (result.status === 0) {
    finish(classifications.passed, 0);
  } else if (capturedOutput.includes("VRDEX_AUTH_SMOKE_SERVER_FAILURE")) {
    finish(classifications.serverFailure, 1);
  } else if (capturedOutput.includes("VRDEX_AUTH_SMOKE_TRANSPORT_FAILURE")) {
    finish(classifications.transportFailure, 1);
  } else {
    finish(classifications.authStateRejected, 1);
  }
}
