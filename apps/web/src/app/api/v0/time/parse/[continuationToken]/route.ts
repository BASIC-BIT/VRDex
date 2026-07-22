import { rejectBearerTokenQuery } from "@/lib/server/api-v0";
import {
  authorizeTemporalApiRequest,
  completedTemporalResponse,
  getTemporalJob,
  pendingTemporalResponse,
  problem,
} from "@/lib/server/temporal-api";

export const dynamic = "force-dynamic";

const continuationPattern = /^[A-Za-z0-9_-]{43}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ continuationToken: string }> },
) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const authorization = await authorizeTemporalApiRequest(request);
  if (!authorization.ok) {
    return authorization.response;
  }

  const { continuationToken } = await context.params;
  if (!continuationPattern.test(continuationToken)) {
    return problem(404, "Continuation not found", "The continuation token is unknown.");
  }

  const job = await getTemporalJob({
    auth: authorization.context,
    continuationToken,
  });
  if (job === null) {
    return problem(404, "Continuation not found", "The continuation token is unknown.");
  }
  if (job.expiresAt <= Date.now()) {
    return problem(410, "Continuation expired", "Submit the temporal expression again.");
  }
  if (job.status === "succeeded" || job.status === "failed") {
    return completedTemporalResponse(job);
  }
  return pendingTemporalResponse({
    jobId: job.id,
    continuationToken,
    expiresAt: job.expiresAt,
    requestUrl: request.url,
    continuationPath: "/api/v0/time/parse",
  });
}
