import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";

const validPocEnv = {
  VRDEX_RESTREAM_QUALITY_GATE: "720p30",
  VRDEX_RESTREAM_X264_PRESET: "ultrafast",
  VRDEX_VRCDN_POC_CONFIG_CHECK_ONLY: "true",
  VRDEX_VRCDN_POC_DURATION_SECONDS: "600",
};

function runPoc(env: Record<string, string>) {
  return new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["workers/restream/vrcdn-poc.mjs"], {
      env: { ...process.env, ...validPocEnv, ...env },
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
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

describe("VRCDN POC worker configuration", () => {
  it("accepts source-pusher config without printing the ingest secret", async () => {
    const ingestUrl = "rtmps://ingest.example.invalid/live/source-a-secret-key";
    const result = await runPoc({
      VRDEX_VRCDN_POC_MODE: "source-pusher",
      VRDEX_VRCDN_POC_SOURCE_KEY: "source-a",
      VRDEX_VRCDN_POC_INGEST_URL: ingestUrl,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /vrcdn_poc_configuration_validated/);
    assert.match(result.stdout, /"ingestSecretConfigured":true/);
    assert.doesNotMatch(result.stdout, /source-a-secret-key/);
  });

  it("accepts output-restream config without printing the output ingest secret", async () => {
    const outputIngestUrl = "rtmps://ingest.example.invalid/live/output-secret-key";
    const result = await runPoc({
      VRDEX_VRCDN_POC_MODE: "output-restream",
      VRDEX_VRCDN_POC_SOURCE_A_PLAYBACK_URL: "https://stream.vrcdn.live/live/source-a.m3u8",
      VRDEX_VRCDN_POC_SOURCE_B_PLAYBACK_URL: "https://stream.vrcdn.live/live/source-b.m3u8",
      VRDEX_VRCDN_POC_OUTPUT_WATCH_URL: "https://vrcdn.live/output-poc",
      VRDEX_VRCDN_POC_OUTPUT_INGEST_URL: outputIngestUrl,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /vrcdn_poc_configuration_validated/);
    assert.match(result.stdout, /"outputIngestSecretConfigured":true/);
    assert.doesNotMatch(result.stdout, /output-secret-key/);
  });

  it("accepts single-output smoke config from an injected JSON secret", async () => {
    const secretJson = JSON.stringify({
      rtmpUrl: "rtmps://ingest.example.invalid/live/output-account",
      streamKey: "output-secret-key",
    });
    const result = await runPoc({
      VRDEX_VRCDN_POC_MODE: "single-output-smoke",
      VRDEX_VRCDN_POC_OUTPUT_WATCH_URL: "https://vrcdn.live/output-poc",
      VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON: secretJson,
    });

    assert.equal(result.code, 0);
    assert.match(result.stdout, /vrcdn_poc_configuration_validated/);
    assert.match(result.stdout, /"mode":"single-output-smoke"/);
    assert.match(result.stdout, /"outputIngestSecretConfigured":true/);
    assert.doesNotMatch(result.stdout, /output-secret-key/);
  });

  it("rejects signed or credential-bearing public playback URLs", async () => {
    const result = await runPoc({
      VRDEX_VRCDN_POC_MODE: "output-restream",
      VRDEX_VRCDN_POC_SOURCE_A_PLAYBACK_URL: "https://stream.vrcdn.live/live/source-a.m3u8?token=secretish",
      VRDEX_VRCDN_POC_SOURCE_B_PLAYBACK_URL: "https://stream.vrcdn.live/live/source-b.m3u8",
      VRDEX_VRCDN_POC_OUTPUT_WATCH_URL: "https://vrcdn.live/output-poc",
      VRDEX_VRCDN_POC_OUTPUT_INGEST_URL: "rtmps://ingest.example.invalid/live/output-secret-key",
    });

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /VRDEX_VRCDN_POC_SOURCE_A_PLAYBACK_URL must be a stable public playback URL, not a signed URL or credential-bearing URL\./,
    );
  });

  it("rejects unsupported POC modes and non-RTMP ingest URLs", async () => {
    const modeResult = await runPoc({ VRDEX_VRCDN_POC_MODE: "source-ish" });
    const ingestResult = await runPoc({
      VRDEX_VRCDN_POC_MODE: "source-pusher",
      VRDEX_VRCDN_POC_SOURCE_KEY: "source-a",
      VRDEX_VRCDN_POC_INGEST_URL: "https://example.invalid/not-rtmp",
    });

    assert.equal(modeResult.code, 1);
    assert.match(modeResult.stderr, /VRDEX_VRCDN_POC_MODE must be source-pusher, output-restream, or single-output-smoke\./);
    assert.equal(ingestResult.code, 1);
    assert.match(ingestResult.stderr, /VRDEX_VRCDN_POC_INGEST_URL must use rtmp or rtmps\./);
  });

  it("rejects ambiguous direct and JSON ingest secret inputs", async () => {
    const result = await runPoc({
      VRDEX_VRCDN_POC_MODE: "single-output-smoke",
      VRDEX_VRCDN_POC_OUTPUT_WATCH_URL: "https://vrcdn.live/output-poc",
      VRDEX_VRCDN_POC_OUTPUT_INGEST_URL: "rtmps://ingest.example.invalid/live/direct-secret",
      VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON: JSON.stringify({
        rtmpUrl: "rtmps://ingest.example.invalid/live/output-account",
        streamKey: "json-secret",
      }),
    });

    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /VRDEX_VRCDN_POC_OUTPUT_INGEST_URL and VRDEX_VRCDN_POC_OUTPUT_INGEST_SECRET_JSON must not both be set\./,
    );
  });
});
