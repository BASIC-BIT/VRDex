import { mediaVolumeSettable } from "./media-element-controls";
import type { Admission, PlaybackMode } from "@vrdex/media-relay";
import type Hls from "hls.js";
import type { AdapterNotify } from "./event-playback-owner";
export type ReadyPlayback = Extract<Admission, { kind: "ready" }>;
/** Native media is never connected to Web Audio. Only the selected rendition loads. */
export function createNativeHlsAdapter({
  grant,
  mode: initialMode,
  mount,
  notify,
  loadHls = () => import("hls.js"),
  onNativePause, onNativePlay,
  hardwareVolume,
}: {
  grant: ReadyPlayback;
  mode: PlaybackMode;
  mount: HTMLElement;
  notify: AdapterNotify;
  loadHls?: () => Promise<typeof import("hls.js")>;
  onNativePause?: () => void;
  onNativePlay?: () => void;
  hardwareVolume?: boolean;
}) {
  const video = document.createElement("video");
  video.playsInline = true;
  video.className = "aspect-video w-full object-contain";
  const volumeSettable = hardwareVolume === undefined ? mediaVolumeSettable(video) : !hardwareVolume;
  const audio = document.createElement("audio");
  audio.hidden = true;
  const nodes = { video, audio };
  mount.append(video, audio);
  video.title = audio.title = `${grant.metadata.displayName} - VRDex`;
  let mode = initialMode,
    disposed = false,
    intent = false,
    version = 0;
  const players = new Map<HTMLMediaElement, Hls>();
  const ready = new Map<HTMLMediaElement, Promise<void>>();
  const listeners: Array<() => void> = [];
  function show() {
    video.hidden = mode === "audio";
  }
  show();
  for (const node of [video, audio]) {
    const playIntent = () => {
      // Native/OS Resume emits a new play event. A queued playing event alone
      // cannot revive an explicit pause or a superseded rendition.
      if (!disposed && node === nodes[mode] && !node.paused && !intent) {
        intent = true;
        version++;
        players.get(node)?.startLoad();
        onNativePlay?.();
      }
    };
    const playing = () => {
      if (disposed || !intent || node !== nodes[mode] || node.paused) {
        node.pause();
        return;
      }
      notify({ status: "playing" });
    };
    const pause = (event: Event) => {
      if (!disposed && node === nodes[mode] && node.paused) {
        const nativePause = intent && event.type === "pause" && !node.ended;
        intent = false;
        version++;
        notify({ status: "paused" });
        if (nativePause) onNativePause?.();
      }
    };
    const error = () => {
      if (!disposed && node === nodes[mode]) notify({ status: "unavailable" });
    };
    node.addEventListener("play", playIntent);
    node.addEventListener("playing", playing);
    node.addEventListener("pause", pause);
    node.addEventListener("ended", pause);
    node.addEventListener("error", error);
    listeners.push(() => {
      node.removeEventListener("play", playIntent);
      node.removeEventListener("playing", playing);
      node.removeEventListener("pause", pause);
      node.removeEventListener("ended", pause);
      node.removeEventListener("error", error);
    });
  }
  function prepare(
    node: HTMLMediaElement,
    selected: PlaybackMode,
  ): Promise<void> {
    const existing = ready.get(node);
    if (existing) return existing;
    const src =
      selected === "video" ? grant.videoPlaylist : grant.audioPlaylist;
    const pending = node.canPlayType("application/vnd.apple.mpegurl")
      ? ((node.src = src), Promise.resolve())
      : loadHls().then(({ default: Hls }) => {
          if (disposed || ready.get(node) !== pending) return;
          if (!Hls.isSupported()) throw Error("Unsupported HLS");
          const player = new Hls({ autoStartLoad: false });
          players.set(node, player);
          player.on(Hls.Events.ERROR, (_event, data) => {
            if (
              data.fatal &&
              !disposed &&
              players.get(node) === player &&
              node === nodes[mode]
            )
              notify({ status: "unavailable" });
          });
          player.loadSource(src);
          player.attachMedia(node);
        });
    ready.set(node, pending);
    return pending;
  }
  async function play(): Promise<boolean> {
    intent = true;
    const token = ++version;
    const node = nodes[mode];
    const preparing = prepare(node, mode);
    if (!node.canPlayType("application/vnd.apple.mpegurl")) await preparing;
    if (disposed || !intent || token !== version) return false;
    players.get(node)?.startLoad();
    try {
      await node.play();
      if (disposed || !intent || token !== version) {
        if (node !== nodes[mode] || !intent || disposed) node.pause();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  function pause() {
    intent = false;
    version++;
    video.pause();
    audio.pause();
    for (const player of players.values()) player.stopLoad();
  }
  return {
    get media(): HTMLMediaElement { return nodes[mode]; },
    play,
    pause,
    async setMode(next: PlaybackMode) {
      if (next === mode) return intent;
      const resume = intent;
      const old = nodes[mode];
      pause();
      mode = next;
      show();
      players.get(old)?.destroy();
      players.delete(old);
      ready.delete(old);
      old.removeAttribute("src");
      old.load();
      if (next === "audio") {
        if (document.pictureInPictureElement === video)
          void document.exitPictureInPicture().catch(() => {});
        if (
          "webkitSetPresentationMode" in video &&
          typeof video.webkitSetPresentationMode === "function"
        )
          video.webkitSetPresentationMode("inline");
      }
      return resume ? play() : true;
    },
    setVolume(value: number) {
      if (volumeSettable) {
        video.volume = value;
        audio.volume = value;
      }
    },
    setMuted(value: boolean) {
      video.muted = value;
      audio.muted = value;
    },
    update() {},
    setMetadata(metadata: ReadyPlayback["metadata"]) { video.title = audio.title = `${metadata.displayName} - VRDex`; },
    dispose() {
      if (disposed) return;
      disposed = true;
      pause();
      listeners.forEach((remove) => remove());
      for (const player of players.values()) player.destroy();
      for (const node of [video, audio]) {
        node.removeAttribute("src");
        node.load();
        node.remove();
      }
    },
  };
}
