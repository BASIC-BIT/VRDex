import { timingSafeEqual } from "node:crypto";
import { internal } from "@convex-generated-api";
import { optionalConvexAdminHttpClient } from "@/lib/server/convex-http";
import {
  deleteProfileAssetObjects,
  isProfileAssetStorageConfigured,
} from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const expected = process.env.VRDEX_MEDIA_CLEANUP_TOKEN;
  const actual = request.headers.get("authorization");
  const expectedBytes = Buffer.from(`Bearer ${expected ?? ""}`);
  const actualBytes = Buffer.from(actual ?? "");
  if (
    !expected ||
    expectedBytes.length !== actualBytes.length ||
    !timingSafeEqual(expectedBytes, actualBytes)
  )
    return new Response(null, { status: 401 });
  const admin = optionalConvexAdminHttpClient();
  if (!admin || !isProfileAssetStorageConfigured())
    return new Response(null, { status: 503 });
  // No request body or client-selected keys. The worker obtains exact leased obligations.
  const work = await admin.mutation(internal.contributionCleanup.claim, {});
  const uploads = [];
  const proposals = [];
  for (const row of work.uploads) {
    try {
      await deleteProfileAssetObjects(row.keys);
      uploads.push({ reservationId: row.reservationId, token: row.token });
    } catch {
      /* Durable retry. */
    }
  }
  for (const row of work.proposals) {
    try {
      await deleteProfileAssetObjects(row.storageKeys);
      proposals.push({
        submissionId: row.submissionId,
        cleanupToken: row.cleanupToken,
      });
    } catch {
      /* Durable retry. */
    }
  }
  await admin.mutation(internal.contributionCleanup.confirm, {
    uploads,
    proposals,
  });
  return Response.json(
    { deleted: uploads.length + proposals.length },
    { headers: { "cache-control": "no-store" } },
  );
}
