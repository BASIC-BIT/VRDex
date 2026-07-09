import { NextResponse } from "next/server";

import {
  rejectBearerTokenQuery,
  rejectInvalidOrRateLimitedPublicApiRequest,
} from "@/lib/server/api-v0";
import { probeProfileAssetStorage } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request);
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  const checkedAt = new Date().toISOString();
  const result = await probeProfileAssetStorage();

  if (!result.configured) {
    return NextResponse.json(
      {
        checkedAt,
        configured: false,
        storageReachable: false,
      },
      { status: 501 },
    );
  }

  if (!result.reachable) {
    return NextResponse.json(
      {
        checkedAt,
        configured: true,
        storageReachable: false,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    checkedAt,
    configured: true,
    storageReachable: true,
  });
}
