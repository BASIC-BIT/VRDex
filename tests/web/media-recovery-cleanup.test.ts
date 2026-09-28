import assert from "node:assert/strict";
import test from "node:test";
import { mediaCleanupFailure, retryMediaFixtureDelete } from "../../apps/web/e2e/media-recovery-cleanup";

test("recovery reports only an allowlisted cleanup stage", () => {
  assert.equal(mediaCleanupFailure(409, { stage: "finish_cleanup" }),
    "Media cleanup must succeed before identity deletion (HTTP 409, stage finish_cleanup)");
  assert.equal(mediaCleanupFailure(409, { stage: "\nsecret" }),
    "Media cleanup must succeed before identity deletion (HTTP 409, stage unknown)");
});

test("recovery waits for a live signed transfer before retrying DELETE", async () => {
  let time = 1_000;
  let calls = 0;
  const waits: number[] = [];
  const result = await retryMediaFixtureDelete(async () => {
    calls += 1;
    return calls === 1
      ? { status: () => 409, json: async () => ({ retryAt: 11_000 }) }
      : { status: () => 200, json: async () => ({ deletedMedia: true }) };
  }, () => time, async (ms) => { waits.push(ms); time += ms; });

  assert.equal(result.status(), 200);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [11_000]);
});

test("recovery leaves a non-retryable cleanup refusal untouched", async () => {
  let calls = 0;
  const result = await retryMediaFixtureDelete(async () => {
    calls += 1;
    return { status: () => 409, json: async () => ({ error: "Fixture cleanup failed" }) };
  });

  assert.equal(result.status(), 409);
  assert.equal(calls, 1);
});

test("recovery stops at its bounded wait deadline", async () => {
  let time = 0;
  let calls = 0;
  const result = await retryMediaFixtureDelete(async () => {
    calls += 1;
    return { status: () => 409, json: async () => ({ retryAt: 20 * 60_000 }) };
  }, () => time, async (ms) => { time += ms; });

  assert.equal(result.status(), 409);
  assert.equal(time, 12 * 60_000);
  assert.equal(calls, 13);
});
