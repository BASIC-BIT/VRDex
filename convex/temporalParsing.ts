import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { getAccountFeatureAccess } from "./_accountFeatures";
import { requireCurrentUser, requireVerifiedEmailUser } from "./accounts";

const JOB_TTL_MS = 15 * 60_000;
const RATE_WINDOW_MS = 60_000;
const ACCOUNT_RATE_LIMIT = 6;
const DEFAULT_DAILY_ACCOUNT_LIMIT = 250;
const DEFAULT_MONTHLY_ACCOUNT_LIMIT = 2_000;
const RETENTION_DELETE_BATCH = 500;
const PREWARM_COOLDOWN_MS = 5 * 60_000;
const PREWARM_LEASE_KEY = "global";

function positiveIntegerEnvironment(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDayStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

const temporalOutcomeValidator = v.union(
  v.literal("resolved"),
  v.literal("needs_clarification"),
  v.literal("no_plan"),
  v.literal("provider_error"),
  v.literal("invalid_plan"),
  v.literal("timeout"),
);

const submitArgs = {
  continuationTokenHash: v.string(),
  credentialId: v.optional(v.string()),
  text: v.string(),
  inputHash: v.string(),
  idempotencyFingerprint: v.string(),
  timeZone: v.string(),
  locale: v.optional(v.string()),
  country: v.optional(v.string()),
  subdivision: v.optional(v.string()),
  referenceInstant: v.string(),
  retainInput: v.optional(v.boolean()),
};

type SubmitInput = {
  continuationTokenHash: string;
  credentialId?: string;
  text: string;
  inputHash: string;
  idempotencyFingerprint: string;
  timeZone: string;
  locale?: string;
  country?: string;
  subdivision?: string;
  referenceInstant: string;
  retainInput?: boolean;
};

function serviceEnabled(): boolean {
  return process.env.TEMPORAL_PARSING_ENABLED?.trim().toLowerCase() === "true";
}

async function requireTemporalAccess(
  ctx: Pick<MutationCtx, "db">,
  userId: Id<"users">,
  now: number,
) {
  const user = await ctx.db.get(userId);
  if (user === null) {
    throw new Error("account_not_found");
  }
  if (user.email === undefined || user.emailVerificationTime === undefined) {
    throw new Error("verified_email_required");
  }
  const access = await getAccountFeatureAccess(ctx.db, userId, now);
  if (!access.canUseTemporalParsing) {
    throw new Error("temporal_beta_required");
  }
  if (!serviceEnabled()) {
    throw new Error("service_disabled");
  }
  return user;
}

export async function insertTemporalJobRecord(
  ctx: MutationCtx,
  args: SubmitInput,
  ownerUserId: Id<"users">,
) {
  const now = Date.now();
  await requireTemporalAccess(ctx, ownerUserId, now);

  const existing = await ctx.db
    .query("temporalParseJobs")
    .withIndex("by_continuationTokenHash", (q) =>
      q.eq("continuationTokenHash", args.continuationTokenHash),
    )
    .unique();
  if (existing !== null) {
    if (existing.ownerUserId !== ownerUserId) {
      throw new Error("continuation_conflict");
    }
    if (existing.expiresAt > now) {
      if (existing.idempotencyFingerprint !== args.idempotencyFingerprint) {
        throw new Error("idempotency_conflict");
      }
      return {
        jobId: existing._id,
        expiresAt: existing.expiresAt,
        retainInput: existing.retainInput,
        created: false,
      };
    }
    const active = existing.status === "queued" || existing.status === "running";
    await ctx.db.patch(existing._id, {
      continuationTokenHash: `expired:${existing._id}:${existing.continuationTokenHash}`,
      idempotencyFingerprint: undefined,
      ...(active ? {
        status: "failed" as const,
        outcome: "timeout" as const,
        errorCode: "continuation_expired",
        errorDetail: "The temporal parse continuation expired before completion.",
        totalLatencyMs: now - existing.createdAt,
        ...(!existing.retainInput ? { inputText: undefined, inputHash: undefined } : {}),
        completedAt: now,
      } : {}),
      updatedAt: now,
    });
  }

  const dailyLimit = positiveIntegerEnvironment("TEMPORAL_DAILY_ACCOUNT_LIMIT", DEFAULT_DAILY_ACCOUNT_LIMIT);
  const monthlyLimit = positiveIntegerEnvironment("TEMPORAL_MONTHLY_ACCOUNT_LIMIT", DEFAULT_MONTHLY_ACCOUNT_LIMIT);
  const [recent, daily, monthly, queuedForAccount, runningForAccount] = await Promise.all([
    ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", now - RATE_WINDOW_MS),
      )
      .take(ACCOUNT_RATE_LIMIT),
    ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", utcDayStart(now)),
      )
      .take(dailyLimit),
    ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).gte("createdAt", utcMonthStart(now)),
      )
      .take(monthlyLimit),
    ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_status_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("status", "queued"),
      )
      .collect(),
    ctx.db
      .query("temporalParseJobs")
      .withIndex("by_ownerUserId_status_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("status", "running"),
      )
      .collect(),
  ]);
  if (recent.length >= ACCOUNT_RATE_LIMIT) {
    throw new Error("account_rate_limited");
  }
  if (daily.length >= dailyLimit) {
    throw new Error("account_daily_limited");
  }
  if (monthly.length >= monthlyLimit) {
    throw new Error("account_monthly_limited");
  }
  if (queuedForAccount.length + runningForAccount.length >= 1) {
    throw new Error("account_concurrency_limited");
  }

  const preference = await ctx.db
    .query("temporalParsingPreferences")
    .withIndex("by_userId", (q) => q.eq("userId", ownerUserId))
    .unique();
  const retainInput = args.retainInput ?? preference?.retainInputs ?? true;
  const expiresAt = now + JOB_TTL_MS;
  const jobId = await ctx.db.insert("temporalParseJobs", {
    ownerUserId,
    ...(args.credentialId === undefined ? {} : { credentialId: args.credentialId }),
    continuationTokenHash: args.continuationTokenHash,
    idempotencyFingerprint: args.idempotencyFingerprint,
    inputText: args.text,
    inputHash: args.inputHash,
    inputLength: args.text.length,
    status: "queued",
    timeZone: args.timeZone,
    ...(args.locale === undefined ? {} : { locale: args.locale }),
    ...(args.country === undefined ? {} : { country: args.country }),
    ...(args.subdivision === undefined ? {} : { subdivision: args.subdivision }),
    referenceInstant: args.referenceInstant,
    retainInput,
    createdAt: now,
    expiresAt,
    updatedAt: now,
  });

  return { jobId, expiresAt, retainInput, created: true };
}

