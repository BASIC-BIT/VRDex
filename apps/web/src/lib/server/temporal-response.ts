import {
  TemporalParseCompletedResponseSchema,
  TemporalParsePendingResponseSchema,
} from "@vrdex/api-contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";

const RETRY_AFTER_SECONDS = 2;
const ESTIMATED_COLD_WAIT_SECONDS = 30;

function completedTemporalJson(body: unknown) {
  const parsed = TemporalParseCompletedResponseSchema.safeParse(body);
  if (!parsed.success) {
    return problem(
      503,
      "Temporal result unavailable",
      "The parser produced a result that did not pass the public response contract.",
    );
  }
  return Response.json(parsed.data, {
    headers: { "cache-control": "no-store" },
  });
}

export type TemporalJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  expiresAt: number;
  outcome?: string;
  result?: unknown;
  errorCode?: string;
  errorDetail?: string;
};

function temporalHashKey() {
  const key = process.env.TEMPORAL_INPUT_HASH_KEY?.trim();
  if (!key) {
    throw new Error("TEMPORAL_INPUT_HASH_KEY is required.");
  }
  return key;
}

export function createContinuationToken(ownerKey?: string, idempotencyKey?: string) {
  if (ownerKey === undefined || idempotencyKey === undefined) {
    return randomBytes(32).toString("base64url");
  }
  return createHmac("sha256", temporalHashKey())
    .update("vrdex-temporal-continuation-v1\0")
    .update(ownerKey)
    .update("\0")
    .update(idempotencyKey)
    .digest("base64url");
}

export function hashContinuationToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashTemporalInput(value: string) {
  return createHmac("sha256", temporalHashKey()).update(value).digest("hex");
}

export function completedTemporalResponse(job: TemporalJob) {
  if (job.status === "failed") {
    const timeout = job.errorCode === "inference_timeout";
    return problem(
      timeout ? 504 : 503,
      timeout ? "Temporal inference timed out" : "Temporal inference unavailable",
      job.errorDetail ?? "The parser could not produce a validated result. Retry later.",
    );
  }

  const source = job.result as {
    status?: string;
    kind?: "instant" | "time_range";
    epoch?: number;
    canonical?: unknown;
    range?: {
      start: { epoch: number; canonical: unknown };
      end: { epoch: number; canonical: unknown };
    };
    confidence?: number;
    assumptions?: string[];
    clarificationQuestion?: string;
    clarificationAlternatives?: Array<{
      label: string;
      kind?: "instant" | "time_range";
      epoch: number;
      confidence: number;
      canonical: unknown;
      range?: {
        start: { epoch: number; canonical: unknown };
        end: { epoch: number; canonical: unknown };
      };
    }>;
    ambiguity?: string[];
  };

  if (source.status === "resolved" && source.kind !== undefined) {
    return completedTemporalJson({
      requestId: job.id,
      status: "resolved",
      kind: source.kind,
      confidence: source.confidence ?? 0,
      method: "trained_plan",
      ...(source.epoch === undefined ? {} : { epoch: source.epoch }),
      ...(source.canonical === undefined ? {} : { canonical: source.canonical }),
      ...(source.range === undefined
        ? {}
        : {
            range: {
              start: { epoch: source.range.start.epoch, canonical: source.range.start.canonical },
              end: { epoch: source.range.end.epoch, canonical: source.range.end.canonical },
            },
          }),
      assumptions: source.assumptions ?? [],
    });
  }

  if (source.status === "needs_clarification" || source.status === "ambiguous") {
    return completedTemporalJson({
      requestId: job.id,
      status: "needs_clarification",
      question: source.clarificationQuestion ?? "Which time did you mean?",
      alternatives: (source.clarificationAlternatives ?? []).map((alternative) => ({
        label: alternative.label,
        ...(alternative.kind === undefined ? {} : { kind: alternative.kind }),
        epoch: alternative.epoch,
        confidence: alternative.confidence,
        canonical: alternative.canonical,
        ...(alternative.range === undefined
          ? {}
          : {
              range: {
                start: {
                  epoch: alternative.range.start.epoch,
                  canonical: alternative.range.start.canonical,
                },
                end: {
                  epoch: alternative.range.end.epoch,
                  canonical: alternative.range.end.canonical,
                },
              },
            }),
      })),
    });
  }

  return completedTemporalJson({
    requestId: job.id,
    status: "no_plan",
    reason: "The input did not produce a safe temporal interpretation.",
  });
}

export function pendingTemporalResponse(args: {
  jobId: string;
  continuationToken: string;
  expiresAt: number;
  requestUrl: string;
  continuationPath: "/api/time/parse" | "/api/v0/time/parse";
}) {
  const body = TemporalParsePendingResponseSchema.parse({
    requestId: args.jobId,
    status: "pending",
    continuationToken: args.continuationToken,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
    estimatedWaitSeconds: ESTIMATED_COLD_WAIT_SECONDS,
    expiresAt: new Date(args.expiresAt).toISOString(),
  });
  const location = new URL(
    `${args.continuationPath}/${encodeURIComponent(args.continuationToken)}`,
    args.requestUrl,
  );
  return Response.json(body, {
    status: 202,
    headers: {
      location: location.toString(),
      "retry-after": String(RETRY_AFTER_SECONDS),
      "cache-control": "no-store",
    },
  });
}

export function temporalSubmissionError(error: unknown) {
  const message = error instanceof Error ? error.message : "temporal_submission_failed";
  if (message.includes("verified_email_required") || message.includes("temporal_beta_required")) {
    return problem(403, "Temporal beta access required", "A verified email and an active temporal parsing beta grant are required.");
  }
  if (message.includes("account_rate_limited")) {
    const response = problem(429, "Temporal quota exceeded", "This account has reached the current temporal parsing rate limit.");
    response.headers.set("Retry-After", "60");
    return response;
  }
  if (message.includes("account_daily_limited")) {
    return problem(429, "Daily temporal quota exceeded", "This account has reached its temporal parsing allowance for today.");
  }
  if (message.includes("account_monthly_limited")) {
    return problem(429, "Monthly temporal quota exceeded", "This account has reached its temporal parsing allowance for this month.");
  }
  if (message.includes("account_concurrency_limited") || message.includes("capacity_unavailable")) {
    const response = problem(503, "Temporal capacity unavailable", "A parse is already in progress. Retry shortly.");
    response.headers.set("Retry-After", "2");
    return response;
  }
  if (message.includes("service_disabled")) {
    return problem(503, "Temporal service disabled", "The temporal parser is temporarily disabled.");
  }
  if (message.includes("TEMPORAL_INPUT_HASH_KEY")) {
    return problem(500, "Temporal service misconfigured", "The temporal parser is not fully configured.");
  }
  return problem(500, "Temporal submission failed", "The temporal parser could not accept this request.");
}

export function problem(
  status: 400 | 401 | 403 | 404 | 410 | 429 | 500 | 503 | 504,
  title: string,
  detail: string,
) {
  return Response.json({
    type: "about:blank",
    title,
    status,
    detail,
  }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
