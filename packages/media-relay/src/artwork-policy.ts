/** Admission and rendering share the raster limits; decoding still validates bytes. */
export const NOW_PLAYING_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const NOW_PLAYING_MAX_PIXELS = 4096 * 4096;
export function supportsNowPlayingArtwork(asset: {
  mimeType: string; byteSize: number; width?: number; height?: number;
}): boolean {
  return ["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) &&
    asset.byteSize > 0 && asset.byteSize <= NOW_PLAYING_MAX_SOURCE_BYTES &&
    (asset.width === undefined || asset.height === undefined ||
      (asset.width > 0 && asset.height > 0 && asset.width * asset.height <= NOW_PLAYING_MAX_PIXELS));
}
