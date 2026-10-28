import type { PlaybackMode } from "./playback-mode";
import {
  createRelayPlaybackAdapter,
  type RelayPlaybackClient,
} from "./relay-playback-adapter";
import { EventLineupSession } from "./event-lineup-runtime";
import type {
  AdapterNotify,
  PlaybackAdapter,
  PlaybackRequest,
} from "./event-playback-owner";
import { createTwitchAdapter } from "./twitch-player-adapter";
import {
  attachVrcdnTransport,
  releaseVrcdnTransport,
  type VrcdnTransport,
} from "./vrcdn-transport";

export function createEventPlaybackAdapter(
  request: PlaybackRequest,
  mount: HTMLElement,
  notify: AdapterNotify,
  loadMpegts = () => import("mpegts.js"),
): PlaybackAdapter {
  if (request.kind === "twitch")
    return createTwitchAdapter(request, mount, notify);
  if (request.kind === "performer_sequence") {
    let previousEvent = JSON.stringify(request.event);
    const session = new EventLineupSession(request.event, mount, (lineup) =>
      notify({
        lineup,
        status: lineup.unavailable
          ? "unavailable"
          : lineup.paused
            ? "paused"
            : "playing",
      }),
    );
    return {
      async play() {
        await session.play();
        return !session.state.paused;
      },
      pause: () => session.pause(),
      setVolume(value) {
        session.setVolume(value);
      },
      setMuted(value) {
        session.setMuted(value);
      },
      update(value) {
        if (value.kind === "performer_sequence") {
          const next = JSON.stringify(value.event);
          if (next !== previousEvent) {
            previousEvent = next;
            session.update(value.event);
          }
        }
      },
      dispose: () => session.dispose(),
      manual: (key) => session.manual(key),
      live: () => session.live(),
      retryNextPlayback: () => session.retryNextPlayback(),
    };
  }
  const video = document.createElement("video");
  video.playsInline = true;
  video.className = "aspect-video w-full object-contain";
  video.title = request.title;
  mount.append(video);
  let player: VrcdnTransport | undefined,
    disposed = false,
    attempt = 0;
  let failed = false;
  const listeners: Array<[string, () => void]> = [
    [
      "playing",
      () => {
        if (!disposed && !video.paused) {
          failed = false;
          notify({ status: "playing" });
        }
      },
    ],
    [
      "pause",
      () => {
        if (!disposed && !failed) notify({ status: "paused" });
      },
    ],
    [
      "ended",
      () => {
        if (!disposed && !failed) notify({ status: "paused" });
      },
    ],
    [
      "error",
      () => {
        if (!disposed) {
          failed = true;
          notify({ status: "unavailable" });
        }
      },
    ],
  ];
  for (const [event, listener] of listeners)
    video.addEventListener(event, listener);
  const ready =
    request.transport === "video"
      ? Promise.resolve().then(() => {
          if (!disposed) video.src = request.src;
        })
      : loadMpegts().then(({ default: mpegts }) => {
          if (disposed) return;
          if (!mpegts.isSupported())
            throw new Error("Unsupported media transport");
          player = attachVrcdnTransport(mpegts, video, request.src, {
            onError: () => {
              if (!disposed) {
                failed = true;
                notify({ status: "unavailable" });
              }
            },
          });
        });
  // The owner may close before Play awaits the transport import.
  void ready.catch(() => {});
  return {
    async play() {
      const current = ++attempt;
      await ready;
      if (disposed || current !== attempt) return false;
      try {
        await video.play();
        return !disposed && current === attempt;
      } catch {
        return false;
      }
    },
    pause() {
      attempt++;
      video.pause();
    },
    setVolume(value) {
      video.volume = value;
    },
    setMuted(value) {
      video.muted = value;
    },
    update(value) {
      video.title = value.title;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      attempt++;
      for (const [event, listener] of listeners)
        video.removeEventListener(event, listener);
      video.pause();
      if (player) releaseVrcdnTransport(player);
      video.removeAttribute("src");
      video.load();
      video.remove();
    },
  };
}

/** Rollout is explicit. Saved audio never silently loads a legacy video stream. */
export function createRetainedPlaybackAdapter(
  request: PlaybackRequest,
  mount: HTMLElement,
  notify: AdapterNotify,
  { mode, relay }: { mode: PlaybackMode; relay?: RelayPlaybackClient },
): PlaybackAdapter {
  if (relay && request.kind === "vrcdn")
    return createRelayPlaybackAdapter({
      request,
      mount,
      notify,
      mode,
      client: relay,
    });
  if (
    (relay && request.kind === "performer_sequence") ||
    (mode === "audio" && request.kind !== "twitch")
  )
    return {
      async play() {
        return false;
      },
      pause() {},
      setVolume() {},
      setMuted() {},
      update() {},
      dispose() {},
    };
  return createEventPlaybackAdapter(request, mount, notify);
}
