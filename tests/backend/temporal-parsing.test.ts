import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { convexTest } from "convex-test";

import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schemaModule from "../../convex/schema";
import {
  insertTemporalJobRecord,
  scrubRetainedJobInputs,
} from "../../convex/temporalParsing";
import { temporalProviderRetryDelayMs } from "../../convex/temporalParsingActions";

const modules = {
  "../../convex/_generated/api.ts": () => import("../../convex/_generated/api"),
  "../../convex/temporalParsing.ts": () => import("../../convex/temporalParsing"),

};
const schema = (
  schemaModule as unknown as { default?: typeof schemaModule }
).default ?? schemaModule;
const actor = {
  tokenIdentifier: "operator:vrdex",
  issuer: "vrdex",
  subject: "temporal-tests",
};

async function createAuthorizedUser(t: ReturnType<typeof convexTest>, suffix: string) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: `Temporal ${suffix}`,
      email: `${suffix}@example.test`,
      emailVerificationTime: now,
    });
    await ctx.db.insert("accountFeatureGrants", {
      userId,
      feature: "use_temporal_parsing_beta",
      state: "active",
      grantedBy: actor,
      grantedAt: now,
      updatedAt: now,
    });
    return userId;
  });
}

function submission(ownerUserId: Id<"users">, suffix: string, retainInput = true) {
  return {
    ownerUserId,
    continuationTokenHash: suffix.padEnd(64, "a").slice(0, 64),
    credentialId: `token-${suffix}`,
    text: `next Friday at ${suffix.length + 1}pm`,
    inputHash: suffix.padEnd(64, "b").slice(0, 64),
    idempotencyFingerprint: suffix.padEnd(64, "c").slice(0, 64),
    timeZone: "America/Indianapolis",
    locale: "en-US",
    country: "US",
    subdivision: "IN",
    referenceInstant: "2026-07-22T12:00:00.000Z",
    retainInput,
  };
}

async function insertQueuedJob(
  t: ReturnType<typeof convexTest>,
  ownerUserId: Id<"users">,
  suffix: string,
  retainInput = true,
) {
  const input = submission(ownerUserId, suffix, retainInput);
  return await t.run((ctx) => {
    const now = Date.now();
    return ctx.db.insert("temporalParseJobs", {
      ownerUserId,
      credentialId: input.credentialId,
      continuationTokenHash: input.continuationTokenHash,
      idempotencyFingerprint: input.idempotencyFingerprint,
      inputText: input.text,
      inputHash: input.inputHash,
      inputLength: input.text.length,
      status: "queued",
      timeZone: input.timeZone,
      locale: input.locale,
      country: input.country,
      subdivision: input.subdivision,
      referenceInstant: input.referenceInstant,
      retainInput,
      createdAt: now,
      expiresAt: now + 15 * 60_000,
      updatedAt: now,
    });
  });
}

