import sharp from "sharp";

import { allowedDestinationArtworkUrl, type DestinationKind } from "../../../../../workers/group-telemetry/profile-link-destination.mjs";
import { fetchProfileAssetSourceUrl } from "./profile-asset-source-import";

// Reuse the image importer's HTTPS, DNS pinning, redirect and streamed 12MB boundary.
// Decode to a bounded static thumbnail or profile portrait.
export type DestinationArtworkSize = 128 | 512;
export async function prepareProfileLinkDestinationArtwork(source: string, kind: DestinationKind, size: DestinationArtworkSize = 128): Promise<Uint8Array> {
  const imported = await fetchProfileAssetSourceUrl(source, {
    totalTimeoutMs: 10_000,
    assertSourceUrl(url) {
      if (!allowedDestinationArtworkUrl(url.href, kind)) throw new Error("Unsupported destination artwork source");
    },
  });
  return sanitizeProfileLinkDestinationArtwork(imported.body, imported.mimeType, size);
}

export async function sanitizeProfileLinkDestinationArtwork(body: Uint8Array, mimeType: string, size: DestinationArtworkSize = 128): Promise<Uint8Array> {
  if (body.byteLength > 12 * 1024 * 1024) throw new Error("Destination artwork too large");
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    throw new Error("Destination artwork must be raster");
  }
  const pipeline = sharp(body, { animated: false, failOn: "warning", limitInputPixels: 4096 * 4096 });
  const metadata = await pipeline.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("Unsupported artwork encoding");
  const image = await pipeline.rotate().resize(size, size, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  if (image.byteLength > (size === 512 ? 512 : 128) * 1024) throw new Error("Destination thumbnail too large");
  return image;
}
