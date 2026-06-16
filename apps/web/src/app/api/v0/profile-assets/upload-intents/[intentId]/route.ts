import { NextRequest, NextResponse } from "next/server";
import type { GenericId } from "convex/values";

import { api } from "@convex-generated-api";
import { convexHttpClient } from "@/lib/server/convex-http";
import { isProfileAssetStorageConfigured, putProfileAssetObject } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    intentId: string;
  }>;
};

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizedContentType(value: string | null): string {
  return (value ?? "application/octet-stream").split(";")[0]!.trim().toLowerCase();
}

async function bodyFromFileRequest(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Upload requests must include a file field.");
  }

  return {
    body: new Uint8Array(await file.arrayBuffer()),
    mimeType: normalizedContentType(file.type),
  };
}

async function bodyFromSourceUrl(sourceUrl: string) {
  const response = await fetch(sourceUrl, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Source URL returned HTTP ${response.status}.`);
  }

  return {
    body: new Uint8Array(await response.arrayBuffer()),
    mimeType: normalizedContentType(response.headers.get("content-type")),
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isProfileAssetStorageConfigured()) {
    return errorResponse("Profile asset storage is not configured.", 501);
  }

  const { intentId } = await context.params;
  const uploadToken = request.headers.get("x-vrdex-upload-token")?.trim();

  if (!uploadToken) {
    return errorResponse("Upload token is required.", 403);
  }

  const convex = convexHttpClient();
  const intent = await convex.query(api.profileAssets.validateUploadIntentForStorage, {
    intentId: intentId as GenericId<"profileAssetUploadIntents">,
    uploadToken,
  });

  if (intent === null) {
    return errorResponse("Upload intent was not found or expired.", 404);
  }

  try {
    const upload = intent.sourceUrl
      ? await bodyFromSourceUrl(intent.sourceUrl)
      : await bodyFromFileRequest(request);

    await putProfileAssetObject({
      storageKey: intent.storageKey,
      body: upload.body,
      contentType: upload.mimeType,
    });
    await convex.mutation(api.profileAssets.markUploadIntentUploaded, {
      intentId: intent.intentId,
      uploadToken,
      mimeType: upload.mimeType,
      byteSize: upload.body.byteLength,
    });

    return NextResponse.json({
      intentId: intent.intentId,
      storageKey: intent.storageKey,
      mimeType: upload.mimeType,
      byteSize: upload.body.byteLength,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile media upload failed.";

    return errorResponse(message, 400);
  }
}
