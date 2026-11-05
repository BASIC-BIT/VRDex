import type { EventPlaybackOwner, PlaybackSnapshot } from "./event-playback-owner";
import type { PlaybackMode } from "./playback-mode";
import { playbackArtwork } from "./playback-metadata";

type Identity = { displayName: string; artwork: string | undefined };
export function nowPlayingIdentity(state: PlaybackSnapshot): Identity | null {
  if (!state.request || !state.metadata) return null;
  return { displayName: state.metadata.displayName, artwork: playbackArtwork(state) };
}
function session() { return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null; }
export function clearNowPlaying(): void {
  const current = session();
  if (!current) return;
  current.metadata = null;
  current.playbackState = "none";
  for (const action of ["play", "pause", "stop"] satisfies MediaSessionAction[]) {
    try { current.setActionHandler(action, null); } catch { /* Older browsers omit individual actions. */ }
  }
}
export function applyNowPlaying({ identity, actions }: { identity: Identity | null; mode: PlaybackMode; actions: { owner: EventPlaybackOwner; generation: number } }): void {
  const current = session();
  if (!current) return;
  if (!identity) { clearNowPlaying(); return; }
  current.metadata = new MediaMetadata({ title: `${identity.displayName} - VRDex`, ...(identity.artwork ? { artwork: [{ src: new URL(identity.artwork, location.origin).href, sizes: "512x512", type: "image/png" }] } : {}) });
  const { owner, generation } = actions;
  const valid = () => owner.generation === generation && Boolean(owner.getSnapshot().request);
  current.playbackState = owner.getSnapshot().status === "playing" ? "playing" : "paused";
  for (const [action, handler] of [
    ["play", () => { const request = owner.getSnapshot().request; if (valid() && request) void owner.play(request); }],
    ["pause", () => { if (valid()) owner.pause(); }],
    ["stop", () => { if (valid()) { owner.close(); clearNowPlaying(); } }],
  ] satisfies [MediaSessionAction, () => void][]) {
    try { current.setActionHandler(action, handler); } catch { /* Unsupported action. */ }
  }
}

/** The root provider retains this subscription alongside its existing playback owner. */
export function retainNowPlaying(owner: EventPlaybackOwner): () => void {
  let previous = "";
  const update = () => {
    const state = owner.getSnapshot();
    const identity = nowPlayingIdentity(state);
    const generation = owner.generation;
    const key = JSON.stringify([identity, state.mode, state.status, generation]);
    if (key === previous) return;
    previous = key;
    applyNowPlaying({ identity, mode: state.mode, actions: { owner, generation } });
  };
  const unsubscribe = owner.subscribe(update);
  update();
  return () => { unsubscribe(); clearNowPlaying(); };
}