async function insertJob(
  ctx: MutationCtx,
  args: SubmitInput,
  ownerUserId: Id<"users">,
) {
  const result = await insertTemporalJobRecord(ctx, args, ownerUserId);
  if (result.created) {
    await Promise.all([
      ctx.scheduler.runAfter(0, internal.temporalParsingActions.processJob, { jobId: result.jobId }),
      ctx.scheduler.runAfter(JOB_TTL_MS + 1_000, internal.temporalParsing.expireJob, {
        jobId: result.jobId,
      }),
    ]);
  }
  return {
    jobId: result.jobId,
    expiresAt: result.expiresAt,
    retainInput: result.retainInput,
  };
}

export const submitForApiOwner = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    ...submitArgs,
  },
  handler: async (ctx, args) => {
    return insertJob(ctx, args, args.ownerUserId);
  },
});

export const submitForCurrentUser = mutation({
  args: submitArgs,
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    return insertJob(ctx, args, user._id);
  },
});

export const acquirePrewarmLease = internalMutation({
  args: { ownerUserId: v.id("users") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await requireTemporalAccess(ctx, args.ownerUserId, now);
    const existing = await ctx.db
      .query("temporalPrewarmLeases")
      .withIndex("by_key", (q) => q.eq("key", PREWARM_LEASE_KEY))
      .unique();
    if (existing !== null && existing.expiresAt > now) {
      return {
        acquired: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1_000)),
      };
    }
    const expiresAt = now + PREWARM_COOLDOWN_MS;
    if (existing === null) {
      await ctx.db.insert("temporalPrewarmLeases", {
        key: PREWARM_LEASE_KEY,
        ownerUserId: args.ownerUserId,
        requestedAt: now,
        expiresAt,
      });
    } else {
      await ctx.db.patch(existing._id, {
        ownerUserId: args.ownerUserId,
        requestedAt: now,
        expiresAt,
      });
    }
    return {
      acquired: true,
      retryAfterSeconds: 0,
    };
  },
});

