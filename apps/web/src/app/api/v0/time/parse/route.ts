import { TemporalParseRequestSchema } from "@vrdex/api-contracts";

import { rejectBearerTokenQuery } from "@/lib/server/api-v0";
import {
  authorizeTemporalApiRequest,
  completedTemporalResponse,
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
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const authorization = await authorizeTemporalApiRequest(request);
  if (!authorization.ok) {
    return authorization.response;
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

  const idempotency = parseTemporalIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }
  try {
    const continuationToken = createContinuationToken(
      String(authorization.context.ownerUserId),
      idempotency.value,
    );
    const job = await submitTemporalJob({
      auth: authorization.context,
      body: parsed.data,
      continuationToken,
    });
    const completed = await waitForImmediateTemporalResult({
      auth: authorization.context,
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
      continuationPath: "/api/v0/time/parse",
    });
  } catch (error) {
    return temporalSubmissionError(error);
  }
}
