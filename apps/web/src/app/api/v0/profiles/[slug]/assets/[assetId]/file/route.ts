import { api } from "@convex-generated-api";
import { convexHttpClient } from "@/lib/server/convex-http";
import { getProfileAssetObject, isProfileAssetStorageConfigured } from "@/lib/server/profile-asset-storage";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
    assetId: string;
  }>;
};

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  return mimeType.split("/")[1] ?? "bin";
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "profile-asset";
}

export async function GET(request: Request, context: RouteContext) {
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

  const object = await getProfileAssetObject(asset.storageKey);

  if (object === null) {
    return Response.json({ error: "Stored asset not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const baseName = safeFileName(asset.originalFileName ?? asset.label ?? `${asset.displayName} logo`);
  const hasExtension = /\.[a-z0-9]+$/i.test(baseName);
  const fileName = hasExtension ? baseName : `${baseName}.${extensionForMimeType(asset.mimeType)}`;
  const body = object.body.buffer.slice(
    object.body.byteOffset,
    object.body.byteOffset + object.body.byteLength,
  ) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "content-length": String(object.contentLength ?? object.body.byteLength),
      "content-security-policy": "sandbox; script-src 'none'; object-src 'none'",
      "content-type": object.contentType,
      "x-content-type-options": "nosniff",
    },
  });
}
