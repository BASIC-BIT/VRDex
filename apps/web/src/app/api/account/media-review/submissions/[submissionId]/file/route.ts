import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";

import { convexAuthToken } from "@/lib/server/auth";
import { convexHttpClient } from "@/lib/server/convex-http";
import { getProfileAssetObject, isProfileAssetStorageConfigured } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ submissionId: string }>;
};

function extensionForMimeType(mimeType: string, originalFileName?: string): string {
  const originalExtension = originalFileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (
    (mimeType === "image/jpeg" && (originalExtension === "jpg" || originalExtension === "jpeg")) ||
    (mimeType === "image/png" && originalExtension === "png") ||
    (mimeType === "image/webp" && originalExtension === "webp") ||
    (mimeType === "image/svg+xml" && originalExtension === "svg")
  ) {
    return originalExtension;
  }
  return mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1] ?? "bin";
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "candidate";
}

export async function GET(_request: Request, context: RouteContext) {
  const authToken = await convexAuthToken();
  if (authToken === undefined) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!isProfileAssetStorageConfigured()) {
    return Response.json({ error: "Profile asset storage is not configured." }, { status: 501 });
  }

  const { submissionId } = await context.params;
  const convex = convexHttpClient();
  convex.setAuth(authToken);
  const candidate = await convex.query(api.profileMediaSubmissions.getCandidateForStorage, {
    submissionId: submissionId as Id<"profileMediaSubmissions">,
  });
  if (candidate === null) {
    return Response.json({ error: "Candidate not found." }, { status: 404 });
  }
  const object = await getProfileAssetObject(candidate.storageKey);
  if (object === null) {
    return Response.json({ error: "Stored candidate not found." }, { status: 404 });
  }

  const baseName = safeFileName(candidate.originalFileName ?? `${candidate.profileDisplayName} candidate`)
    .replace(/\.[a-z0-9]+$/i, "");
  const fileName = `${baseName}.${extensionForMimeType(candidate.mimeType, candidate.originalFileName)}`;
  const body = object.body.buffer.slice(
    object.body.byteOffset,
    object.body.byteOffset + object.body.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${fileName}"`,
      "content-length": String(object.contentLength ?? object.body.byteLength),
      "content-security-policy": "sandbox; default-src 'none'; script-src 'none'; object-src 'none'",
      "content-type": candidate.mimeType,
      "x-content-type-options": "nosniff",
    },
  });
}
