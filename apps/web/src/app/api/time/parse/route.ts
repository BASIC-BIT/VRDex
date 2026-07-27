import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { TemporalParseRequestSchema } from "@vrdex/api-contracts";

import { activeAuthSessionViewerQuery } from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
  completedTemporalResponse,
  createContinuationNonce,
  createContinuationToken,
  pendingTemporalResponse,
  parseTemporalIdempotencyKey,
  problem,
  submitTemporalJob,
  temporalSubmissionError,
  waitForImmediateTemporalResult,
} from "@/lib/server/temporal-api";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST(request: Request) {
  const authToken = await convexAuthNextjsToken();
  if (authToken === undefined) {
    return problem(401, "Sign in required", "Sign in to use VRDex Time.");
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, "Invalid JSON", "Send a JSON object when parsing a temporal expression.");
  }
  const parsed = TemporalParseRequestSchema.safeParse(input);
  if (!parsed.success) {
    return problem(
      400,
      "Invalid temporal parse request",
      parsed.error.issues[0]?.message ?? "The temporal parse request is invalid.",
    );
  }

  const convex = convexHttpClient();
  convex.setAuth(authToken);
  const viewer = await convex.query(activeAuthSessionViewerQuery, {});

  if (viewer === null) {
    return problem(401, "Sign in required", "Sign in to use VRDex Time.");
  }

  const auth = {
    ownerUserId: viewer.user.id,
    tokenId: "web-session",
  };
  const idempotency = parseTemporalIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }
  try {
    const continuationNonce = idempotency.value === undefined
      ? undefined
      : createContinuationNonce();
    let continuationToken = createContinuationToken(
      String(viewer.user.id),
      idempotency.value,
      continuationNonce,
    );
    const job = await submitTemporalJob({
      auth,
      body: parsed.data,
      continuationToken,
      ...(idempotency.value === undefined ? {} : {
        idempotencyKey: idempotency.value,
        continuationNonce,
      }),
    });
    if (idempotency.value !== undefined && job.continuationNonce !== undefined) {
      continuationToken = createContinuationToken(
        String(viewer.user.id),
        idempotency.value,
        job.continuationNonce,
      );
    }
    const completed = await waitForImmediateTemporalResult({
      auth,
      continuationToken,
    });
    if (completed !== null) {
      return completedTemporalResponse(completed);
    }
    return pendingTemporalResponse({
      jobId: String(job.jobId),
      continuationToken,
      expiresAt: job.expiresAt,
      requestUrl: request.url,
      continuationPath: "/api/time/parse",
    });
  } catch (error) {
    return temporalSubmissionError(error);
  }
}
