import type { Admission, PlaybackMode } from "@vrdex/media-relay";
import type Hls from "hls.js";
import type { AdapterNotify, PlaybackAdapter } from "./event-playback-owner";
export type ReadyPlayback = Extract<Admission, { kind: "ready" }>;
/** Native media is never connected to Web Audio. Only the selected rendition loads. */
export function createNativeHlsAdapter({
  grant,
  mode: initialMode,
  mount,
  notify,
  loadHls = () => import("hls.js"),
  hardwareVolume = typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent),
}: {
  grant: ReadyPlayback;
  mode: PlaybackMode;
  mount: HTMLElement;
  notify: AdapterNotify;
  loadHls?: () => Promise<typeof import("hls.js")>;
  hardwareVolume?: boolean;
}): PlaybackAdapter {
  const video = document.createElement("video");
  video.playsInline = true;
  video.className = "aspect-video w-full object-contain";
  const audio = document.createElement("audio");
  audio.hidden = true;
  const nodes = { video, audio };
  mount.append(video, audio);
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
    const playing = () => {
      if (disposed || !intent || node !== nodes[mode]) {
        node.pause();
        return;
      }
      notify({ status: "playing" });
    };
    const pause = () => {
      if (!disposed && node === nodes[mode] && node.paused) {
        intent = false;
        version++;
        notify({ status: "paused" });
      }
    };
    const error = () => {
      if (!disposed && node === nodes[mode]) notify({ status: "unavailable" });
    };
    node.addEventListener("playing", playing);
    node.addEventListener("pause", pause);
    node.addEventListener("ended", pause);
    node.addEventListener("error", error);
    listeners.push(() => {
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
    play,
    pause,
    async setMode(next) {
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
    setVolume(value) {
      if (!hardwareVolume) {
        video.volume = value;
        audio.volume = value;
      }
    },
    setMuted(value) {
      video.muted = value;
      audio.muted = value;
    },
    update(request) {
      video.title = request.title;
      audio.title = request.title;
    },
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
