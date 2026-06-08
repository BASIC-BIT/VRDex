import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

const validWorkerEnv = {
  CONVEX_URL: "https://example.invalid",
  VRDEX_RESTREAM_BENCHMARK_MODE: "dry-run",
  VRDEX_RESTREAM_QUALITY_GATE: "1080p60",
  VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS: "10",
  VRDEX_RESTREAM_MAX_SESSION_SECONDS: "43200",
  VRDEX_RESTREAM_KILL_SWITCH_SSM_PARAMETER: "/vrdex/restream/hosted-worker/enabled",
  VRDEX_RESTREAM_SECRET_REF_NAMES: "event-media/vrcdn/main-output",
};

function runWorker(env: Record<string, string>) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["workers/restream/hosted-worker.mjs"], {
      env: { ...process.env, ...validWorkerEnv, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr, stdout });
    });
  });
}

describe("restream worker configuration", () => {
  it("accepts the complete non-secret worker contract", async () => {
    const result = await runWorker({});

    assert.equal(result.code, 0);
    assert.match(result.stdout, /restream_worker_configuration_validated/);
  });

  it("rejects guardrail integers with suffixes instead of truncating them", async () => {
    const sessionResult = await runWorker({ VRDEX_RESTREAM_MAX_SESSION_SECONDS: "12h" });
    const workerResult = await runWorker({ VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS: "10x" });

    assert.equal(sessionResult.code, 1);
    assert.match(sessionResult.stderr, /VRDEX_RESTREAM_MAX_SESSION_SECONDS must be a positive integer\./);
    assert.equal(workerResult.code, 1);
    assert.match(workerResult.stderr, /VRDEX_RESTREAM_MAX_CONCURRENT_WORKERS must be a positive integer\./);
  });
});