export const getAccess = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const access = await getAccountFeatureAccess(ctx.db, user._id);
    const preference = await ctx.db
      .query("temporalParsingPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    return {
      allowed: access.canUseTemporalParsing,
      emailVerified: user.email !== undefined && user.emailVerificationTime !== undefined,
      retainInputs: preference?.retainInputs ?? true,
    };
  },
});

export async function scrubRetainedJobInputs(
  ctx: MutationCtx,
  ownerUserId: Id<"users">,
  updatedAt: number,
) {
  const jobs = await ctx.db
    .query("temporalParseJobs")
    .withIndex("by_ownerUserId_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
    .filter((q) => q.eq(q.field("retainInput"), true))
    .order("desc")
    .take(RETENTION_DELETE_BATCH);
  let deletedInputs = 0;
  await Promise.all(jobs.map(async (job) => {
    const active = job.status === "queued" || job.status === "running";
    if (!active && job.inputText !== undefined) {
      deletedInputs += 1;
    }
    await ctx.db.patch(job._id, {
      inputText: active ? job.inputText : undefined,
      inputHash: active ? job.inputHash : undefined,
      retainInput: false,
      updatedAt,
    });
  }));
  return {
    deletedInputs,
    batchFull: jobs.length === RETENTION_DELETE_BATCH,
  };
}
export const setRetentionPreference = mutation({
  args: { retainInputs: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedEmailUser(ctx);
    const existing = await ctx.db
      .query("temporalParsingPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const updatedAt = Date.now();
    if (existing === null) {
      await ctx.db.insert("temporalParsingPreferences", {
        userId: user._id,
        retainInputs: args.retainInputs,
        updatedAt,
      });
    } else {
      await ctx.db.patch(existing._id, {
        retainInputs: args.retainInputs,
        updatedAt,
      });
    }
    let scrubResult = { deletedInputs: 0, batchFull: false };
    if (!args.retainInputs) {
      scrubResult = await scrubRetainedJobInputs(ctx, user._id, updatedAt);
      if (scrubResult.batchFull) {
        await ctx.scheduler.runAfter(0, internal.temporalParsing.scrubRetainedInputBatch, {
          ownerUserId: user._id,
        });
      }
    }
    return {
      retainInputs: args.retainInputs,
      updatedAt,
      deletedInputs: scrubResult.deletedInputs,
      deletionBatchFull: scrubResult.batchFull,
    };
  },
});

export const scrubRetainedInputBatch = internalMutation({
  args: { ownerUserId: v.id("users") },
  handler: async (ctx, args) => {
    const preference = await ctx.db
      .query("temporalParsingPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.ownerUserId))
      .unique();
    if (preference?.retainInputs !== false) {
      return { deletedInputs: 0, batchFull: false };
    }
    const result = await scrubRetainedJobInputs(ctx, args.ownerUserId, Date.now());
    if (result.batchFull) {
      await ctx.scheduler.runAfter(0, internal.temporalParsing.scrubRetainedInputBatch, {
        ownerUserId: args.ownerUserId,
      });
    }
    return result;
  },
});

export const getJobForApiOwner = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    continuationTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("temporalParseJobs")
      .withIndex("by_continuationTokenHash", (q) =>
        q.eq("continuationTokenHash", args.continuationTokenHash),
      )
      .unique();
    if (job === null || job.ownerUserId !== args.ownerUserId) {
      return null;
    }
    return publicJob(job);
  },
});

export const getJobForCurrentUser = query({
  args: { continuationTokenHash: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const job = await ctx.db
      .query("temporalParseJobs")
      .withIndex("by_continuationTokenHash", (q) =>
        q.eq("continuationTokenHash", args.continuationTokenHash),
      )
      .unique();
    if (job === null || job.ownerUserId !== user._id) {
      return null;
    }
    return publicJob(job);
  },
});

function publicJob(job: Doc<"temporalParseJobs">) {
  return {
    id: job._id,
    status: job.status,
    expiresAt: job.expiresAt,
    outcome: job.outcome,
    result: job.result,
    errorCode: job.errorCode,
    errorDetail: job.errorDetail,
    modelRevision: job.modelRevision,
    inferenceLatencyMs: job.inferenceLatencyMs,
    totalLatencyMs: job.totalLatencyMs,
    retainInput: job.retainInput,
  };
}

