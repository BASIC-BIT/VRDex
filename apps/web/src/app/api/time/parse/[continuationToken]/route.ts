import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { activeAuthSessionViewerQuery } from "@/lib/server/active-auth-session";
import { convexHttpClient } from "@/lib/server/convex-http";
import {
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
  const authToken = await convexAuthNextjsToken();
  if (authToken === undefined) {
    return problem(401, "Sign in required", "Sign in to continue this temporal parse.");
  }
  const { continuationToken } = await context.params;
  if (!continuationPattern.test(continuationToken)) {
    return problem(404, "Continuation not found", "The continuation token is unknown.");
  }

  const convex = convexHttpClient();
  convex.setAuth(authToken);
  const viewer = await convex.query(activeAuthSessionViewerQuery, {});
  if (viewer === null) {
    return problem(401, "Sign in required", "Sign in to continue this temporal parse.");
  }
  const job = await getTemporalJob({
    auth: { ownerUserId: viewer.user.id, tokenId: "web-session" },
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
    continuationPath: "/api/time/parse",
  });
}
