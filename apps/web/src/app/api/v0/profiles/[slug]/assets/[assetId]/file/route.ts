import { api } from "@convex-generated-api";
import { rejectBearerTokenQuery, rejectInvalidOrRateLimitedPublicApiRequest } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";
import { getProfileAssetObject, isProfileAssetStorageConfigured } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
    assetId: string;
  }>;
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
  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  return mimeType.split("/")[1] ?? "bin";
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "profile-asset";
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOrRateLimitedPublicApiRequest(request, {
    routeClass: "profile_asset_file",
  });
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  if (!isProfileAssetStorageConfigured()) {
    return Response.json({ error: "Profile asset storage is not configured." }, { status: 501 });
  }

  const { slug, assetId } = await context.params;
  const asset = await convexHttpClient().query(api.profileAssets.getPublicAssetForStorage, {
    slug,
    assetId,
  });

  if (asset === null) {
    return Response.json({ error: "Asset not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const storageKey = download ? asset.downloadStorageKey ?? asset.storageKey : asset.storageKey;
  const mimeType = download ? asset.downloadMimeType ?? asset.mimeType : asset.mimeType;
  const object = await getProfileAssetObject(storageKey);

  if (object === null) {
    return Response.json({ error: "Stored asset not found." }, { status: 404 });
  }

  const baseName = safeFileName(
    asset.originalFileName ?? asset.label ?? `${asset.displayName} media`,
  ).replace(/\.[a-z0-9]+$/i, "");
  const fileName = `${baseName}.${extensionForMimeType(mimeType, asset.originalFileName)}`;
  const body = object.body.buffer.slice(
    object.body.byteOffset,
    object.body.byteOffset + object.body.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "content-length": String(object.contentLength ?? object.body.byteLength),
      "content-security-policy": "sandbox; default-src 'none'; img-src 'none'; script-src 'none'; object-src 'none'",
      "content-type": mimeType,
      "x-content-type-options": "nosniff",
    },
  });
}
