import type { GenericId } from "convex/values";
import { NextResponse } from "next/server";

import { internal } from "@convex-generated-api";
import { convexAdminHttpClient } from "@/lib/server/convex-http";
import {
  createProfileAssetDirectUploadTarget,
  isProfileAssetStorageConfigured,
} from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  if (process.env.VRDEX_PROFILE_MEDIA_DIRECT_UPLOAD_ENABLED !== "true") {
    return NextResponse.json({ error: "Direct profile media upload is not enabled." }, { status: 501 });
  }
  if (!isProfileAssetStorageConfigured()) {
    return NextResponse.json({ error: "Profile asset storage is not configured." }, { status: 501 });
  }

  const uploadToken = request.headers.get("x-vrdex-upload-token")?.trim();
  if (!uploadToken) {
    return NextResponse.json({ error: "Upload token is required." }, { status: 403 });
  }

  const { intentId } = await context.params;
  const intent = await convexAdminHttpClient().query(
    internal.profileAssets.getUploadIntentForDirectStorage,
    {
      intentId: intentId as GenericId<"profileAssetUploadIntents">,
      uploadToken,
    },
  );
  if (intent === null) {
    return NextResponse.json(
      { error: "Upload intent was not found, expired, or already used." },
      { status: 404 },
    );
  }

  const target = await createProfileAssetDirectUploadTarget({
    storageKey: intent.storageKey,
    contentType: intent.mimeType,
    byteSize: intent.byteSize,
    expiresAt: intent.expiresAt,
  });

  return NextResponse.json({
    url: target.url,
    fields: target.fields,
    expiresAt: Math.min(intent.expiresAt, Date.now() + 10 * 60 * 1_000),
  });
}
