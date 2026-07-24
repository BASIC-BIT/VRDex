import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  completedTemporalResponse,
  createContinuationNonce,
  createContinuationToken,
  hashContinuationToken,
  hashTemporalIdempotencyKey,
  hashTemporalInput,
  hashTemporalRequest,
  pendingTemporalResponse,
  temporalSubmissionError,
} from "../../apps/web/src/lib/server/temporal-response";

describe("temporal API response helpers", () => {
  it("returns a canonical no-store response without provider-only fields", async () => {
    const response = completedTemporalResponse({
      id: "job-1",
      status: "succeeded",
      expiresAt: Date.now() + 60_000,
      result: {
        status: "resolved",
        kind: "instant",
        confidence: 0.96,
        epoch: 1_785_369_600,
        canonical: {
          isoInstant: "2026-07-30T00:00:00.000Z",
          zonedDateTime: "2026-07-29T20:00:00-04:00[America/New_York]",
          timeZone: "America/New_York",
          precision: "relative",
          weekday: "wednesday",
        },
        assumptions: [],
        providerDebug: "must not cross the public boundary",
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.requestId, "job-1");
    assert.equal(body.method, "trained_plan");
    assert.equal("providerDebug" in body, false);
  });

  it("fails impossible resolved shapes at the public boundary", async () => {
    const response = completedTemporalResponse({
      id: "job-invalid",
      status: "succeeded",
      expiresAt: Date.now() + 60_000,
      result: {
        status: "resolved",
        kind: "instant",
        confidence: 0.96,
        assumptions: [],
      },
    });

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).title, "Temporal result unavailable");
  });

  it("returns gone when retention scrubbing removed a completed result", async () => {
    const response = completedTemporalResponse({
      id: "job-scrubbed",
      status: "succeeded",
      expiresAt: Date.now() + 60_000,
    });

    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).title, "Temporal result deleted");
  });

  it("returns a reusable continuation with the caller-specific location", async () => {
    const token = "a".repeat(43);
    const response = pendingTemporalResponse({
      jobId: "job-2",
      continuationToken: token,
      expiresAt: Date.parse("2026-07-22T12:15:00.000Z"),
      requestUrl: "https://vrdex.example/api/v0/time/parse",
      continuationPath: "/api/v0/time/parse",
    });

    assert.equal(response.status, 202);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("location"), `https://vrdex.example/api/v0/time/parse/${token}`);
    assert.equal((await response.json()).continuationToken, token);
  });

  it("derives nonce-bound continuations and separate idempotency lookup hashes", () => {
    const previous = process.env.TEMPORAL_INPUT_HASH_KEY;
    process.env.TEMPORAL_INPUT_HASH_KEY = "test-only-hash-key";
    try {
      const nonce = createContinuationNonce();
      const first = createContinuationToken("owner-1", "request-1", nonce);
      assert.equal(
        first,
        createContinuationToken("owner-1", "request-1", nonce),
      );
      assert.notEqual(
        first,
        createContinuationToken("owner-1", "request-1", createContinuationNonce()),
      );
      assert.notEqual(first, createContinuationToken("owner-2", "request-1", nonce));
      assert.notEqual(first, createContinuationToken("owner-1", "request-2", nonce));
      assert.match(first, /^[A-Za-z0-9_-]{43}$/);
      assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
      assert.equal(
        hashTemporalIdempotencyKey("owner-1", "request-1"),
        hashTemporalIdempotencyKey("owner-1", "request-1"),
      );
      assert.notEqual(
        hashTemporalIdempotencyKey("owner-1", "request-1"),
        hashTemporalIdempotencyKey("owner-2", "request-1"),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_INPUT_HASH_KEY;
      } else {
        process.env.TEMPORAL_INPUT_HASH_KEY = previous;
      }
    }
  });

  it("hashes continuations and inputs without retaining raw text", () => {
    const previous = process.env.TEMPORAL_INPUT_HASH_KEY;
    process.env.TEMPORAL_INPUT_HASH_KEY = "test-only-hash-key";
    try {
      assert.equal(hashContinuationToken("continuation").length, 64);
      assert.equal(hashTemporalInput("next Friday").length, 64);
      assert.notEqual(hashTemporalInput("next Friday"), hashTemporalInput("next Saturday"));
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_INPUT_HASH_KEY;
      } else {
        process.env.TEMPORAL_INPUT_HASH_KEY = previous;
      }
    }
  });

  it("binds idempotency fingerprints to the complete client request", () => {
    const previous = process.env.TEMPORAL_INPUT_HASH_KEY;
    process.env.TEMPORAL_INPUT_HASH_KEY = "test-only-hash-key";
    try {
      const request = {
        text: "next Friday",
        timeZone: "America/Indianapolis",
        locale: "en-US",
        country: "US",
        retainInput: false,
      };
      const fingerprint = hashTemporalRequest(request);
      assert.equal(fingerprint, hashTemporalRequest(request));
      assert.notEqual(fingerprint, hashTemporalRequest({
        ...request,
        text: "next Saturday",
      }));
      assert.notEqual(fingerprint, hashTemporalRequest({
        ...request,
        referenceInstant: "2026-07-22T12:00:00.000Z",
      }));
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_INPUT_HASH_KEY;
      } else {
        process.env.TEMPORAL_INPUT_HASH_KEY = previous;
      }
    }
  });

  it("maps quota, capacity, and configuration failures to public problems", async () => {
    const quota = temporalSubmissionError(new Error("account_rate_limited"));
    assert.equal(quota.status, 429);
    assert.equal(quota.headers.get("retry-after"), "60");

    const capacity = temporalSubmissionError(new Error("account_concurrency_limited"));
    assert.equal(capacity.status, 503);
    assert.equal(capacity.headers.get("retry-after"), "2");

    const conflict = temporalSubmissionError(new Error("idempotency_conflict"));
    assert.equal(conflict.status, 409);

    const misconfigured = temporalSubmissionError(
      new Error("TEMPORAL_INPUT_HASH_KEY is required."),
    );
    assert.equal(misconfigured.status, 500);
    assert.equal(
      (await misconfigured.json()).title,
      "Temporal service misconfigured",
    );
  });
});
