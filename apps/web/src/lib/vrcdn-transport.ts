import { VrcdnFetchLoader } from "./vrcdn-fetch-loader";
/** Shared transport setup and teardown for standalone and observed event players. */
export type VrcdnTransport = Pick<ReturnType<(typeof import("mpegts.js"))["default"]["createPlayer"]>, "pause" | "unload" | "detachMediaElement" | "destroy" | "play" | "on">;
export function attachVrcdnTransport(mpegts: (typeof import("mpegts.js"))["default"], video: HTMLVideoElement, src: string, hooks: { onError: () => void; onLoadingComplete?: () => void }) {
  const player = mpegts.createPlayer({ isLive: true, type: "mpegts", url: src }, { customLoader: VrcdnFetchLoader });
  try {
  player.on(mpegts.Events.ERROR, hooks.onError);
  if (hooks.onLoadingComplete) player.on(mpegts.Events.LOADING_COMPLETE, hooks.onLoadingComplete);
  player.attachMediaElement(video);
  player.load();
  return player;
  } catch (error) { releaseVrcdnTransport(player); throw error; }
}
export function releaseVrcdnTransport(player: VrcdnTransport) {
  for (const method of ["pause", "unload", "detachMediaElement", "destroy"] as const) {
    try { player[method](); } catch { /* Continue releasing a partially torn-down transport. */ }
  }
}
