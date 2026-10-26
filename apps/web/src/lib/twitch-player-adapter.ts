import type { AdapterNotify, PlaybackAdapter, PlaybackRequest } from "./event-playback-owner";
export type TwitchPlayer = { play(): void; pause(): void; setVolume(value: number): void; setMuted(value: boolean): void; addEventListener(event: string, callback: () => void): void; removeEventListener(event: string, callback: () => void): void };
export type TwitchSDK = { Player: { new(mount: HTMLElement, options: Record<string, unknown>): TwitchPlayer; READY: string; PLAYING: string; PAUSE: string; OFFLINE: string; PLAYBACK_BLOCKED: string } };
let sdkPromise: Promise<TwitchSDK> | undefined;
export function loadTwitchSDK(): Promise<TwitchSDK> {
  const existing = (window as Window & { Twitch?: TwitchSDK }).Twitch;
  if (existing) return Promise.resolve(existing);
  if (!sdkPromise) sdkPromise = new Promise<TwitchSDK>((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://player.twitch.tv/js/embed/v1.js"; script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(new Error("Twitch unavailable")); }, 15_000);
    script.onload = () => { clearTimeout(timeout); const sdk = (window as Window & { Twitch?: TwitchSDK }).Twitch; if (sdk) resolve(sdk); else reject(new Error("Twitch unavailable")); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("Twitch unavailable")); };
    document.head.append(script);
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}
/** Only the official, visible >=400x300 player. Removing its container disposes the iframe browsing context. */
export function createTwitchAdapter(request: Extract<PlaybackRequest, { kind: "twitch" }>, mount: HTMLElement, notify: AdapterNotify, load = loadTwitchSDK): PlaybackAdapter {
  if (window.innerWidth < 400) throw new Error("Twitch player requires 400px width");
  const container = document.createElement("div"); container.style.minWidth = "400px"; container.style.minHeight = "300px"; mount.append(container);
  let player: TwitchPlayer | undefined, disposed = false, paused = true, muted = false, volume = 1;
  let settle: ((accepted: boolean) => void) | undefined;
  let playTimeout: ReturnType<typeof setTimeout> | undefined;
  const finish = (accepted: boolean) => { if (playTimeout) clearTimeout(playTimeout); settle?.(accepted); settle = undefined; };
  const listeners: Array<[string, () => void]> = [];
  let ready = false;
  const pending = load().then(sdk => {
    if (disposed) return;
    player = new sdk.Player(container, { width: "100%", height: 300, parent: [window.location.hostname], autoplay: false, muted,
      ...(request.channel ? { channel: request.channel } : request.video ? { video: request.video } : { collection: request.collection }) });
    const on = (event: string, callback: () => void) => { listeners.push([event, callback]); player!.addEventListener(event, callback); };
    on(sdk.Player.READY, () => { if (disposed) return; ready = true; player!.setVolume(volume); player!.setMuted(muted); if (!paused) player!.play(); });
    on(sdk.Player.PLAYING, () => { if (disposed || paused) { player?.pause(); return; } finish(true); notify({ status: "playing" }); });
    on(sdk.Player.PAUSE, () => { if (!disposed) notify({ status: "paused" }); });
    // Autoplay denial is not an explicit Pause. Keep the requested play intent
    // so a gesture in the provider iframe can recover without another parent click.
    on(sdk.Player.PLAYBACK_BLOCKED, () => { if (disposed || paused) return; finish(false); notify({ status: "blocked" }); });
    on(sdk.Player.OFFLINE, () => { if (disposed) return; finish(false); notify({ status: "unavailable" }); });
  });
  return {
    async play() {
      paused = false;
      finish(false);
      const result = new Promise<boolean>(resolve => { settle = resolve; });
      playTimeout = setTimeout(() => { paused = true; finish(false); player?.pause(); if (!disposed) notify({ status: "unavailable" }); }, 15_000);
      try { await pending; if (disposed || paused) return false; if (ready) player!.play(); }
      catch { finish(false); if (!disposed) notify({ status: "unavailable" }); throw new Error("Twitch unavailable"); }
      return result;
    },
    pause() { paused = true; finish(false); player?.pause(); },
    setVolume(value) { volume = value; if (ready) player?.setVolume(value); },
    setMuted(value) { muted = value; if (ready) player?.setMuted(value); },
    update() {},
    dispose() { if (disposed) return; disposed = true; paused = true; finish(false); for (const [event, callback] of listeners) player?.removeEventListener(event, callback); player?.pause(); container.remove(); },
  };
}
