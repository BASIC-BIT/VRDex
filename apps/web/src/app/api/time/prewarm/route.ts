import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api, internal } from "@convex-generated-api";

import { convexAdminHttpClient, convexHttpClient } from "@/lib/server/convex-http";
import { problem } from "@/lib/server/temporal-api";

export const dynamic = "force-dynamic";

export async function POST() {
  const authToken = await convexAuthNextjsToken();
  if (authToken === undefined) {
    return problem(401, "Sign in required", "Sign in to prepare VRDex Time.");
  }
  const convex = convexHttpClient();
  convex.setAuth(authToken);
  const viewer = await convex.query(api.accounts.viewer, {});
  const access = await convex.query(api.temporalParsing.getAccess, {});
  if (viewer === null || !access.allowed || !access.emailVerified) {
    return problem(403, "Temporal beta access required", "Temporal parsing beta access is required.");
  }
  const admin = convexAdminHttpClient();
  const lease = await admin.mutation(internal.temporalParsing.acquirePrewarmLease, {
    ownerUserId: viewer.user.id,
  });
  if (!lease.acquired) {
    return Response.json({
      status: "cooldown",
      retryAfterSeconds: lease.retryAfterSeconds,
    }, {
      status: 202,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(lease.retryAfterSeconds),
      },
    });
  }
  const result = await admin.action(
    internal.temporalParsingActions.prewarm,
    {},
  );
  return Response.json(result, {
    status: result.status === "ready" ? 200 : 202,
    headers: { "cache-control": "no-store" },
  });
}
