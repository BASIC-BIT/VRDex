import sharp from "sharp";

import { allowedDestinationArtworkUrl, type DestinationKind } from "../../../../../workers/group-telemetry/profile-link-destination.mjs";
import { fetchProfileAssetSourceUrl } from "./profile-asset-source-import";

// Reuse the image importer's HTTPS, DNS pinning, redirect and streamed 12MB boundary.
// The decode budget is smaller than media-kit assets, with a single static 128px output.
export async function prepareProfileLinkDestinationArtwork(source: string, kind: DestinationKind): Promise<Uint8Array> {
  const imported = await fetchProfileAssetSourceUrl(source, {
    totalTimeoutMs: 10_000,
    assertSourceUrl(url) {
      if (!allowedDestinationArtworkUrl(url.href, kind)) throw new Error("Unsupported destination artwork source");
    },
  });
  return sanitizeProfileLinkDestinationArtwork(imported.body, imported.mimeType);
}

export async function sanitizeProfileLinkDestinationArtwork(body: Uint8Array, mimeType: string): Promise<Uint8Array> {
  if (body.byteLength > 12 * 1024 * 1024) throw new Error("Destination artwork too large");
  if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    throw new Error("Destination artwork must be raster");
  }
  const pipeline = sharp(body, { animated: false, failOn: "warning", limitInputPixels: 4096 * 4096 });
  const metadata = await pipeline.metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("Unsupported artwork encoding");
  const image = await pipeline.rotate().resize(128, 128, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  if (image.byteLength > 128 * 1024) throw new Error("Destination thumbnail too large");
  return image;
}
