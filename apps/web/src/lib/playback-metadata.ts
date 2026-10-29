import { nowPlayingArtworkUrl, NOW_PLAYING_BRAND_VERSION } from "./now-playing-artwork-url";
import type { PlaybackSnapshot } from "./event-playback-owner";

/** Only the admitted current source supplies metadata; a prepared performer never does. */
export function playbackArtwork(state: PlaybackSnapshot): string | undefined {
  const request = state.request;
  const slug = request?.kind === "performer_sequence"
    ? request.event.slots.find(slot => slot.key === state.lineup?.current)?.performerId
    : request && "profileId" in request ? request.profileSlug : undefined;
  return state.metadata?.artworkAssetId && state.metadata.artworkRevision && slug
    ? nowPlayingArtworkUrl({ profileId: slug, assetId: state.metadata.artworkAssetId, revision: state.metadata.artworkRevision, brandVersion: NOW_PLAYING_BRAND_VERSION })
    : undefined;
}
