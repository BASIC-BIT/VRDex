// Change whenever the canonical logo or rendering recipe changes.
export const NOW_PLAYING_BRAND_VERSION = "wordmark-v1-512";
export function nowPlayingArtworkUrl(input: { profileId: string; assetId: string; revision: string; brandVersion: string }): string {
  return `/api/v0/profiles/${encodeURIComponent(input.profileId)}/assets/${encodeURIComponent(input.assetId)}/file?revision=${encodeURIComponent(input.revision)}&brand=${encodeURIComponent(input.brandVersion)}`;
}
