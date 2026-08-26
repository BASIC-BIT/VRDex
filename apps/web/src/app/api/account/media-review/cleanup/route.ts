import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

import { convexAuthToken } from "@/lib/server/auth";
import { convexHttpClient } from "@/lib/server/convex-http";
import { deleteProfileAssetObjects, isProfileAssetStorageConfigured } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Same-origin request required." }, { status: 403 });
  }
  const authToken = await convexAuthToken();
  if (authToken === undefined) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isProfileAssetStorageConfigured()) {
    return Response.json({ error: "Profile asset storage is not configured." }, { status: 501 });
  }

  const convex = convexHttpClient();
  convex.setAuth(authToken);
  const due = await convex.mutation(api.profileMediaSubmissions.prepareDueBlobCleanup, {});
  const completed: Id<"profileMediaSubmissions">[] = [];
  for (const item of due) {
    await deleteProfileAssetObjects(item.storageKeys);
    completed.push(item.submissionId);
  }
  const result = await convex.mutation(api.profileMediaSubmissions.markBlobCleanupComplete, {
    submissionIds: completed,
  });
  return Response.json(result, { headers: { "cache-control": "private, no-store" } });
}
