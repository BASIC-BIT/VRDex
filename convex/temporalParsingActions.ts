"use node";


import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

function serviceEnabled(): boolean {
  return process.env.TEMPORAL_PARSING_ENABLED?.trim().toLowerCase() === "true";
}

export const processJob = internalAction({
  args: { jobId: v.id("temporalParseJobs") },
  handler: async (ctx, args) => {
    if (!serviceEnabled()) {
      await ctx.runMutation(internal.temporalParsing.completeJob, {
        jobId: args.jobId,
        outcome: "provider_error",
        errorCode: "service_disabled",
        errorDetail: "The temporal parser is temporarily disabled.",
      });
      return;
    }
    const job = await ctx.runMutation(internal.temporalParsing.markRunning, {
      jobId: args.jobId,
    });
    if (job.state === "busy") {
      await ctx.scheduler.runAfter(1_000, internal.temporalParsingActions.processJob, {
        jobId: args.jobId,
      });
      return;
    }
    if (job.state !== "started" || typeof job.text !== "string") {
      return;
    }

    const baseUrl = process.env.TEMPORAL_INFERENCE_BASE_URL?.trim().replace(/\/$/, "");
    const authToken = process.env.TEMPORAL_INFERENCE_AUTH_TOKEN?.trim();
    if (!baseUrl || !authToken) {
      await ctx.runMutation(internal.temporalParsing.completeJob, {
        jobId: args.jobId,
        outcome: "provider_error",
        errorCode: "provider_not_configured",
        errorDetail: "Temporal inference is not configured.",
      });
      return;
    }

    try {
      const {
        createDeterministicTemporalToolImplementations,
        executeTemporalPlanPlannerOutput,
        parseCalendarContext,
        parseTemporalPlanPlannerOutput,
      } = await import("@vrdex/temporal-runtime");
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}/infer`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: job.text,
          timeZone: job.timeZone,
          referenceInstant: job.referenceInstant,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`provider_http_${response.status}`);
      }
      const provider = await response.json() as {
        plan: unknown;
        modelRevision?: string;
        inferenceLatencyMs?: number;
      };
      const plan = parseTemporalPlanPlannerOutput(provider.plan);
      const calendarContext = {
        ...parseCalendarContext(job.timeZone, job.referenceInstant),
        ...(job.locale === undefined ? {} : { locale: job.locale }),
        ...(job.country === undefined ? {} : { country: job.country }),
        ...(job.subdivision === undefined ? {} : { subdivision: job.subdivision }),
      };
      const result = await executeTemporalPlanPlannerOutput(
        plan,
        { text: job.text, calendarContext },
        {
          implementations: createDeterministicTemporalToolImplementations(),
          features: { planIr: true, deterministicPreflight: true },
          method: "agent+plan",
          modelName: provider.modelRevision,
          planningDurationMs: provider.inferenceLatencyMs ?? Date.now() - startedAt,
        },
      );
      const outcome = result.status === "resolved"
        ? "resolved"
        : result.status === "needs_clarification" || result.status === "ambiguous"
          ? "needs_clarification"
          : "no_plan";
      await ctx.runMutation(internal.temporalParsing.completeJob, {
        jobId: args.jobId,
        outcome,
        result,
        ...(provider.modelRevision === undefined ? {} : { modelRevision: provider.modelRevision }),
        ...(provider.inferenceLatencyMs === undefined
          ? {}
          : { inferenceLatencyMs: provider.inferenceLatencyMs }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider_error";
      const errorName = error instanceof Error ? error.name : "";
      const timeout = message.toLowerCase().includes("timeout");
      const invalidPlan = errorName === "ZodError";
      await ctx.runMutation(internal.temporalParsing.completeJob, {
        jobId: args.jobId,
        outcome: timeout ? "timeout" : invalidPlan ? "invalid_plan" : "provider_error",
        errorCode: timeout ? "inference_timeout" : invalidPlan ? "invalid_plan" : "provider_error",
        errorDetail: timeout
          ? "Temporal inference exceeded its deadline."
          : invalidPlan
            ? "Temporal inference returned a plan that failed validation."
            : "Temporal inference failed before producing a validated plan.",
      });
    }
  },
});

export const prewarm = internalAction({
  args: {},
  handler: async () => {
    const baseUrl = process.env.TEMPORAL_INFERENCE_BASE_URL?.trim().replace(/\/$/, "");
    const authToken = process.env.TEMPORAL_INFERENCE_AUTH_TOKEN?.trim();
    if (!baseUrl || !authToken || !serviceEnabled()) {
      return { status: "disabled" as const };
    }
    try {
      const response = await fetch(`${baseUrl}/ping`, {
        headers: { authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(2_000),
      });
      return {
        status: response.status === 200 ? "ready" as const : "warming" as const,
      };
    } catch {
      return { status: "warming" as const };
    }
  },
});
