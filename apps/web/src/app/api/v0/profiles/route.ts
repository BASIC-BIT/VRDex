import { createHash } from "node:crypto";

import {
  ApiIdempotencyKeySchema,
  ApiProfileSubmitRequestSchema,
  ApiProfileWriteResponseSchema,
} from "@vrdex/api-contracts";
import { internal } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { apiJson, apiProblemResponse, rejectBearerTokenQuery } from "@/lib/server/api-v0";
import { evaluateApiUserWriteRequest } from "@/lib/server/api-user-authority";
import { convexAdminHttpClient } from "@/lib/server/convex-http";

export const dynamic = "force-dynamic";

function problem(status: 400 | 409 | 500, title: string, detail: string) {
  return apiProblemResponse({ type: "about:blank", title, status, detail });
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Canonical JSON, so a retry that serializes its keys in a different order is
 * still recognized as the same request rather than a conflicting one.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return `{${
      Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(",")
    }}`;
  }

  return JSON.stringify(value) ?? "null";
}

function profileSubmitErrorResponse(error: unknown) {
  // Structured data first, matching the update route: Convex redacts plain error
  // messages on production deployments, so reading only Error.message returns
  // the serialized payload or generic Convex text rather than the real reason.
  const data = (error as { data?: { code?: string; message?: string } } | null)?.data;

  if (data?.code === "INVALID_PROFILE_LINK") {
    return problem(400, "Invalid profile submission", data.message ?? "The outbound links are invalid.");
  }

  if (data?.code === "PROFILE_INPUT_INVALID") {
    return problem(400, "Invalid profile submission", data.message ?? "The profile submission is invalid.");
  }

  if (data?.code === "IDENTITY_SUPPRESSED") {
    return problem(400, "Invalid profile submission", data.message ?? "This profile cannot be created.");
  }

  if (data?.code === "IDEMPOTENCY_KEY_REUSED") {
    return problem(
      409,
      "Idempotency-Key already used",
      data.message ?? "This Idempotency-Key was already used for a different profile submission.",
    );
  }

  return problem(
    400,
    "Invalid profile submission",
    error instanceof Error ? error.message : "The profile submission is invalid.",
  );
}

export async function POST(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const evaluation = await evaluateApiUserWriteRequest(request, { requiredScope: "profile:write" });
  if (!evaluation.ok) {
    return evaluation.response;
  }

  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when submitting a profile.");
  }

  const body = ApiProfileSubmitRequestSchema.safeParse(rawBody);
  if (!body.success) {
    return problem(
      400,
      "Invalid profile submission",
      body.error.issues[0]?.message ?? "The profile submission is invalid.",
    );
  }

  // Optional, because a caller that never loses a response does not need one.
  // A create has no natural replay guard, so anything that retries on timeout
  // should send it: without one, the retry publishes a second profile.
  const rawIdempotencyKey = request.headers.get("idempotency-key");
  const idempotencyKey = rawIdempotencyKey === null
    ? undefined
    : ApiIdempotencyKeySchema.safeParse(rawIdempotencyKey);

  if (idempotencyKey !== undefined && !idempotencyKey.success) {
    return problem(
      400,
      "Invalid Idempotency-Key",
      "Use 1 to 128 letters, numbers, dots, underscores, colons, or hyphens.",
    );
  }

  const idempotency = idempotencyKey === undefined || !idempotencyKey.success
    ? {}
    : {
      idempotencyKeyHash: sha256(idempotencyKey.data),
      requestFingerprint: sha256(canonicalJson(body.data)),
    };

  try {
    const result = await convexAdminHttpClient().mutation(
      internal.profiles.submitCommunityProfileForApiUser,
      {
        actorKind: evaluation.source,
        ownerUserId: evaluation.ownerUserId as Id<"users">,
        ...idempotency,
        ...body.data,
      },
    );

    return apiJson(ApiProfileWriteResponseSchema, result, { status: 201 });
  } catch (error) {
    return profileSubmitErrorResponse(error);
  }
}