export const markRunning = internalMutation({
  args: { jobId: v.id("temporalParseJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || job.status !== "queued") {
      return { state: "stopped" as const };
    }
    const now = Date.now();
    if (job.expiresAt <= now) {
      await ctx.db.patch(job._id, {
        status: "failed",
        outcome: "timeout",
        errorCode: "continuation_expired",
        errorDetail: "Temporal inference did not start before the continuation expired.",
        ...(!job.retainInput ? { inputText: undefined, inputHash: undefined } : {}),
        completedAt: now,
        updatedAt: now,
      });
      return { state: "stopped" as const };
    }
    const running = await ctx.db
      .query("temporalParseJobs")
      .withIndex("by_status_createdAt", (q) =>
        q.eq("status", "running").gte("createdAt", now - JOB_TTL_MS),
      )
      .first();
    if (running !== null && running._id !== job._id) {
      return { state: "busy" as const, expiresAt: job.expiresAt };
    }
    await ctx.db.patch(job._id, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
    return {
      state: "started" as const,
      text: job.inputText,
      timeZone: job.timeZone,
      locale: job.locale,
      country: job.country,
      subdivision: job.subdivision,
      referenceInstant: job.referenceInstant,
      createdAt: job.createdAt,
    };
  },
});

export const requeueWarmingJob = internalMutation({
  args: { jobId: v.id("temporalParseJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || job.status !== "running") {
      return { state: "stopped" as const };
    }
    const now = Date.now();
    if (job.expiresAt <= now) {
      await ctx.db.patch(job._id, {
        status: "failed",
        outcome: "timeout",
        errorCode: "continuation_expired",
        errorDetail: "The temporal parse continuation expired while the model was warming.",
        totalLatencyMs: now - job.createdAt,
        ...(!job.retainInput ? { inputText: undefined, inputHash: undefined } : {}),
        completedAt: now,
        updatedAt: now,
      });
      return { state: "stopped" as const };
    }
    await ctx.db.patch(job._id, {
      status: "queued",
      startedAt: undefined,
      updatedAt: now,
    });
    return { state: "queued" as const, expiresAt: job.expiresAt };
  },
});

export const expireJob = internalMutation({
  args: { jobId: v.id("temporalParseJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    if (job === null || job.expiresAt > now) {
      return;
    }
    const active = job.status === "queued" || job.status === "running";
    await ctx.db.patch(job._id, {
      idempotencyFingerprint: undefined,
      ...(!job.retainInput ? {
        inputText: undefined,
        inputHash: undefined,
        result: undefined,
        ...(!active ? { errorDetail: undefined } : {}),
      } : {}),
      ...(active ? {
        status: "failed" as const,
        outcome: "timeout" as const,
        errorCode: "continuation_expired",
        errorDetail: "The temporal parse continuation expired before completion.",
        totalLatencyMs: now - job.createdAt,
        completedAt: now,
      } : {}),
      updatedAt: now,
    });
  },
});
export const completeJob = internalMutation({
  args: {
    jobId: v.id("temporalParseJobs"),
    outcome: temporalOutcomeValidator,
    result: v.optional(v.any()),
    errorCode: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
    modelRevision: v.optional(v.string()),
    inferenceLatencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job === null || (job.status !== "running" && job.status !== "queued")) {
      return;
    }
    const completedAt = Date.now();
    await ctx.db.patch(job._id, {
      status: args.result === undefined ? "failed" : "succeeded",
      outcome: args.outcome,
      ...(args.result === undefined ? {} : { result: args.result }),
      ...(args.errorCode === undefined ? {} : { errorCode: args.errorCode }),
      ...(args.errorDetail === undefined ? {} : { errorDetail: args.errorDetail.slice(0, 300) }),
      ...(args.modelRevision === undefined ? {} : { modelRevision: args.modelRevision }),
      ...(args.inferenceLatencyMs === undefined ? {} : { inferenceLatencyMs: args.inferenceLatencyMs }),
      totalLatencyMs: completedAt - job.createdAt,
      ...(!job.retainInput ? { inputText: undefined, inputHash: undefined } : {}),
      completedAt,
      updatedAt: completedAt,
    });
  },
});