describe("temporal parsing control plane", () => {
  it("requires the closed-beta account grant", async () => {
    const t = convexTest({ schema, modules });
    const userId = await t.run((ctx) => ctx.db.insert("users", {
      name: "Unapproved parser",
      email: "unapproved@example.test",
      emailVerificationTime: Date.now(),
    }));

    await assert.rejects(
      t.mutation(internal.temporalParsing.submitForApiOwner, submission(userId, "unapproved")),
      /temporal_beta_required/,
    );
  });

  it("fails closed when the service enablement variable is absent", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "not-configured");
    const previous = process.env.TEMPORAL_PARSING_ENABLED;
    delete process.env.TEMPORAL_PARSING_ENABLED;
    try {
      await assert.rejects(
        t.mutation(
          internal.temporalParsing.submitForApiOwner,
          submission(userId, "not-configured"),
        ),
        /service_disabled/,
      );
    } finally {
      if (previous !== undefined) {
        process.env.TEMPORAL_PARSING_ENABLED = previous;
      }
    }
  });

  it("deduplicates prewarm requests behind one durable global cooldown", async () => {
    const t = convexTest({ schema, modules });
    const firstUserId = await createAuthorizedUser(t, "prewarm-first");
    const secondUserId = await createAuthorizedUser(t, "prewarm-second");
    const previous = process.env.TEMPORAL_PARSING_ENABLED;
    process.env.TEMPORAL_PARSING_ENABLED = "true";
    try {
      const first = await t.mutation(internal.temporalParsing.acquirePrewarmLease, {
        ownerUserId: firstUserId,
      });
      const second = await t.mutation(internal.temporalParsing.acquirePrewarmLease, {
        ownerUserId: secondUserId,
      });
      assert.equal(first.acquired, true);
      assert.equal(first.retryAfterSeconds, 0);
      assert.equal(second.acquired, false);
      assert.ok(second.retryAfterSeconds > 0);
      assert.ok(second.retryAfterSeconds <= 300);
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_PARSING_ENABLED;
      } else {
        process.env.TEMPORAL_PARSING_ENABLED = previous;
      }
    }
  });

  it("returns an already accepted job for the same continuation hash", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "idempotent");
    const previous = process.env.TEMPORAL_PARSING_ENABLED;
    process.env.TEMPORAL_PARSING_ENABLED = "true";
    try {
      const input = submission(userId, "idempotent");
      const first = await t.run((ctx) => insertTemporalJobRecord(ctx, input, userId));
      const second = await t.run((ctx) => insertTemporalJobRecord(ctx, input, userId));
      assert.equal(second.jobId, first.jobId);
      assert.equal(second.expiresAt, first.expiresAt);
      const jobs = await t.run((ctx) => ctx.db
        .query("temporalParseJobs")
        .withIndex("by_ownerUserId_createdAt", (q) => q.eq("ownerUserId", userId))
        .collect());
      assert.equal(jobs.length, 1);
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_PARSING_ENABLED;
      } else {
        process.env.TEMPORAL_PARSING_ENABLED = previous;
      }
    }
  });

  it("rejects an idempotency key reused for a different request", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "idempotency-conflict");
    const previous = process.env.TEMPORAL_PARSING_ENABLED;
    process.env.TEMPORAL_PARSING_ENABLED = "true";
    try {
      const input = submission(userId, "idempotency-conflict");
      await t.run((ctx) => insertTemporalJobRecord(ctx, input, userId));
      await assert.rejects(
        t.run((ctx) => insertTemporalJobRecord(ctx, {
          ...input,
          text: "next Saturday at noon",
          idempotencyFingerprint: "different".padEnd(64, "d"),
        }, userId)),
        /idempotency_conflict/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_PARSING_ENABLED;
      } else {
        process.env.TEMPORAL_PARSING_ENABLED = previous;
      }
    }
  });

  it("accepts a fresh job when an idempotent continuation has expired", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "expired-idempotency");
    const previous = process.env.TEMPORAL_PARSING_ENABLED;
    process.env.TEMPORAL_PARSING_ENABLED = "true";
    try {
      const input = submission(userId, "expired-idempotency");
      const first = await t.run((ctx) => insertTemporalJobRecord(ctx, input, userId));
      await t.run((ctx) => ctx.db.patch(first.jobId, { expiresAt: Date.now() - 1 }));
      const second = await t.run((ctx) => insertTemporalJobRecord(ctx, input, userId));
      assert.notEqual(second.jobId, first.jobId);
      assert.equal(second.created, true);
      const oldJob = await t.run((ctx) => ctx.db.get(first.jobId));
      assert.match(oldJob?.continuationTokenHash ?? "", /^expired:/);
      assert.equal(oldJob?.idempotencyFingerprint, undefined);
      assert.equal(oldJob?.status, "failed");
      assert.equal(oldJob?.errorCode, "continuation_expired");
    } finally {
      if (previous === undefined) {
        delete process.env.TEMPORAL_PARSING_ENABLED;
      } else {
        process.env.TEMPORAL_PARSING_ENABLED = previous;
      }
    }
  });

  it("requeues a running job while the model warms", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "warming");
    const jobId = await insertQueuedJob(t, userId, "warming");
    assert.equal((await t.mutation(internal.temporalParsing.markRunning, { jobId })).state, "started");
    const requeued = await t.mutation(internal.temporalParsing.requeueWarmingJob, { jobId });
    assert.equal(requeued.state, "queued");
    const job = await t.run((ctx) => ctx.db.get(jobId));
    assert.equal(job?.status, "queued");
    assert.equal(job?.startedAt, undefined);
  });

  it("retries only explicit model-warming and provider-capacity responses", async () => {
    assert.equal(await temporalProviderRetryDelayMs(new Response(
      JSON.stringify({ error: "model_warming", retryAfterSeconds: 2 }),
      { status: 503, headers: { "retry-after": "2" } },
    )), 2_000);
    assert.equal(await temporalProviderRetryDelayMs(new Response(
      "capacity",
      { status: 429, headers: { "retry-after": "5" } },
    )), 5_000);
    assert.equal(await temporalProviderRetryDelayMs(new Response(
      "unauthorized",
      { status: 401 },
    )), null);
  });

  it("serializes different accounts onto one running worker", async () => {
    const t = convexTest({ schema, modules });
    const firstUserId = await createAuthorizedUser(t, "first");
    const secondUserId = await createAuthorizedUser(t, "second");
    const firstJobId = await insertQueuedJob(t, firstUserId, "first");
    const secondJobId = await insertQueuedJob(t, secondUserId, "second");

    const firstStart = await t.mutation(internal.temporalParsing.markRunning, {
      jobId: firstJobId,
    });
    const secondStart = await t.mutation(internal.temporalParsing.markRunning, {
      jobId: secondJobId,
    });

    assert.equal(firstStart.state, "started");
    assert.equal(secondStart.state, "busy");
  });

  it("scrubs opted-out input after completion while preserving aggregate metadata", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "private");
    const jobId = await insertQueuedJob(t, userId, "private", false);
    const started = await t.mutation(internal.temporalParsing.markRunning, { jobId });
    assert.equal(started.state, "started");

    await t.mutation(internal.temporalParsing.completeJob, {
      jobId,
      outcome: "no_plan",
      result: {
        status: "no_plan",
        reason: "Unsupported test expression.",
      },
      modelRevision: "test-model@immutable",
      inferenceLatencyMs: 12,
    });

    const job = await t.run((ctx) => ctx.db.get(jobId));
    assert.equal(job?.inputText, undefined);
    assert.equal(job?.inputLength, submission(userId, "private", false).text.length);
    assert.equal(job?.inputHash, undefined);
    assert.equal(job?.idempotencyFingerprint, submission(userId, "private", false).idempotencyFingerprint);
    assert.equal(job?.status, "succeeded");
    assert.equal(job?.modelRevision, "test-model@immutable");
  });

  it("deletes opted-out response content and fingerprints when a continuation expires", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "expired-fingerprint");
    const jobId = await insertQueuedJob(t, userId, "expired-fingerprint", false);
    await t.run((ctx) => ctx.db.patch(jobId, {
      status: "succeeded",
      outcome: "no_plan",
      result: { status: "no_plan", reason: "test" },
      errorDetail: "content-derived diagnostic",
      completedAt: Date.now() - 1_000,
      expiresAt: Date.now() - 1,
    }));

    await t.mutation(internal.temporalParsing.expireJob, { jobId });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    assert.equal(job?.status, "succeeded");
    assert.equal(job?.idempotencyFingerprint, undefined);
    assert.equal(job?.inputText, undefined);
    assert.equal(job?.inputHash, undefined);
    assert.equal(job?.result, undefined);
    assert.equal(job?.errorDetail, undefined);
  });

  it("continues account opt-out scrubbing beyond the first bounded batch", async () => {
    const t = convexTest({ schema, modules });
    const userId = await createAuthorizedUser(t, "retention-batch");
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 501; index += 1) {
        const suffix = `retained-${index}`;
        const inputText = `next Friday at ${index % 24}:00`;
        await ctx.db.insert("temporalParseJobs", {
          ownerUserId: userId,
          continuationTokenHash: suffix.padEnd(64, "a").slice(0, 64),
          inputText,
          inputHash: suffix.padEnd(64, "b").slice(0, 64),
          inputLength: inputText.length,
          status: "succeeded",
          timeZone: "America/Indianapolis",
          referenceInstant: "2026-07-22T12:00:00.000Z",
          retainInput: true,
          outcome: "resolved",
          result: { status: "resolved" },
          createdAt: now - index,
          completedAt: now,
          expiresAt: now + 15 * 60_000,
          updatedAt: now,
        });
      }
    });

    const firstBatch = await t.run((ctx) =>
      scrubRetainedJobInputs(ctx, userId, Date.now()),
    );
    assert.equal(firstBatch.deletedInputs, 500);
    assert.equal(firstBatch.batchFull, true);

    const finalBatch = await t.run((ctx) =>
      scrubRetainedJobInputs(ctx, userId, Date.now()),
    );
    assert.equal(finalBatch.deletedInputs, 1);
    assert.equal(finalBatch.batchFull, false);

    const retained = await t.run((ctx) => ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_createdAt", (q) => q.eq("ownerUserId", userId))
      .filter((q) => q.or(
        q.neq(q.field("inputText"), undefined),
        q.neq(q.field("inputHash"), undefined),
      ))
      .collect());
    assert.equal(retained.length, 0);
  });

});
