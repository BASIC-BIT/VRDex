import { api } from "@convex-generated-api";
import { rejectBearerTokenQuery, rejectInvalidOptionalApiBearerToken } from "@/lib/server/api-v0";
import { convexHttpClient } from "@/lib/server/convex-http";
import { getProfileAssetObject, isProfileAssetStorageConfigured } from "@/lib/server/profile-asset-storage";
import { createStoredZip } from "@/lib/server/zip";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  return mimeType.split("/")[1] ?? "bin";
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "logo";
}

export async function GET(request: Request, context: RouteContext) {
  const rejected = rejectBearerTokenQuery(request);
  if (rejected !== null) {
    return rejected;
  }

  const rejectedBearerToken = await rejectInvalidOptionalApiBearerToken(request);
  if (rejectedBearerToken !== null) {
    return rejectedBearerToken;
  }

  if (!isProfileAssetStorageConfigured()) {
    return Response.json({ error: "Profile asset storage is not configured." }, { status: 501 });
  }

  const { slug } = await context.params;
  const convex = convexHttpClient();
  const profile = await convex.query(api.profileAssets.listPublicBySlug, { slug });

  if (profile === null) {
    return Response.json({ error: "Profile not found." }, { status: 404 });
  }

  if (profile.mediaKit.logos.length === 0) {
    return Response.json({ error: "No public logos found." }, { status: 404 });
  }

  const entries = (
    await Promise.all(
      profile.mediaKit.logos.map(async (logo, index) => {
        const asset = await convex.query(api.profileAssets.getPublicAssetForStorage, {
          slug,
          assetId: logo.assetId,
        });

        if (asset === null) {
          return null;
        }

        const object = await getProfileAssetObject(asset.storageKey);
        if (object === null) {
          return null;
        }

        const extension = extensionForMimeType(asset.mimeType);
        const name = safeFilePart(asset.label ?? (index === 0 ? "primary-logo" : `logo-${index + 1}`));

        return {
          name: `${String(index + 1).padStart(2, "0")}-${name}.${extension}`,
          body: object.body,
        };
      }),
    )
  ).filter((entry): entry is { name: string; body: Uint8Array } => entry !== null);

  if (entries.length === 0) {
    return Response.json({ error: "Stored logos were not found." }, { status: 404 });
  }

  const zip = createStoredZip(entries);
  const fileName = `${safeFilePart(profile.displayName)}-logos.zip`;
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;

  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-disposition": `attachment; filename="${fileName}"`,
      "content-length": String(zip.byteLength),
      "content-type": "application/zip",
      "x-content-type-options": "nosniff",
    },
  });
}
