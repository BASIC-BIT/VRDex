import { NextResponse } from "next/server";

import { probeProfileAssetStorage } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

export async function GET() {
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
